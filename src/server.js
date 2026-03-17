const express = require('express');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    console.log(`📥 Incoming ${req.method} request to ${req.url}`);
    next();
});

let userMemory = {}; // Stores { deviceId: { trackingTeam, presets } }
let deviceQueues = {}; 
let lastProcessedEvents = {}; // Tracks event IDs to prevent double-triggers

// --- REGISTRATION (From Glide) ---
app.post('/register-preset', (req, res) => {
    const { deviceId, trackingTeam, audioUrl, ...presets } = req.body;
    userMemory[deviceId] = { trackingTeam, audioUrl, presets };
    res.json({ success: true });
});

// --- TRIGGER FUNCTION ---
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

// --- NHL LOGIC (Goals & Period Starts) ---
async function checkNHL() {
    try {
        const response = await fetch("https://api-web.nhle.com/v1/score/now");
        const data = await response.json();
        
        // Check if 'games' exists and is an array
        if (!data || !Array.isArray(data.games)) {
            console.log("🏒 NHL: No games found in current response.");
            return;
        }

        data.games.forEach(game => {
            // SAFE ACCESS: If homeTeam or awayTeam is missing, skip this loop
            if (!game.homeTeam || !game.awayTeam) return;

            // Try to find a name, fallback to abbreviation (TOR, NYR, etc.)
            const homeTeam = game.homeTeam.commonName?.default || game.homeTeam.abbreviation || "Unknown";
            const awayTeam = game.awayTeam.commonName?.default || game.awayTeam.abbreviation || "Unknown";
            
            const gameKey = `nhl_${game.id}`;
            const homeScore = game.homeTeam.score ?? 0;
            const awayScore = game.awayTeam.score ?? 0;
            const scoreSum = homeScore + awayScore;

            // Initialize tracker for new games
            if (!lastProcessedEvents[gameKey]) {
                lastProcessedEvents[gameKey] = { score: scoreSum, home: homeScore, state: game.gameState };
                return;
            }

            // 1. Detect Goals
            if (scoreSum > lastProcessedEvents[gameKey].score) {
                const scoringTeam = (homeScore > lastProcessedEvents[gameKey].home) ? homeTeam : awayTeam;
                triggerLights(scoringTeam, "GOAL");
            }
            
            // 2. Detect Game/Period Start
            if (game.gameState === "LIVE" && lastProcessedEvents[gameKey].state === "FUT") {
                triggerLights(homeTeam, "GAME_START");
                triggerLights(awayTeam, "GAME_START");
            }

            // Update tracker
            lastProcessedEvents[gameKey] = { 
                score: scoreSum, 
                home: homeScore, 
                state: game.gameState 
            };
        });
    } catch (e) { 
        console.error("❌ NHL Poll Failed:", e.message); 
    }
}

// --- MLB LOGIC (Home Runs, Strikeouts, Game Start) ---
async function checkMLB() {
    try {
        // 1. Get today's games
        const schedRes = await fetch("https://statsapi.mlb.com/api/v1/schedule?sportId=1");
        const schedData = await schedRes.json();
        const activeGames = schedData.dates[0]?.games.filter(g => g.status.abstractGameState === "Live") || [];

        for (let game of activeGames) {
            const liveRes = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`);
            const liveData = await liveRes.json();
            const lastPlay = liveData.liveData.plays.allPlays.slice(-1)[0];

            if (lastPlay && lastPlay.about.playId !== lastProcessedEvents[game.gamePk]) {
                const event = lastPlay.result.event; // "Home Run", "Strikeout", etc.
                const team = lastPlay.team.name.split(' ').pop(); // Gets "Blue Jays" from "Toronto Blue Jays"

                if (["Home Run", "Strikeout", "Game Over"].includes(event)) {
                    triggerLights(team, event.toUpperCase().replace(' ', '_'));
                }
                lastProcessedEvents[game.gamePk] = lastPlay.about.playId;
            }
        }
    } catch (e) { console.error("MLB Error", e); }
}

// --- LOOPS ---
setInterval(checkNHL, 15000); // Poll NHL every 15s
setInterval(checkMLB, 15000); // Poll MLB every 15s

console.log(`🕒 Heartbeat: Checking sports at ${new Date().toLocaleTimeString()}`);

app.listen(process.env.PORT || 3000, () => console.log("Sports Server Running"));
