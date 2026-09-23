/* 地理王 Service Worker: 画面の部品（HTML/CSS/JS/アイコン/地図）をキャッシュしてアプリのように素早く開く。
   API と WebSocket は常にネットワーク。 */
const VERSION = 'geoking-v2';
const SHELL = ['/static/index.html', '/static/style.css', '/static/common.js', '/static/sfx.js', '/static/app.js', '/static/zukan.html', '/static/zukan.js', '/static/icons.svg', '/static/worldmap.json', '/static/manifest.json',
               '/static/icons/icon-192.png', '/static/icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/healthz') return;   // 常に最新
  // 画面部品: ネットワーク優先、失敗したらキャッシュ（更新をすぐ反映しつつオフラインでも開ける）
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('/static/index.html'))));
});
