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
// ... (keep your existing routes) ...

// Updated Save Route with Logging
app.post('/preset/save', (req, res) => {
    console.log("📥 RECEIVED SAVE REQUEST FROM GLIDE");
    console.log("Body:", JSON.stringify(req.body)); // This will show in Render logs

    const deviceId = req.body.deviceId || req.body.params?.deviceId?.value;
    const presetId = req.body.presetId || req.body.params?.presetId?.value;
    
    // Check if we actually got data
    if (!deviceId || !presetId) {
        console.log("❌ REJECTED: Missing deviceId or presetId");
        return res.status(400).json({ error: "Missing IDs" });
    }

    const data = req.body.params ? req.body.params : req.body;
    const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
    query.run(presetId, deviceId, JSON.stringify(data));
    
    console.log(`✅ SUCCESSFULLY SAVED PRESET: ${presetId}`);
    res.json({ status: "saved", deviceId, presetId });
});

// Update the listen block to be ultra-compatible
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SERVER IS LIVE`);
    console.log(`PORT: ${PORT}`);
});

// TRIGGER: From Glide or API
app.post('/preset/trigger', (req, res) => {
    const deviceId = req.body.deviceId || req.body.params?.deviceId?.value;
    // This allows you to send the 'Event' name as the presetId
    const presetId = req.body.presetId || req.body.params?.presetId?.value;

    if (!deviceId || !presetId) return res.status(400).json({ error: "Missing IDs" });

    // Look for a preset that matches this event name for this device
    const preset = db.prepare('SELECT id FROM presets WHERE id = ? AND deviceId = ?').get(presetId, deviceId);

    if (!preset) {
        console.log(`Warning: Triggered '${presetId}' but no preset details found.`);
        // We still queue it, so the ESP32 knows 'something' happened
    }

    const query = db.prepare('INSERT INTO commands (deviceId, presetId) VALUES (?, ?)');
    query.run(deviceId, presetId);
    
    console.log(`🚀 Triggered event: ${presetId} for ${deviceId}`);
    res.json({ status: "queued", event: presetId });
});

// ESP32: Poll for multiple commands
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    // This query finds pending commands AND joins them with the actual preset data
    const commands = db.prepare(`
        SELECT c.id, c.presetId, p.data 
        FROM commands c
        LEFT JOIN presets p ON c.presetId = p.id AND c.deviceId = p.deviceId
        WHERE c.deviceId = ? 
        ORDER BY c.timestamp ASC
    `).all(deviceId);

    if (commands.length > 0) {
        const idsToDelete = commands.map(c => c.id);
        const deleteStmt = db.prepare(`DELETE FROM commands WHERE id IN (${idsToDelete.map(() => '?').join(',')})`);
        deleteStmt.run(...idsToDelete);

        // Map the results so the ESP32 gets the full preset details
        const fullCommands = commands.map(c => ({
            presetId: c.presetId,
            settings: c.data ? JSON.parse(c.data) : {}
        }));

        return res.json({ count: fullCommands.length, commands: fullCommands });
    }
    res.json({ count: 0, commands: [] });
});

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`✅ Server is live on http://${HOST}:${PORT}`);
});