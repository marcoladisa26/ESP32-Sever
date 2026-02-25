const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.RENDER 
    ? '/tmp/lighting.db' 
    : path.join(__dirname, '../data/lighting.db');

const db = new Database(dbPath);

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