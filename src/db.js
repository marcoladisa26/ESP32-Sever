const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path for Render's persistent disk
const dataDir = process.env.RENDER ? '/opt/render/project/src/data' : path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'lighting.db'));

// Create the tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS presets (
    id TEXT,
    deviceId TEXT,
    data TEXT,
    PRIMARY KEY (id, deviceId)
  );
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceId TEXT,
    presetId TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;