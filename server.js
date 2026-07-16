const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway/Render/Fly-ს პროქსის უკან ვართ — req.ip რეალური კლიენტის IP იყოს
app.set('trust proxy', 1);

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- rate limiting (სპამის დაცვა) ----------

const rateBuckets = new Map(); // "bucket:ip" → { count, resetAt }

function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    let entry = rateBuckets.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'ძალიან სწრაფად წერ 🙈 ცოტა მოიცადე და თავიდან სცადე' });
    }
    next();
  };
}

// ვადაგასული ჩანაწერების გაწმენდა, რომ მეხსიერება არ გაიზარდოს
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets) {
    if (now > entry.resetAt) rateBuckets.delete(key);
  }
}, 60 * 1000).unref();

const limitReactions = rateLimit('react', 60, 60 * 1000);       // 60 რეაქცია / წთ
const limitProfiles = rateLimit('profiles', 5, 10 * 60 * 1000); // 5 ლინკი / 10 წთ
const limitMessages = rateLimit('messages', 6, 60 * 1000);      // 6 წერილი / წთ
const limitComments = rateLimit('comments', 10, 60 * 1000);     // 10 კომენტარი / წთ
const limitChat = rateLimit('chat', 20, 60 * 1000);             // 20 ჩატ-შეტყობინება / წთ
const limitRead = rateLimit('read', 600, 60 * 1000);            // ყველა GET ჯამში

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

// ---------- reactions ----------

const REACTION_EMOJIS = ['❤️', '🔥', '😂', '👀'];

// items-ს (რომლებსაც .id აქვთ) ამაგრებს .reactions ობიექტს: { emoji: count }
function attachReactions(targetType, items) {
  if (!items.length) return;
  const placeholders = items.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT target_id, emoji, count FROM reactions
       WHERE target_type = ? AND count > 0 AND target_id IN (${placeholders})`
    )
    .all(targetType, ...items.map((i) => i.id));
  const map = {};
  for (const r of rows) (map[r.target_id] ??= {})[r.emoji] = r.count;
  for (const item of items) item.reactions = map[item.id] || {};
}

app.post('/api/react', limitReactions, (req, res) => {
  const { type, id, emoji, action } = req.body || {};
  if (type !== 'message' && type !== 'chat') return res.status(400).json({ error: 'არასწორი ტიპი' });
  if (!REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'არასწორი ემოჯი' });
  if (action !== 'add' && action !== 'remove') return res.status(400).json({ error: 'არასწორი მოქმედება' });

  const targetId = Number.parseInt(id, 10);
  const table = type === 'message' ? 'messages' : 'chat_messages';
  const target =
    Number.isInteger(targetId) && targetId > 0
      ? db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId)
      : null;
  if (!target) return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });

  if (action === 'add') {
    db.prepare(
      `INSERT INTO reactions (target_type, target_id, emoji, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(target_type, target_id, emoji) DO UPDATE SET count = count + 1`
    ).run(type, targetId, emoji);
  } else {
    db.prepare(
      `UPDATE reactions SET count = MAX(count - 1, 0)
       WHERE target_type = ? AND target_id = ? AND emoji = ?`
    ).run(type, targetId, emoji);
  }

  const rows = db
    .prepare('SELECT emoji, count FROM reactions WHERE target_type = ? AND target_id = ? AND count > 0')
    .all(type, targetId);
  res.json({ reactions: Object.fromEntries(rows.map((r) => [r.emoji, r.count])) });
});

// ---------- profile API ----------

// ლინკის შექმნა
app.post('/api/profiles', limitProfiles, (req, res) => {
  const name = cleanText(req.body.name, MAX_NAME);
  if (!name) return res.status(400).json({ error: 'სახელი სავალდებულოა (მაქს. 40 სიმბოლო)' });

  const slug = makeSlug(name);
  const secret = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO profiles (slug, name, secret) VALUES (?, ?, ?)').run(slug, name, secret);
  res.status(201).json({ slug, secret });
});

// პროფილი + საჯარო შეტყობინებები კომენტარებით
app.get('/api/profiles/:slug', limitRead, (req, res) => {
  const profile = db.prepare('SELECT id, slug, name FROM profiles WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'პროფილი ვერ მოიძებნა' });

  const messages = db
    .prepare('SELECT id, content, created_at FROM messages WHERE profile_id = ? ORDER BY id DESC LIMIT 200')
    .all(profile.id);
  const getComments = db.prepare(
    'SELECT id, content, created_at FROM comments WHERE message_id = ? ORDER BY id ASC LIMIT 100'
  );
  for (const m of messages) m.comments = getComments.all(m.id);
  attachReactions('message', messages);

  res.json({ slug: profile.slug, name: profile.name, messages });
});

// ანონიმური შეტყობინების გაგზავნა
app.post('/api/profiles/:slug/messages', limitMessages, (req, res) => {
  const profile = db.prepare('SELECT id FROM profiles WHERE slug = ?').get(req.params.slug);
  if (!profile) return res.status(404).json({ error: 'პროფილი ვერ მოიძებნა' });

  const content = cleanText(req.body.content, MAX_CONTENT);
  if (!content) return res.status(400).json({ error: 'შეტყობინება ცარიელია ან ძალიან გრძელია' });

  const info = db.prepare('INSERT INTO messages (profile_id, content) VALUES (?, ?)').run(profile.id, content);
  const message = db.prepare('SELECT id, content, created_at FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(message);
});

// ანონიმური კომენტარი შეტყობინებაზე
app.post('/api/messages/:id/comments', limitComments, (req, res) => {
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

app.get('/api/inbox/:secret', limitRead, (req, res) => {
  const profile = findProfileBySecret(req.params.secret);
  if (!profile) return res.status(404).json({ error: 'არასწორი ბმული' });

  const messages = db
    .prepare('SELECT id, content, created_at FROM messages WHERE profile_id = ? ORDER BY id DESC LIMIT 500')
    .all(profile.id);
  const getComments = db.prepare(
    'SELECT id, content, created_at FROM comments WHERE message_id = ? ORDER BY id ASC LIMIT 100'
  );
  for (const m of messages) m.comments = getComments.all(m.id);
  attachReactions('message', messages);

  res.json({ slug: profile.slug, name: profile.name, messages });
});

app.delete('/api/inbox/:secret/messages/:id', limitComments, (req, res) => {
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

app.get('/api/chat', limitRead, (req, res) => {
  touchPresence(cleanText(req.query.nick, MAX_NAME));

  const after = Number.parseInt(req.query.after, 10);
  let rows;
  if (Number.isInteger(after) && after > 0) {
    rows = db.prepare(`${CHAT_SELECT} WHERE c.id > ? ORDER BY c.id ASC LIMIT 200`).all(after);
  } else {
    rows = db.prepare(`${CHAT_SELECT} ORDER BY c.id DESC LIMIT 100`).all().reverse();
  }
  // რეაქციები ბოლო 100 შეტყობინებაზე — ძველ ბაბლებზეც რომ განახლდეს ცოცხლად
  const maxChatId = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM chat_messages').get().m;
  const reactionRows = db
    .prepare("SELECT target_id, emoji, count FROM reactions WHERE target_type = 'chat' AND count > 0 AND target_id > ?")
    .all(maxChatId - 100);
  const reactions = {};
  for (const r of reactionRows) (reactions[r.target_id] ??= {})[r.emoji] = r.count;

  res.json({ online: onlineCount(), messages: rows, reactions });
});

app.post('/api/chat', limitChat, (req, res) => {
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

app.get('/api/stats', limitRead, (_req, res) => {
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
