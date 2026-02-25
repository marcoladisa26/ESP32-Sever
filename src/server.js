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
    const commands = db.prepare('SELECT id, presetId FROM commands WHERE deviceId = ? ORDER BY timestamp ASC').all(deviceId);

    if (commands.length > 0) {
        const ids = commands.map(c => c.id);
        db.prepare(`DELETE FROM commands WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        return res.json({ count: commands.length, commands: commands.map(c => c.presetId) });
    }
    res.json({ count: 0, commands: [] });
});

// Ensure we only listen ONCE
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ ACTUAL SERVER STARTED ON PORT: ${PORT}`);
    });
}