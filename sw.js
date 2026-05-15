const CACHE_NAME = 'catalogo-v7';
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
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      // Fix: client.navigate falla si el cliente no tiene foco — se elimina
      // El navegador recarga solo al detectar el nuevo SW gracias a skipWaiting
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('firebaseio.com')) return;
  if (event.request.url.includes('googleapis.com')) return;
  if (event.request.url.includes('nominatim.openstreetmap.org')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
