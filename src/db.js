const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 1. Determine the path. 
// If on Render, use the Disk path. If local, use the project data folder.
const dataDir = process.env.RENDER 
    ? '/opt/render/project/src/data' 
    : path.join(__dirname, '../data');

console.log("Attempting to use database directory:", dataDir);

// 2. Create directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log("Created directory successfully.");
    } catch (err) {
        console.error("CRITICAL ERROR: Could not create data directory", err);
    }
}

// 3. Open the database with better error logging
let db;
try {
    const dbPath = path.join(dataDir, 'lighting.db');
    db = new Database(dbPath);
    console.log("✅ Database connected successfully at:", dbPath);
} catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err.message);
    // If the Disk path failed, let's try a local fallback so the app doesn't die
    console.log("Attempting fallback to local memory-style DB...");
    db = new Database(':memory:'); 
}

// 4. Create Tables
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