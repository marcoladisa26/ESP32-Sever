const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors()); // Allows Glide to talk to your server
app.use(express.json());

const PORT = process.env.PORT || 3000;

// GLIDE: Save a preset
app.post('/preset/save', (req, res) => {
    const { deviceId, presetId, ...presetData } = req.body;
    if (!deviceId || !presetId) return res.status(400).send("Missing IDs");

    const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
    query.run(presetId, deviceId, JSON.stringify(presetData));
    
    res.json({ status: "saved", deviceId, presetId });
});

// GLIDE/SPORTS API: Trigger a light show
app.post('/preset/trigger', (req, res) => {
    // This line handles BOTH standard JSON and Glide's weird format
    const deviceId = req.body.deviceId || req.body.params?.deviceId?.value;
    const presetId = req.body.presetId || req.body.params?.presetId?.value;

    if (!deviceId || !presetId) return res.status(400).send("Missing IDs");

    const query = db.prepare('INSERT INTO commands (deviceId, presetId) VALUES (?, ?)');
    query.run(deviceId, presetId);
    
    res.json({ status: "queued" });
});

// ESP32: Polling for updates
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;

    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    // 1. Get ALL commands for this device, sorted by oldest first
    const commands = db.prepare('SELECT id, presetId FROM commands WHERE deviceId = ? ORDER BY timestamp ASC')
                       .all(deviceId);

    if (commands.length > 0) {
        // 2. Extract the IDs so we can delete them
        const idsToDelete = commands.map(c => c.id);
        
        // 3. Delete these specific commands from the DB so they don't repeat
        const deleteStmt = db.prepare(`DELETE FROM commands WHERE id IN (${idsToDelete.map(() => '?').join(',')})`);
        deleteStmt.run(...idsToDelete);

        // 4. Return the list of presetIds to the ESP32
        // Format: { "commands": ["goal_habs", "win_celebration"] }
        return res.json({ 
            count: commands.length,
            commands: commands.map(c => c.presetId) 
        });
    }

    // If no commands, return an empty list
    res.json({ count: 0, commands: [] });
});