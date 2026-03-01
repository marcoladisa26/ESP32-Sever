const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Server is up! 🚀'));

// --- SAVE PRESET ROUTE ---
app.post('/preset/save', (req, res) => {
    try {
        const getValue = (key) => {
            const val = req.body.params?.[key] || req.body[key];
            return (val && typeof val === 'object' && 'value' in val) ? val.value : val;
        };

        const deviceId = getValue('deviceId');
        const presetId = (getValue('presetId') || "").toString().trim();

        const rawData = { ...req.body.params, ...req.body };
        const cleanData = {};
        
        Object.keys(rawData).forEach(key => {
            const val = rawData[key];
            cleanData[key] = (val && typeof val === 'object' && 'value' in val) ? val.value : val;
        });

        console.log(`📥 Saving Preset: ${presetId} for ${deviceId}`);
        
        const query = db.prepare('INSERT OR REPLACE INTO presets (id, deviceId, data) VALUES (?, ?, ?)');
        query.run(presetId, deviceId, JSON.stringify(cleanData));

        res.json({ status: "success", savedId: presetId });
    } catch (err) {
        console.error("❌ Save Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- TRIGGER PRESET ROUTE ---
app.post('/preset/trigger', (req, res) => {
    try {
        const getValue = (key) => {
            const val = req.body.params?.[key] || req.body[key];
            return (val && typeof val === 'object' && 'value' in val) ? val.value : val;
        };

        const deviceId = getValue('deviceId');
        const presetId = getValue('presetId');

        if (!deviceId || !presetId) {
            return res.status(400).json({ error: "Missing deviceId or presetId" });
        }

        console.log(`🚀 Triggering Preset: ${presetId} for ${deviceId}`);

        // Add the command to the queue for the ESP32 to find later
        const query = db.prepare('INSERT INTO commands (deviceId, presetId) VALUES (?, ?)');
        query.run(deviceId, presetId);

        res.json({ status: "success", triggered: presetId });
    } catch (err) {
        console.error("❌ Trigger Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- DEVICE POLL ROUTE ---
app.get('/device/poll', (req, res) => {
    try {
        const { deviceId } = req.query;
        if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

        const commands = db.prepare('SELECT * FROM commands WHERE deviceId = ? ORDER BY timestamp ASC').all(deviceId);

        if (commands.length > 0) {
            const fullCommands = commands.map(cmd => {
                const preset = db.prepare('SELECT data FROM presets WHERE id = ? AND deviceId = ?')
                                 .get(cmd.presetId, deviceId);

                if (!preset) {
                    console.log(`⚠️ Command for '${cmd.presetId}' found, but no saved preset details.`);
                }

                return {
                    presetId: cmd.presetId,
                    settings: preset ? JSON.parse(preset.data) : {}
                };
            });

            const idsToDelete = commands.map(c => c.id);
            db.prepare(`DELETE FROM commands WHERE id IN (${idsToDelete.map(() => '?').join(',')})`).run(...idsToDelete);

            return res.json({ count: fullCommands.length, commands: fullCommands });
        }
        
        res.json({ count: 0, commands: [] });
    } catch (err) {
        console.error("❌ Poll Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Ensure we only listen ONCE
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ ACTUAL SERVER STARTED ON PORT: ${PORT}`);
    });
}