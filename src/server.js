const express = require('express');
const app = express();
app.use(express.json());

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
// No need to require('node-fetch') anymore!

async function checkNHL() {
    try {
        // Native fetch works out of the box in Node 24
        const response = await fetch("https://api-web.nhle.com/v1/score/now");
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        
        data.games.forEach(game => {
            const homeTeam = game.homeTeam.commonName.default;
            const awayTeam = game.awayTeam.commonName.default;
            
            // Your goal detection logic...
            console.log(`Checking game: ${homeTeam} vs ${awayTeam}`);
        });
    } catch (error) {
        console.error("NHL API Fetch Error:", error.message);
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

app.listen(process.env.PORT || 3000, () => console.log("Sports Server Running"));