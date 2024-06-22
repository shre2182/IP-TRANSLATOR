const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(':memory:'); // Use ':memory:' for an in-memory database

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS ip_info (
        ip TEXT PRIMARY KEY,
        city TEXT,
        region TEXT,
        country TEXT
    )`);
});

module.exports = db;
