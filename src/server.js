const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// IMPORTANT: Use 0.0.0.0 to make sure Render can see the app
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 

// Heartbeat route to check in browser
app.get('/', (req, res) => {
    res.send('Server is up and running! 🚀');
});

// GLIDE: Save a preset
app.post('/preset/save', (req, res) => {
    const deviceId = req.body.deviceId || req.body.params?.deviceId?.value;
    const presetId = req.body.presetId || req.body.params?.presetId?.value;
    const data = req.body.params ? req.body.params : req.body;

    if (!deviceId || !presetId) return res.status(400).json({ error: "Missing IDs" });

    const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
    query.run(presetId, deviceId, JSON.stringify(data));
    
    res.json({ status: "saved", deviceId, presetId });
});

// TRIGGER: From Glide or API
app.post('/preset/trigger', (req, res) => {
    const deviceId = req.body.deviceId || req.body.params?.deviceId?.value;
    const presetId = req.body.presetId || req.body.params?.presetId?.value;

    if (!deviceId || !presetId) return res.status(400).json({ error: "Missing IDs" });

    const query = db.prepare('INSERT INTO commands (deviceId, presetId) VALUES (?, ?)');
    query.run(deviceId, presetId);
    
    res.json({ status: "queued", deviceId, presetId });
});

// ESP32: Poll for multiple commands
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    const commands = db.prepare('SELECT id, presetId FROM commands WHERE deviceId = ? ORDER BY timestamp ASC').all(deviceId);

    if (commands.length > 0) {
        const idsToDelete = commands.map(c => c.id);
        const deleteStmt = db.prepare(`DELETE FROM commands WHERE id IN (${idsToDelete.map(() => '?').join(',')})`);
        deleteStmt.run(...idsToDelete);

        return res.json({ count: commands.length, commands: commands.map(c => c.presetId) });
    }
    res.json({ count: 0, commands: [] });
});

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`✅ Server is live on http://${HOST}:${PORT}`);
});