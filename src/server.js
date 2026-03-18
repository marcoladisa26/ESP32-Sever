const express = require('express');
const app = express();
app.use(express.json());

// --- 1. LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
    if (req.url !== '/device/poll') { // Keep logs clean of constant polling
        console.log(`📥 Incoming ${req.method} request to ${req.url}`);
    }
    next();
});

let userMemory = {}; 
let deviceQueues = {}; 
let lastProcessedEvents = {}; 

// --- 2. REGISTRATION (From Glide) ---
app.post('/register-preset', (req, res) => {
    const { deviceId, trackingTeam, audioUrl, ...presets } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
    
    userMemory[deviceId] = { trackingTeam, audioUrl, presets };
    console.log(`✅ Registered: ${deviceId} watching ${trackingTeam}`);
    res.json({ success: true });
});

// --- 3. THE IMPROVED TRIGGER FUNCTION ---
function triggerLights(teamName, eventType) {
    // Normalize both inputs to Uppercase and remove accidental spaces
    const cleanTeam = String(teamName).trim();
    const cleanEvent = String(eventType).toUpperCase().trim();

    console.log(`📡 API EVENT: ${cleanEvent} for ${cleanTeam}`);

    let matched = false;
    Object.keys(userMemory).forEach(devId => {
        const user = userMemory[devId];
        
        // Match teams exactly (e.g., "Canadiens" === "Canadiens")
        if (user.trackingTeam === cleanTeam) {
            matched = true;
            const command = {
                presetId: `${cleanEvent}_${Date.now()}`,
                settings: { audio: user.audioUrl, ...user.presets }
            };
            
            if (!deviceQueues[devId]) deviceQueues[devId] = [];
            deviceQueues[devId].push(command);
            console.log(`   ✨ [${devId}] MATCHED! Queuing: ${command.presetId}`);
        }
    });

    if (!matched) console.log(`   (No active devices tracking ${cleanTeam})`);
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
app.listen(process.env.PORT || 3000, () => console.log("🚀 Server Running"));
