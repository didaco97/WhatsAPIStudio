const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "trulychat.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma("journal_mode = WAL");

// ===== CREATE TABLES =====
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_active TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT,
    type TEXT NOT NULL,
    body TEXT,
    reply TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_id);
`);

console.log("Database ready:", DB_PATH);

// ===== CONTACTS =====
const upsertContactStmt = db.prepare(`
  INSERT INTO contacts (id, name, last_active)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    name = COALESCE(excluded.name, contacts.name),
    last_active = datetime('now')
`);

function upsertContact(id, name) {
  upsertContactStmt.run(id, name || null);
}

function getContacts() {
  return db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM messages WHERE contact_id = c.id) as message_count,
      (SELECT body FROM messages WHERE contact_id = c.id AND type = 'incoming' ORDER BY id DESC LIMIT 1) as last_msg
    FROM contacts c
    ORDER BY c.last_active DESC
  `).all();
}

// ===== MESSAGES (activity log) =====
const saveMessageStmt = db.prepare(`
  INSERT INTO messages (contact_id, type, body, reply, error)
  VALUES (?, ?, ?, ?, ?)
`);

function saveMessage(contactId, type, body, reply, error) {
  return saveMessageStmt.run(contactId, type, body || null, reply || null, error || null);
}

function getMessages(contactId, limit = 200) {
  if (contactId) {
    return db.prepare(`
      SELECT m.*, c.name as contact_name
      FROM messages m
      LEFT JOIN contacts c ON m.contact_id = c.id
      WHERE m.contact_id = ?
      ORDER BY m.id DESC LIMIT ?
    `).all(contactId, limit).reverse();
  }
  return db.prepare(`
    SELECT m.*, c.name as contact_name
    FROM messages m
    LEFT JOIN contacts c ON m.contact_id = c.id
    ORDER BY m.id DESC LIMIT ?
  `).all(limit).reverse();
}

// ===== CONVERSATIONS (bot memory) =====
const saveConvStmt = db.prepare(`
  INSERT INTO conversations (contact_id, role, content)
  VALUES (?, ?, ?)
`);

function saveConversation(contactId, role, content) {
  saveConvStmt.run(contactId, role, content);
}

function getConversationHistory(contactId, limit = 40) {
  return db.prepare(`
    SELECT role, content FROM conversations
    WHERE contact_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(contactId, limit).reverse();
}

function clearConversationHistory(contactId) {
  if (contactId) {
    db.prepare("DELETE FROM conversations WHERE contact_id = ?").run(contactId);
  } else {
    db.prepare("DELETE FROM conversations").run();
  }
}

// ===== SETTINGS =====
function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function clearMessages(contactId) {
  if (contactId) {
    db.prepare("DELETE FROM messages WHERE contact_id = ?").run(contactId);
  } else {
    db.prepare("DELETE FROM messages").run();
  }
}

module.exports = {
  db,
  upsertContact,
  getContacts,
  saveMessage,
  getMessages,
  clearMessages,
  saveConversation,
  getConversationHistory,
  clearConversationHistory,
  getSetting,
  setSetting,
};
