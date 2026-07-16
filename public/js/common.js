// საერთო დამხმარე ფუნქციები ყველა გვერდისთვის

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(sqliteUtc) {
  // SQLite datetime('now') აბრუნებს UTC-ს "YYYY-MM-DD HH:MM:SS" ფორმატში
  const date = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  return date.toLocaleString('ka-GE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'დაფიქსირდა შეცდომა, სცადეთ თავიდან');
  return data;
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = 'დაკოპირდა ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  });
}

// ---- ჩემი პროფილი (ინახება ბრაუზერში, რომ ლინკის ცალკე შენახვა არ იყოს საჭირო) ----

function saveMyProfile(slug, secret) {
  localStorage.setItem('anonimo_slug', slug);
  localStorage.setItem('anonimo_secret', secret);
}

function getMyProfile() {
  const slug = localStorage.getItem('anonimo_slug');
  const secret = localStorage.getItem('anonimo_secret');
  return slug && secret ? { slug, secret } : null;
}

// ნავიგაციაში „ჩემი გვერდი“ ღილაკის ჩამატება, თუ ამ ბრაუზერს პროფილი აქვს
function renderMyPageLink() {
  const me = getMyProfile();
  if (!me) return;
  const links = document.querySelector('nav .links');
  if (!links || links.querySelector('.my-page-link')) return;
  const a = document.createElement('a');
  a.className = 'my-page-link';
  a.href = `/inbox/${me.secret}`;
  a.textContent = '📥 ჩემი გვერდი';
  links.prepend(a);
}

document.addEventListener('DOMContentLoaded', renderMyPageLink);

// ---- რეაქციები (❤️ 🔥 😂 👀) ----

const REACTION_EMOJIS = ['❤️', '🔥', '😂', '👀'];

// რაზე მაქვს რეაქცია გაცემული — ინახება ბრაუზერში ("type:id:emoji")
function getReactedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem('anonimo_reacted') || '[]'));
  } catch {
    return new Set();
  }
}
function saveReactedSet(set) {
  localStorage.setItem('anonimo_reacted', JSON.stringify([...set]));
}

function renderReactionBar(type, id, counts) {
  counts = counts || {};
  const reacted = getReactedSet();
  const chips = REACTION_EMOJIS.map((emoji) => {
    const n = counts[emoji] || 0;
    const active = reacted.has(`${type}:${id}:${emoji}`);
    return `<button type="button" class="react-chip${active ? ' active' : ''}" data-emoji="${emoji}">${emoji}${n ? `<span class="rc">${n}</span>` : ''}</button>`;
  }).join('');
  return `<div class="react-bar" data-type="${type}" data-id="${id}">${chips}</div>`;
}

// ერთი საერთო ჰენდლერი ყველა გვერდისთვის
document.addEventListener('click', async (ev) => {
  const chip = ev.target.closest('.react-chip');
  if (!chip) return;
  const bar = chip.closest('.react-bar');
  const { type, id } = bar.dataset;
  const emoji = chip.dataset.emoji;
  const key = `${type}:${id}:${emoji}`;
  const reacted = getReactedSet();
  const action = reacted.has(key) ? 'remove' : 'add';

  chip.disabled = true;
  try {
    const data = await api('/api/react', {
      method: 'POST',
      body: JSON.stringify({ type, id: Number(id), emoji, action }),
    });
    if (action === 'add') reacted.add(key);
    else reacted.delete(key);
    saveReactedSet(reacted);
    bar.outerHTML = renderReactionBar(type, id, data.reactions);
  } catch (e) {
    chip.disabled = false;
  }
});
