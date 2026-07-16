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

app.get('/api/chat', (req, res) => {
  const after = Number.parseInt(req.query.after, 10);
  let rows;
  if (Number.isInteger(after) && after > 0) {
    rows = db
      .prepare('SELECT id, nickname, content, created_at FROM chat_messages WHERE id > ? ORDER BY id ASC LIMIT 200')
      .all(after);
  } else {
    rows = db
      .prepare('SELECT id, nickname, content, created_at FROM chat_messages ORDER BY id DESC LIMIT 100')
      .all()
      .reverse();
  }
  res.json(rows);
});

app.post('/api/chat', (req, res) => {
  const nickname = cleanText(req.body.nickname, MAX_NAME) || 'ანონიმი';
  const content = cleanText(req.body.content, MAX_CONTENT);
  if (!content) return res.status(400).json({ error: 'შეტყობინება ცარიელია ან ძალიან გრძელია' });

  const info = db.prepare('INSERT INTO chat_messages (nickname, content) VALUES (?, ?)').run(nickname, content);
  const message = db
    .prepare('SELECT id, nickname, content, created_at FROM chat_messages WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(message);
});

// ---------- pages ----------

app.get('/u/:slug', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/inbox/:secret', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'inbox.html')));
app.get('/chat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

app.listen(PORT, () => {
  console.log(`ანონიმური საიტი გაშვებულია: http://localhost:${PORT}`);
});
