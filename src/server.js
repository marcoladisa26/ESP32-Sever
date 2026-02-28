const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Server is up! 🚀'));

// GLIDE SAVE
app.post('/preset/save', (req, res) => {
    console.log("📥 Save Request:", req.body);
    const deviceId = req.body.deviceId || req.body.params?.deviceId?.value;
    const presetId = req.body.presetId || req.body.params?.presetId?.value;
    
    if (!deviceId || !presetId) return res.status(400).json({ error: "Missing IDs" });

    const data = req.body.params ? req.body.params : req.body;
    db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)')
      .run(presetId, deviceId, JSON.stringify(data));
    
    res.json({ status: "saved" });
});

// Change 'app.post' to 'app.all' so it accepts both GET and POST
app.all('/preset/trigger', (req, res) => {
    // This line looks for data in the URL (query) OR the body (webhook)
    const deviceId = req.query.deviceId || req.body.deviceId || req.body.params?.deviceId?.value;
    const presetId = req.query.presetId || req.body.presetId || req.body.params?.presetId?.value;

    console.log(`Trigger Attempt - Device: ${deviceId}, Preset: ${presetId}`);

    if (!deviceId || !presetId) {
        return res.status(400).json({ error: "Missing deviceId or presetId" });
    }

    const query = db.prepare('INSERT INTO commands (deviceId, presetId) VALUES (?, ?)');
    query.run(deviceId, presetId);
    
    res.json({ status: "queued", deviceId, presetId });
});

// POLL
app.get('/device/poll', (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    // Get commands and join with the actual preset data
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

        // Convert the stringified data back into JSON for the ESP32
        const fullCommands = commands.map(c => ({
            presetId: c.presetId,
            settings: c.data ? JSON.parse(c.data) : {}
        }));

        console.log(`📡 Sending ${fullCommands.length} full presets to ${deviceId}`);
        return res.json({ count: fullCommands.length, commands: fullCommands });
    }
    res.json({ count: 0, commands: [] });
});

// Ensure we only listen ONCE
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ ACTUAL SERVER STARTED ON PORT: ${PORT}`);
    });
}