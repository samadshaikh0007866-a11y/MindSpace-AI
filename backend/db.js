/*
 * db.js — SQLite database setup for MindSpace
 *
 * Schema:
 *   users      — registered accounts (email unique, password hashed with bcrypt)
 *   mood_logs  — per-user mood check-ins (one per user per day, latest kept)
 *   activities — per-user wellness activity completions
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "mindspace.db");

/* Ensure the data folder exists */

const fs = require("fs");

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

const db = new Database(DB_PATH);

/* Enforce foreign keys and journal mode */

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ===== Schema ===== */

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password    TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mood_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        mood        TEXT    NOT NULL,
        label       TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activities (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        name        TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mood_logs_user
        ON mood_logs(user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_activities_user
        ON activities(user_id, created_at);
`);

/* ===== Prepared statements ===== */

const stmts = {
    createUser: db.prepare(
        "INSERT INTO users (name, email, password) VALUES (?, ?, ?)"
    ),

    findByEmail: db.prepare(
        "SELECT * FROM users WHERE LOWER(email) = LOWER(?)"
    ),

    findById: db.prepare("SELECT * FROM users WHERE id = ?"),

    logMood: db.prepare(
        "INSERT INTO mood_logs (user_id, mood, label) VALUES (?, ?, ?)"
    ),

    listMoods: db.prepare(`
        SELECT * FROM mood_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 30
    `),

    latestMood: db.prepare(`
        SELECT * FROM mood_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `),

    completeActivity: db.prepare(
        "INSERT INTO activities (user_id, name) VALUES (?, ?)"
    ),

    listActivities: db.prepare(`
        SELECT * FROM activities
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 30
    `),

    countActivitiesToday: db.prepare(`
        SELECT COUNT(*) AS total FROM activities
        WHERE user_id = ? AND date(created_at) = date('now')
    `),
};

module.exports = { db, stmts };
