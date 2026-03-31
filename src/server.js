const express = require('express');
const app = express();
const WebSocket = require('ws');
const { createServer } = require('http');

// This creates the actual engine that handles both Web and WebSockets
const server = createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// --- THE UPGRADE HANDSHAKE ---
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    console.log("🔌 ESP32 connected via WebSocket!");
    ws.send(JSON.stringify({ message: "Welcome to the Stadium!" }));
});

app.use(express.json());

// --- 1. LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
    if (req.url !== '/device/poll') { 
        console.log(`📥 Incoming ${req.method} request to ${req.url}`);
    }
    next();
});

// ONLY DECLARE THESE ONCE
let userMemory = {}; 
let deviceQueues = {}; 
let lastProcessedEvents = {}; 

// --- 2. REGISTRATION (From Glide) ---
// Look for this route in your server.js
app.post('/save-preset', (req, res) => {
    const { deviceId, audioUrl, ...presets } = req.body;

    // 1. Update your local memory first
    if (userMemory[deviceId]) {
        userMemory[deviceId].audioUrl = audioUrl;
        userMemory[deviceId].presets = presets;
        
        console.log(`💾 Preset updated for ${deviceId}`);

        // 2. PASTE THE PREPARE LOGIC HERE
        const prepareData = JSON.stringify({
            type: "PREPARE",
            audioUrl: audioUrl, 
            fileId: Buffer.from(audioUrl).toString('base64').substring(0, 8) 
        });

        // This sends the "Download now!" command to the ESP32
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(prepareData);
            }
        });
    }

    res.status(200).send("OK");
});

// --- 3. THE IMPROVED TRIGGER FUNCTION ---
function triggerLights(teamName, eventType) {
    const cleanTeam = String(teamName).trim();
    const cleanEvent = String(eventType).toUpperCase().trim();

    console.log(`📡 API EVENT: ${cleanEvent} for ${cleanTeam}`);

    // Create the data (Use a generic audio URL if userMemory is failing)
    const pushData = JSON.stringify({
        presetId: `TEST_${Date.now()}`,
        settings: {
            audio: "https://www.myinstants.com/media/sounds/goal-horn.mp3", // Temporary test sound
            seq1_effect: "solid",
            seq1_duration: 5,
            seq1_speed: 50,
            seq1_color1: "#FF0000",
            seq1_color2: "#FFFFFF"
        }
    });

    // SEND TO EVERYONE - No more "if trackingTeam" check
    console.log(`Checking ${wss.clients.size} connected clients...`);
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(pushData);
            console.log("🚀 FORCED PUSH: Sent to a connected ESP32!");
        }
    });
}
            
// --- 4. DEVICE POLLING (For ESP32) ---
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;
    if (deviceQueues[deviceId] && deviceQueues[deviceId].length > 0) {
        const command = deviceQueues[deviceId].shift();
        console.log(`📤 Sending command to ${deviceId}: ${command.presetId}`);
        return res.json(command);
    }
    res.status(204).end();
});

// --- 5. TEST TRIGGER (Manual Simulation) ---
app.get('/test-trigger', (req, res) => {
    const team = req.query.team || "Canadiens";
    const event = req.query.event || "WIN";
    console.log(`🚀 MANUAL TEST: Simulating ${event} for ${team}`);
    triggerLights(team, event);
    res.send(`Simulated ${event} for ${team}. Check logs!`);
});

// --- 6. NHL LOGIC ---
async function checkNHL() {
    try {
        const response = await fetch("https://api-web.nhle.com/v1/score/now");
        const data = await response.json();
        if (!data || !data.games) return;

        // Get today's date in YYYY-MM-DD format to filter out old games
        const today = new Date().toISOString().split('T')[0];

        data.games.forEach(game => {
            // ONLY process games from today to prevent "Ghost" logs from 4pm games
            if (game.gameDate !== today) return;

            // FIX: Try Common Name -> Abbreviation -> "Unknown"
            const homeTeam = game.homeTeam.commonName?.default || game.homeTeam.abbreviation || "Unknown";
            const awayTeam = game.awayTeam.commonName?.default || game.awayTeam.abbreviation || "Unknown";
            
            const gameKey = `nhl_${game.id}`;
            const homeScore = game.homeTeam.score ?? 0;
            const awayScore = game.awayTeam.score ?? 0;
            const scoreSum = homeScore + awayScore;

            if (!lastProcessedEvents[gameKey]) {
                lastProcessedEvents[gameKey] = { score: scoreSum, home: homeScore, state: game.gameState };
                return;
            }
            const prev = lastProcessedEvents[gameKey];

            // 1. GOAL Detection (Only if the game is LIVE)
            if (game.gameState === "LIVE" && scoreSum > prev.score) {
                const scoringTeam = (homeScore > prev.home) ? homeTeam : awayTeam;
                triggerLights(scoringTeam, "GOAL");
            }

            // 2. WIN Detection (Only trigger when moving to FINAL states)
            if ((game.gameState === "OFF" || game.gameState === "FINAL") && prev.state === "LIVE") {
                const winner = (homeScore > awayScore) ? homeTeam : awayTeam;
                triggerLights(winner, "WIN");
                console.log(`🏆 GAME FINAL: ${homeTeam} ${homeScore} - ${awayTeam} ${awayScore}`);
            }

            lastProcessedEvents[gameKey] = { score: scoreSum, home: homeScore, state: game.gameState };
        });
    } catch (e) { console.error("❌ NHL Error:", e.message); }
}

// --- 7. MLB LOGIC ---
async function checkMLB() {
    try {
        const res = await fetch("https://statsapi.mlb.com/api/v1/schedule?sportId=1");
        const data = await res.json();
        const games = data.dates?.[0]?.games || [];

        for (let game of games) {
            const status = game.status.abstractGameState;
            if (status === "Live") {
                const live = await (await fetch(`https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`)).json();
                const lastPlay = live.liveData.plays.allPlays.slice(-1)[0];
                if (lastPlay && lastPlay.about.playId !== lastProcessedEvents[game.gamePk]) {
                    const event = lastPlay.result.event;
                    const team = lastPlay.team.name.split(' ').pop();
                    if (["Home Run", "Run"].includes(event)) triggerLights(team, event.toUpperCase());
                    lastProcessedEvents[game.gamePk] = lastPlay.about.playId;
                }
            }
        }
    } catch (e) { console.error("❌ MLB Error:", e.message); }
}

// --- 8. LOOPS & START ---
setInterval(() => {
    console.log(`🕒 Heartbeat: ${new Date().toLocaleString("en-US", {timeZone: "America/Toronto"})}`);
    checkNHL();
    checkMLB();
}, 20000);

app.get('/', (req, res) => res.send("🏆 Sports Server Active"));
server.listen(process.env.PORT || 3000, () => console.log("🚀 Server Running"));
