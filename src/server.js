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
    try {
        // Helper to grab values from Glide's nested structure
        const getValue = (key) => {
            const val = req.body.params?.[key] || req.body[key];
            return (val && typeof val === 'object' && 'value' in val) ? val.value : val;
        };

        const deviceId = getValue('deviceId');
        const presetId = (getValue('presetId') || "").toString().trim();

        // Combine everything into one data object
        const rawData = { ...req.body.params, ...req.body };
        const cleanData = {};
        
        // Flatten the object so the ESP32 gets simple "key: value" pairs
        Object.keys(rawData).forEach(key => {
            const val = rawData[key];
            cleanData[key] = (val && typeof val === 'object' && 'value' in val) ? val.value : val;
        });

        console.log(`📥 Saving Preset: ${presetId} for ${deviceId}`);
        console.log(`📊 Fields captured: ${Object.keys(cleanData).join(', ')}`);

        const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
        query.run(presetId, deviceId, JSON.stringify(cleanData));

        res.json({ status: "success", savedId: presetId });
    } catch (err) {
        console.error("❌ Save Error:", err);
        res.status(500).json({ error: err.message });
    }
}); // <--- Line 48-ish is usually right here!

    console.log(`📥 Saving Preset: ${presetId} with ${Object.keys(data).length} fields`);

    const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
    query.run(presetId, deviceId, JSON.stringify(data));

    res.json({ status: "success" });
});

    console.log(`📥 Saving Preset: ${presetId} for ${deviceId}`);

    const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
    query.run(presetId, deviceId, JSON.stringify(data));

    res.json({ status: "success" });
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
    const commands = db.prepare('SELECT * FROM commands WHERE deviceId = ?').all(deviceId);

    if (commands.length > 0) {
        const fullCommands = commands.map(cmd => {
            const preset = db.prepare('SELECT data FROM presets WHERE id = ? AND deviceId = ?')
                             .get(cmd.presetId, deviceId);
            return {
                presetId: cmd.presetId, // This becomes the filename on the SD card
                settings: preset ? JSON.parse(preset.data) : {}
            };
        });

        // Clear the commands after sending
        const ids = commands.map(c => c.id);
        db.prepare(`DELETE FROM commands WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

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