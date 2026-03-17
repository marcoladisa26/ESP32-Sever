app.use((req, res, next) => {
    console.log(`📥 Incoming ${req.method} request to ${req.url}`);
    next();
});
const express = require('express');
const { getAllDevicesFromDB } = require('./db');
const app = express();

app.use(express.json());

let sportsState = { mlb: {}, nhl: {} };
let deviceQueues = {}; // Temporary storage for commands

// --- 1. THE DISPATCHER ---
// This builds the custom 4-sequence command based on user settings
async function triggerSportsEvent(league, homeTeam, awayTeam) {
    console.log(`🚨 ${league} Score Change: ${homeTeam} vs ${awayTeam}`);
    
    const allDevices = await getAllDevicesFromDB();
    const teamsInGame = [homeTeam, awayTeam];

    allDevices.forEach(device => {
        // Does the user follow one of these teams?
        if (teamsInGame.includes(device.trackingTeam)) {
            console.log(`✅ Match! Pushing preset for ${device.deviceId}`);

            const customPreset = {
                presetId: `Auto_${league}_${Date.now()}`,
                settings: {
                    audio: device.audioUrl,
                    // Map your database columns to the ESP32 format
                    seq1_effect: device.seq1_eff, seq1_color1: device.seq1_c1, 
                    seq1_color2: device.seq1_c2, seq1_duration: device.seq1_dur, seq1_speed: device.seq1_spd,
                    
                    seq2_effect: device.seq2_eff, seq2_color1: device.seq2_c1, 
                    seq2_color2: device.seq2_c2, seq2_duration: device.seq2_dur, seq2_speed: device.seq2_spd,
                    
                    seq3_effect: device.seq3_eff, seq3_color1: device.seq3_c1, 
                    seq3_color2: device.seq3_c2, seq3_duration: device.seq3_dur, seq3_speed: device.seq3_spd,
                    
                    seq4_effect: device.seq4_eff, seq4_color1: device.seq4_c1, 
                    seq4_color2: device.seq4_c2, seq4_duration: device.seq4_dur, seq4_speed: device.seq4_spd
                }
            };

            if (!deviceQueues[device.deviceId]) deviceQueues[device.deviceId] = [];
            deviceQueues[device.deviceId].push(customPreset);
        }
    });
}

// --- 2. SPORTS SCRAPERS ---
async function checkSports() {
    // MLB Poll
    try {
        const res = await fetch("https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1");
        const data = await res.json();
        const games = data.dates?.[0]?.games || [];
        games.forEach(game => {
            const id = game.gamePk;
            const score = (game.teams.home.score || 0) + (game.teams.away.score || 0);
            if (sportsState.mlb[id] !== undefined && score > sportsState.mlb[id]) {
                triggerSportsEvent("MLB", game.teams.home.team.name, game.teams.away.team.name);
            }
            sportsState.mlb[id] = score;
        });
    } catch (e) { console.log("MLB Error"); }

    // NHL Poll
    try {
        const res = await fetch("https://api-web.nhle.com/v1/score/now");
        const data = await res.json();
        data.games.forEach(game => {
            const id = game.id;
            const score = (game.homeTeam.score || 0) + (game.awayTeam.score || 0);
            if (sportsState.nhl[id] !== undefined && score > sportsState.nhl[id]) {
                triggerSportsEvent("NHL", game.homeTeam.commonName.default, game.awayTeam.commonName.default);
            }
            sportsState.nhl[id] = score;
        });
    } catch (e) { console.log("NHL Error"); }
}

// --- 3. ESP32 ENDPOINT ---
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;
    if (!deviceQueues[deviceId]) deviceQueues[deviceId] = [];
    
    // Send all waiting commands and clear the queue
    const commands = [...deviceQueues[deviceId]];
    deviceQueues[deviceId] = [];
    res.json({ commands });
});

// Start checking sports every 20 seconds
setInterval(checkSports, 20000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));