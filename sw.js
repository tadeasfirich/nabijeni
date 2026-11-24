// Service worker: aplikace se otevře i bez sítě. Data jsou v IndexedDB, ne tady.
// Při každé nové verzi zvyš VERSION, ať si telefon stáhne nové soubory.
// Vlastní soubory se nejdřív zkusí ze sítě (ať se hned projeví nová verze), při výpadku z mezipaměti.

const VERSION = 'nabijeni-v5';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/ui.js', 'js/model.js', 'js/data.js', 'js/photo.js', 'js/reader.js',
  'js/sync.js', 'js/report.js', 'js/xlsx.js', 'js/zip.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'nabijeni-fonts').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // AI a Google skript nikdy necachujeme
  if (/generativelanguage|anthropic|script\.google|googleusercontent|drive\.google/.test(url.hostname)) return;

  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(caches.open('nabijeni-fonts').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))));
  }
});
