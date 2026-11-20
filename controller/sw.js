// 端末の画面を、サーバーや回線が止まっていても開けるようにする。
// 保存するのは画面の部品だけで、列車・バスなどのデータ（/api/）は保存しない（古い時刻を新しく見せないため）。
// 画面はネットワークを優先し、取れないとき（通信の失敗・5xx・応答が遅い）だけ保存した版を出す。
// 5xx も失敗に数えるのは、Cloudflare や controller のエラーページを「取れた」として素通りさせないため。
const BUILD = '__BUILD__';
const CACHE = 'signage-' + BUILD;
const NETWORK_LIMIT_MS = 8000;
const ATLAS_FILES = ['player.js', 'weather.js', 'map.json'];
const PRECACHE = [
  '/',
  '/transit/',
  ...['assembly.js', 'opening.js', 'weather.js', 'chime.js', 'chime-core.js', 'seasonal.js'].map(name => '/transit/assets/' + name),
  ...['/clock/', '/transit/board/bus/', '/transit/board/train/'].flatMap(page => [page, ...ATLAS_FILES.map(name => page + name)])
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  self.skipWaiting();
  // 1つ取れなくても残りは保存する（addAll は1つの失敗で全部やめる）
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(PRECACHE.map(async path => {
    const response = await fetch(path, { cache: 'no-store' });
    if (response.ok && !response.redirected) await cache.put(path, response);
  }))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('signage-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function isScreenPart(url, request) {
  if (url.origin !== location.origin) return false;
  if (!(url.pathname === '/' || url.pathname.startsWith('/transit/') || url.pathname.startsWith('/clock/'))) return false;
  if (url.pathname.includes('/api/') || url.pathname.includes('/demo')) return false;
  // 接続の確認（display.html の healthCheck）は fetch で投げるので destination が空になり、ここで外れる。
  // 保存した版で答えると、サーバーが止まっていても「つながっている」と判定されてしまう
  return request.mode === 'navigate' || ['script', 'style', 'font', 'image'].includes(request.destination)
    || url.pathname.endsWith('/map.json');
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  const raw = fetch(request);
  const network = raw.then(response => {
    if (response.status >= 500) throw new Error('HTTP ' + response.status);
    if (response.ok && !response.redirected) cache.put(key, response.clone()).catch(() => {});
    return response;
  });
  network.catch(() => {});
  try {
    return await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_LIMIT_MS))]);
  } catch (error) {
    const saved = await caches.match(key, { ignoreSearch: true });
    if (saved) return saved;
    return raw.catch(() => Response.error());
  }
}

async function cacheFirst(request) {
  const saved = await caches.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  } else if (isScreenPart(url, request)) {
    // ?handoff=atlas などの付いた読み込みも、同じ画面として保存する
    event.respondWith(networkFirst(request, url.origin + url.pathname));
  }
});
