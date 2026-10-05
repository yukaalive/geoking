/* 地理王 Service Worker: 画面の部品（HTML/CSS/JS/アイコン/地図）をキャッシュしてアプリのように素早く開く。
   API と WebSocket は常にネットワーク。ただし国のデータ（/api/meta）は、通信がないときに前に覚えた分を使う（2026-10-05: オフラインでボットとバトル・図鑑・クイズ）。
   国旗（flagcdn.com）は覚えた分を先に使う。一度つながったとき、画面から頼まれて全部の国旗を裏で覚える（precache-flags） */
const VERSION = 'geoking-v4';
const FLAGS = 'geoking-flags-v1';   // 国旗は VERSION を上げても消さない（大きいので取り直さない）
const FONTS = 'geoking-fonts-v1';   // 見出しと本文の字体（Google Fonts）。使った分を覚え、通信がないときも同じ字体で出す（覚えていない文字だけは端末の字体）
const SHELL = ['/static/index.html', '/static/style.css', '/static/common.js', '/static/sfx.js', '/static/survival.js', '/static/rating.js', '/static/offline.js', '/static/app.js', '/static/native.js',
  '/static/zukan.html', '/static/zukan.js', '/static/quiz.html', '/static/quiz.js', '/static/i18n.js', '/static/icons.svg', '/static/worldmap.json', '/static/manifest.json', '/static/icons/icon-192.png', '/static/icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FLAGS && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const fresh = (req) => fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; });   // 取れたら覚えておく
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'flagcdn.com') {   // 国旗: 覚えた分を先に（なければ取って覚える）
    e.respondWith(caches.open(FLAGS).then(c => c.match(e.request.url).then(hit => hit || fetch(e.request).then(res => { if (res.ok || res.type === 'opaque') c.put(e.request.url, res.clone()); return res; }))));
    return;
  }
  if (url.hostname === 'fonts.gstatic.com') {   // 字体のファイル: 覚えた分を先に（中身は変わらない）
    e.respondWith(caches.open(FONTS).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok || res.type === 'opaque') c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com') {   // 字体の CSS: 新しい方を。通信がなければ覚えた分
    e.respondWith(fetch(e.request).then(res => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(FONTS).then(c => c.put(e.request, copy)); } return res; }).catch(() => caches.open(FONTS).then(c => c.match(e.request))));   // <link> の CSS は opaque で届く
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname === '/api/meta') { e.respondWith(fresh(e.request).catch(() => caches.match(e.request))); return; }   // 国のデータ: 新しい方を。通信がなければ前に覚えた分
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/healthz') return;   // 常に最新
  // 画面部品: ネットワーク優先、失敗したらキャッシュ（更新をすぐ反映しつつオフラインでも開ける）
  e.respondWith(fresh(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/static/index.html'))));
});
// 全部の国旗を覚える（画面が国のデータを読んだあとに頼む）。1度覚えたら、次からは足りない分だけ
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'precache-flags' || !Array.isArray(d.ids)) return;
  e.waitUntil(caches.open(FLAGS).then(async (c) => {
    const urls = [];
    for (const id of d.ids.slice(0, 400)) for (const w of [80, 160, 320]) urls.push(`https://flagcdn.com/w${w}/${String(id).replace(/[^a-z-]/g, '')}.png`);
    const todo = [];
    for (const u of urls) if (!(await c.match(u))) todo.push(u);
    for (let i = 0; i < todo.length; i += 8) {   // 8枚ずつ（通信をふさがない）
      await Promise.all(todo.slice(i, i + 8).map(u => fetch(u, { mode: 'no-cors' }).then(res => c.put(u, res)).catch(() => {})));
    }
  }));
});
