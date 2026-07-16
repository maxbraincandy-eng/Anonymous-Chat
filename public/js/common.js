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

// ბარში მხოლოდ გაცემული რეაქციები ჩანს (ცარიელი ჩიპები აღარ იხატება)
function renderReactionBar(type, id, counts) {
  counts = counts || {};
  const reacted = getReactedSet();
  const chips = REACTION_EMOJIS.filter((emoji) => (counts[emoji] || 0) > 0)
    .map((emoji) => {
      const active = reacted.has(`${type}:${id}:${emoji}`);
      return `<button type="button" class="react-chip${active ? ' active' : ''}" data-emoji="${emoji}">${emoji}<span class="rc">${counts[emoji]}</span></button>`;
    })
    .join('');
  return `<div class="react-bar" data-type="${type}" data-id="${id}">${chips}</div>`;
}

async function toggleReaction(type, id, emoji) {
  const key = `${type}:${id}:${emoji}`;
  const reacted = getReactedSet();
  const action = reacted.has(key) ? 'remove' : 'add';
  const data = await api('/api/react', {
    method: 'POST',
    body: JSON.stringify({ type, id: Number(id), emoji, action }),
  });
  if (action === 'add') reacted.add(key);
  else reacted.delete(key);
  saveReactedSet(reacted);
  const bar = document.querySelector(`.react-bar[data-type="${type}"][data-id="${id}"]`);
  if (bar) bar.outerHTML = renderReactionBar(type, id, data.reactions);
}

// არსებულ ჩიპზე დაჭერა — სწრაფი toggle
document.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.react-chip');
  if (!chip) return;
  const { type, id } = chip.closest('.react-bar').dataset;
  chip.disabled = true;
  toggleReaction(type, id, chip.dataset.emoji).catch(() => { chip.disabled = false; });
});

// ---- რეაქციის პანელი: შეტყობინებაზე დიდხანს დაჭერით ----

function getReactPicker() {
  let picker = document.getElementById('reactPicker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'reactPicker';
    picker.className = 'react-picker';
    document.body.appendChild(picker);
    picker.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-emoji]');
      if (!btn) return;
      ev.stopPropagation();
      const { type, id } = picker.dataset;
      toggleReaction(type, id, btn.dataset.emoji).catch(() => {});
      hideReactPicker();
    });
  }
  return picker;
}

function showReactPicker(type, id, x, y) {
  const picker = getReactPicker();
  picker.dataset.type = type;
  picker.dataset.id = id;
  const reacted = getReactedSet();
  picker.innerHTML = REACTION_EMOJIS.map((emoji) => {
    const active = reacted.has(`${type}:${id}:${emoji}`);
    return `<button type="button" class="${active ? 'active' : ''}" data-emoji="${emoji}">${emoji}</button>`;
  }).join('');
  picker.classList.add('open');
  // ჯერ ვაჩენთ, რომ ზომა გავზომოთ და ეკრანიდან არ გავიდეს
  const rect = picker.getBoundingClientRect();
  const left = Math.min(Math.max(x - rect.width / 2, 8), window.innerWidth - rect.width - 8);
  const top = Math.max(y - rect.height - 16, 8);
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
  if (navigator.vibrate) navigator.vibrate(10);
}

function hideReactPicker() {
  const picker = document.getElementById('reactPicker');
  if (picker) picker.classList.remove('open');
}

let pressTimer = null;
let pressStart = null;
let suppressNextClick = false;
const LONG_PRESS_MS = 450;

document.addEventListener('pointerdown', (ev) => {
  const target = ev.target.closest('.reactable');
  if (!target || ev.target.closest('.react-chip, .reply-btn, button, a, input, textarea')) return;
  pressStart = { x: ev.clientX, y: ev.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    suppressNextClick = true;
    showReactPicker(target.dataset.type, target.dataset.id, pressStart.x, pressStart.y);
  }, LONG_PRESS_MS);
});

document.addEventListener('pointermove', (ev) => {
  if (!pressTimer || !pressStart) return;
  // სქროლისას long-press უქმდება
  if (Math.abs(ev.clientX - pressStart.x) > 10 || Math.abs(ev.clientY - pressStart.y) > 10) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
});

for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  });
}

// Android-ზე long-press-ის კონტექსტ-მენიუ არ ამოვარდეს
document.addEventListener('contextmenu', (ev) => {
  if (ev.target.closest('.reactable')) ev.preventDefault();
});

// პანელის დახურვა გარეთ დაჭერით ან სქროლით; long-press-ის მერე click არ გავიდეს
document.addEventListener('click', (ev) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    ev.stopPropagation();
    ev.preventDefault();
    return;
  }
  if (!ev.target.closest('#reactPicker')) hideReactPicker();
}, true);

document.addEventListener('scroll', hideReactPicker, { capture: true, passive: true });
