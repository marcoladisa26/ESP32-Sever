const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// On Free Tier, we'll store the DB in the /tmp folder 
// or the current directory. /tmp is usually more reliable for writes.
const dbPath = process.env.RENDER 
    ? '/tmp/lighting.db' 
    : path.join(__dirname, '../data/lighting.db');

console.log("Free Tier: Attempting to use database at:", dbPath);

let db;
try {
    db = new Database(dbPath);
    console.log("✅ Database connected successfully.");
} catch (err) {
    console.error("❌ Database failed. Falling back to RAM-only mode.", err);
    db = new Database(':memory:'); 
}

// Create Tables
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