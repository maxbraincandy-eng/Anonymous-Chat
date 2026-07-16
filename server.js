const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

const MAX_CONTENT = 1000;
const MAX_NAME = 40;

function cleanText(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function makeSlug(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9Ⴀ-ჿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'user';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

// ---------- profile API ----------

// ლინკის შექმნა
app.post('/api/profiles', (req, res) => {
  const name = cleanText(req.body.name, MAX_NAME);
  if (!name) return res.status(400).json({ error: 'სახელი სავალდებულოა (მაქს. 40 სიმბოლო)' });

  const slug = makeSlug(name);
  const secret = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO profiles (slug, name, secret) VALUES (?, ?, ?)').run(slug, name, secret);
  res.status(201).json({ slug, secret });
});

// პროფილი + საჯარო შეტყობინებები კომენტარებით
app.get('/api/profiles/:slug', (req, res) => {
  const profile = db.prepare('SELECT id, slug, name FROM profiles WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'პროფილი ვერ მოიძებნა' });

  const messages = db
    .prepare('SELECT id, content, created_at FROM messages WHERE profile_id = ? ORDER BY id DESC LIMIT 200')
    .all(profile.id);
  const getComments = db.prepare(
    'SELECT id, content, created_at FROM comments WHERE message_id = ? ORDER BY id ASC LIMIT 100'
  );
  for (const m of messages) m.comments = getComments.all(m.id);

  res.json({ slug: profile.slug, name: profile.name, messages });
});

// ანონიმური შეტყობინების გაგზავნა
app.post('/api/profiles/:slug/messages', (req, res) => {
  const profile = db.prepare('SELECT id FROM profiles WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'პროფილი ვერ მოიძებნა' });

  const content = cleanText(req.body.content, MAX_CONTENT);
  if (!content) return res.status(400).json({ error: 'შეტყობინება ცარიელია ან ძალიან გრძელია' });

  const info = db.prepare('INSERT INTO messages (profile_id, content) VALUES (?, ?)').run(profile.id, content);
  const message = db.prepare('SELECT id, content, created_at FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(message);
});

// ანონიმური კომენტარი შეტყობინებაზე
app.post('/api/messages/:id/comments', (req, res) => {
  const message = db.prepare('SELECT id FROM messages WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });

  const content = cleanText(req.body.content, MAX_CONTENT);
  if (!content) return res.status(400).json({ error: 'კომენტარი ცარიელია ან ძალიან გრძელია' });

  const info = db.prepare('INSERT INTO comments (message_id, content) VALUES (?, ?)').run(message.id, content);
  const comment = db.prepare('SELECT id, content, created_at FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(comment);
});

// ---------- owner (inbox) API ----------

function findProfileBySecret(secret) {
  if (typeof secret !== 'string' || !secret) return null;
  return db.prepare('SELECT id, slug, name FROM profiles WHERE secret = ?').get(secret);
}

app.get('/api/inbox/:secret', (req, res) => {
  const profile = findProfileBySecret(req.params.secret);
  if (!profile) return res.status(404).json({ error: 'არასწორი ბმული' });

  const messages = db
    .prepare('SELECT id, content, created_at FROM messages WHERE profile_id = ? ORDER BY id DESC LIMIT 500')
    .all(profile.id);
  const getComments = db.prepare(
    'SELECT id, content, created_at FROM comments WHERE message_id = ? ORDER BY id ASC LIMIT 100'
  );
  for (const m of messages) m.comments = getComments.all(m.id);

  res.json({ slug: profile.slug, name: profile.name, messages });
});

app.delete('/api/inbox/:secret/messages/:id', (req, res) => {
  const profile = findProfileBySecret(req.params.secret);
  if (!profile) return res.status(404).json({ error: 'არასწორი ბმული' });

  const info = db
    .prepare('DELETE FROM messages WHERE id = ? AND profile_id = ?')
    .run(req.params.id, profile.id);
  if (!info.changes) return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });
  res.json({ ok: true });
});

// ---------- anonymous chat API ----------

// ონლაინ ვიზიტორები (მეხსიერებაში): ნიკი → ბოლო აქტივობის დრო
const chatPresence = new Map();
const PRESENCE_TTL = 45 * 1000;

function touchPresence(nick) {
  if (nick) chatPresence.set(nick, Date.now());
}

function onlineCount() {
  const cutoff = Date.now() - PRESENCE_TTL;
  let count = 0;
  for (const [nick, seenAt] of chatPresence) {
    if (seenAt < cutoff) chatPresence.delete(nick);
    else count++;
  }
  return count;
}

const CHAT_SELECT = `
  SELECT c.id, c.nickname, c.content, c.created_at, c.reply_to,
         r.nickname AS reply_nickname, r.content AS reply_content
  FROM chat_messages c
  LEFT JOIN chat_messages r ON r.id = c.reply_to
`;

app.get('/api/chat', (req, res) => {
  touchPresence(cleanText(req.query.nick, MAX_NAME));

  const after = Number.parseInt(req.query.after, 10);
  let rows;
  if (Number.isInteger(after) && after > 0) {
    rows = db.prepare(`${CHAT_SELECT} WHERE c.id > ? ORDER BY c.id ASC LIMIT 200`).all(after);
  } else {
    rows = db.prepare(`${CHAT_SELECT} ORDER BY c.id DESC LIMIT 100`).all().reverse();
  }
  res.json({ online: onlineCount(), messages: rows });
});

app.post('/api/chat', (req, res) => {
  const nickname = cleanText(req.body.nickname, MAX_NAME) || 'ანონიმი';
  const content = cleanText(req.body.content, MAX_CONTENT);
  if (!content) return res.status(400).json({ error: 'შეტყობინება ცარიელია ან ძალიან გრძელია' });

  let replyTo = null;
  if (req.body.reply_to != null) {
    const target = db.prepare('SELECT id FROM chat_messages WHERE id = ?').get(req.body.reply_to);
    if (target) replyTo = target.id;
  }

  touchPresence(nickname);
  const info = db
    .prepare('INSERT INTO chat_messages (nickname, content, reply_to) VALUES (?, ?, ?)')
    .run(nickname, content, replyTo);
  const message = db.prepare(`${CHAT_SELECT} WHERE c.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(message);
});

// ---------- public stats (მთავარი გვერდისთვის) ----------

app.get('/api/stats', (_req, res) => {
  const profiles = db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n;
  const messages =
    db.prepare('SELECT COUNT(*) AS n FROM messages').get().n +
    db.prepare('SELECT COUNT(*) AS n FROM comments').get().n +
    db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n;
  res.json({ profiles, messages, online: onlineCount() });
});

// ---------- pages ----------

app.get('/u/:slug', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/inbox/:secret', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'inbox.html')));
app.get('/chat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

app.listen(PORT, () => {
  console.log(`ანონიმური საიტი გაშვებულია: http://localhost:${PORT}`);
});
