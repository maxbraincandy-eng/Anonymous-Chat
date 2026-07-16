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
