const CACHE_NAME = 'catalogo-v4';
const PRE_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/colombia.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRE_CACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // No cachear Firebase
  if (event.request.url.includes('firebaseio.com')) return;
  if (event.request.url.includes('firebasestorage.googleapis.com')) return;
  if (event.request.url.includes('googleapis.com')) return;

  // Estrategia: Network-First para HTML, JS y CSS
  // Si la red falla, sirve desde caché (modo offline)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, cacheCopy));
        }
        return networkResponse;
      })
      .catch(() => {
        // Sin red → intenta caché
        return caches.match(event.request);
      })
  );
});
