const express = require('express');
const app = express();
const WebSocket = require('ws');
const { createServer } = require('http');

// This creates the actual engine that handles both Web and WebSockets
const server = createServer(app);
const wss = new WebSocket.Server({ noServer: true });

app.use(express.json());

// --- THE UPGRADE HANDSHAKE ---
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// --- 3. THE CONNECTION HANDLER ---
wss.on('connection', (ws) => {
    console.log("🔌 New connection at the gateway...");
    ws.isAlive = true;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'IDENTIFY') {
                // IMPORTANT: We attach the ID to the 'ws' object itself
                ws.deviceId = data.deviceId; 
                console.log(`🆔 Verified: Device [${ws.deviceId}] is now ONLINE`);
            }
        } catch (e) {
            console.log("Non-JSON message received:", message.toString());
        }
    });

    ws.on('pong', () => { ws.isAlive = true; });
});

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
app.post('/save-preset', (req, res) => {
    const { deviceId, presetName, audioUrl, trackingTeam, ...settings } = req.body;

    if (!deviceId || !presetName) {
        return res.status(400).send("Missing Device ID or Preset Name");
    }

    // 1. Initialize the device folder if it's new
    if (!userMemory[deviceId]) {
        userMemory[deviceId] = { 
            trackingTeam: trackingTeam || "Blue Jays",
            presets: {} 
        };
    }

    // 2. Update the tracking team (Global for the device)
    userMemory[deviceId].trackingTeam = trackingTeam;

    // 3. Save or Update the specific preset inside that device's folder
    userMemory[deviceId].presets[presetName] = {
        audioUrl: audioUrl,
        ...settings
    };

    console.log(`💾 [${deviceId}] Saved Preset: "${presetName}" for Team: ${trackingTeam}`);

    // 4. Trigger PREPARE (Download) if audio changed
    if (audioUrl) {
        const prepareData = JSON.stringify({ type: "PREPARE", audioUrl: audioUrl });
        wss.clients.forEach(client => {
            if (client.readyState === 1 && client.deviceId === deviceId) {
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

    console.log(`📡 API EVENT RECEIVED: ${cleanEvent} for ${cleanTeam}`);

    Object.keys(userMemory).forEach(devId => {
        const user = userMemory[devId];

        if (user.trackingTeam === cleanTeam) {
            // Look through every preset saved for this device
            Object.keys(user.presets).forEach(pName => {
                const preset = user.presets[pName];
                const allowedEvents = String(preset.event || "").toUpperCase();

                if (allowedEvents.includes(cleanEvent)) {
                    console.log(`🔥 TRIGGER: [${pName}] matches [${cleanEvent}]`);

            const pushData = JSON.stringify({
                presetId: `${cleanEvent}_${Date.now()}`,
                settings: {
                    audio: user.audioUrl,
                    // Sequence 1
                    seq1_effect: user.presets.seq1_effect,
                    seq1_duration: user.presets.seq1_duration,
                    seq1_speed: user.presets.seq1_speed,
                    seq1_color1: user.presets.seq1_color1,
                    seq1_color2: user.presets.seq1_color2,
                    // Sequence 2
                    seq2_effect: user.presets.seq2_effect,
                    seq2_duration: user.presets.seq2_duration,
                    seq2_speed: user.presets.seq2_speed,
                    seq2_color1: user.presets.seq2_color1,
                    seq2_color2: user.presets.seq2_color2,
                    // Sequence 3
                    seq3_effect: user.presets.seq3_effect,
                    seq3_duration: user.presets.seq3_duration,
                    seq3_speed: user.presets.seq3_speed,
                    seq3_color1: user.presets.seq3_color1,
                    seq3_color2: user.presets.seq3_color2,
                    // Sequence 4
                    seq4_effect: user.presets.seq4_effect,
                    seq4_duration: user.presets.seq4_duration,
                    seq4_speed: user.presets.seq4_speed,
                    seq4_color1: user.presets.seq4_color1,
                    seq4_color2: user.presets.seq4_color2
                }
            });


            // 3. SHOUT it out to all connected WebSockets
            wss.clients.forEach(client => {
                        if (client.readyState === 1 && client.deviceId === devId) {
                            client.send(pushData);
                            console.log(`🚀 Data sent to ${devId} for preset: ${pName}`);
                        }
                    });
                }
            });
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
