const express = require('express');
const app = express();
app.use(express.json());

// --- 1. LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
    console.log(`📥 Incoming ${req.method} request to ${req.url}`);
    next();
});

let userMemory = {}; 
let deviceQueues = {}; 
let lastProcessedEvents = {}; 

// --- 2. NEW: DEBUG & TEST ROUTES ---
// This fixed your "Cannot GET /debug-status"
app.get('/debug-status', (req, res) => {
    res.json({
        serverTime: new Date().toLocaleTimeString(),
        activeUsers: Object.keys(userMemory).length,
        registeredDevices: userMemory,
        lastEventsSeen: lastProcessedEvents
    });
});

// This fixed your "Cannot GET /test-trigger"
app.get('/test-trigger', (req, res) => {
    console.log("🚀 Manual Test Triggered via Browser");
    // Change "Blue Jays" to whatever team you have in your Glide Table to test
    triggerLights("Blue Jays", "MANUAL_TEST"); 
    res.send("Test triggered! Check your Render logs and ESP32.");
});

// --- 3. DEVICE POLLING (For your ESP32) ---
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;
    if (deviceQueues[deviceId] && deviceQueues[deviceId].length > 0) {
        const command = deviceQueues[deviceId].shift(); // Get the oldest command
        console.log(`📤 Sending command to ${deviceId}: ${command.presetId}`);
        return res.json(command);
    }
    res.status(204).end(); // No content = no new events
});

// --- 4. REGISTRATION (From Glide) ---
app.post('/register-preset', (req, res) => {
    const { deviceId, trackingTeam, audioUrl, ...presets } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
    
    userMemory[deviceId] = { trackingTeam, audioUrl, presets };
    console.log(`✅ Registered: ${deviceId} watching ${trackingTeam}`);
    res.json({ success: true });
});

// --- 5. TRIGGER FUNCTION ---
function triggerLights(teamName, eventType) {
    console.log(`🚨 EVENT: ${eventType} for ${teamName}`);
    Object.keys(userMemory).forEach(devId => {
        const user = userMemory[devId];
        if (user.trackingTeam === teamName) {
            const command = {
                presetId: `${eventType}_${Date.now()}`,
                settings: { audio: user.audioUrl, ...user.presets }
            };
            if (!deviceQueues[devId]) deviceQueues[devId] = [];
            deviceQueues[devId].push(command);
        }
    });
}

// --- 6. NHL LOGIC ---
async function checkNHL() {
    try {
        const response = await fetch("https://api-web.nhle.com/v1/score/now");
        const data = await response.json();
        if (!data || !Array.isArray(data.games)) return;

        data.games.forEach(game => {
            if (!game.homeTeam || !game.awayTeam) return;

            const homeTeam = game.homeTeam.commonName?.default || game.homeTeam.abbreviation;
            const awayTeam = game.awayTeam.commonName?.default || game.awayTeam.abbreviation;
            const gameKey = `nhl_${game.id}`;
            const homeScore = game.homeTeam.score ?? 0;
            const awayScore = game.awayTeam.score ?? 0;
            const scoreSum = homeScore + awayScore;

            if (!lastProcessedEvents[gameKey]) {
                lastProcessedEvents[gameKey] = { score: scoreSum, home: homeScore, state: game.gameState };
                return;
            }

            if (scoreSum > lastProcessedEvents[gameKey].score) {
                const scoringTeam = (homeScore > lastProcessedEvents[gameKey].home) ? homeTeam : awayTeam;
                triggerLights(scoringTeam, "GOAL");
            }
            
            lastProcessedEvents[gameKey] = { score: scoreSum, home: homeScore, state: game.gameState };
        });
    } catch (e) { console.error("❌ NHL Error:", e.message); }
}

// --- 7. MLB LOGIC ---
async function checkMLB() {
    try {
        const schedRes = await fetch("https://statsapi.mlb.com/api/v1/schedule?sportId=1");
        const schedData = await schedRes.json();
        const activeGames = schedData.dates?.[0]?.games.filter(g => g.status.abstractGameState === "Live") || [];

        for (let game of activeGames) {
            const liveRes = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`);
            const liveData = await liveRes.json();
            const lastPlay = liveData.liveData.plays.allPlays.slice(-1)[0];

            if (lastPlay && lastPlay.about.playId !== lastProcessedEvents[game.gamePk]) {
                const event = lastPlay.result.event;
                const team = lastPlay.team.name.split(' ').pop();

                if (["Home Run", "Strikeout", "Game Over"].includes(event)) {
                    triggerLights(team, event.toUpperCase().replace(' ', '_'));
                }
                lastProcessedEvents[game.gamePk] = lastPlay.about.playId;
            }
        }
    } catch (e) { console.error("❌ MLB Error:", e.message); }
}

// --- 8. LOOPS & START ---
setInterval(() => {
    console.log(`🕒 Heartbeat: ${new Date().toLocaleTimeString()}`);
    checkNHL();
    checkMLB();
}, 20000); // Poll every 20s

app.listen(process.env.PORT || 3000, () => console.log("🚀 Sports Server Running"));
