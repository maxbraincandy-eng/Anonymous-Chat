const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  secret     TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname   TEXT NOT NULL,
  content    TEXT NOT NULL,
  reply_to   INTEGER REFERENCES chat_messages(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  emoji       TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (target_type, target_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_messages_profile ON messages(profile_id);
CREATE INDEX IF NOT EXISTS idx_comments_message ON comments(message_id);
`);

// მიგრაცია ძველი ბაზებისთვის, სადაც chat_messages-ს reply_to სვეტი ჯერ არ აქვს
const chatColumns = db.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name);
if (!chatColumns.includes('reply_to')) {
  db.exec('ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER REFERENCES chat_messages(id)');
}

module.exports = db;
