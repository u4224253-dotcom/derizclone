// Service worker Melvox: membuat aplikasi bisa di-install dan tetap terbuka tanpa internet.
// Daftar file (PRECACHE) dan VERSION diisi otomatis saat `npm run build` oleh plugin pwaPrecache di vite.config.ts.
// Saat dev (`npm run dev`) service worker tidak didaftarkan, jadi placeholder di bawah tidak berpengaruh.

const VERSION = '__VERSION__';
const PRECACHE = /*__PRECACHE__*/[];
const CACHE = 'derizmp3-' + VERSION;

self.addEventListener('install', (e) => {
  // Versi baru menunggu sampai semua tab lama ditutup (tanpa skipWaiting),
  // supaya project yang sedang dikerjakan tidak kehilangan file chunk-nya di tengah jalan.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...PRECACHE])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('derizmp3-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/admin' || url.pathname === '/admin.html' || url.pathname === '/login' || url.pathname === '/login.html') return;   // dashboard admin, API, dan login selalu lewat jaringan (tidak di-cache, tidak menimpa salinan aplikasi)

  // Buka halaman: coba jaringan dulu (dapat versi terbaru), kalau offline pakai salinan tersimpan.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); } return res; })
        .catch(() => caches.match('./', { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // File lain (JS/CSS/font/worker/ikon): ambil dari cache dulu, kalau belum ada ambil dari jaringan lalu simpan.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
