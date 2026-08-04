/**
 * SERVICE WORKER FOR NFC TAG MASTER PWA
 * Caches static shell assets for 100% offline functionality.
 */

const CACHE_NAME = 'nfc-master-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './nfc-bridge.js',
  './modulos.json',
  './config.js',
  './sync.js',
  './app.js',
  './manifest.json'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Stale while revalidate strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // La API jamás pasa por caché.
  //
  // La estrategia de abajo devuelve primero lo cacheado, así que una bajada de
  // eventos serviría la respuesta anterior con su cursor viejo: el teléfono
  // volvería a pedir el mismo tramo para siempre y nunca vería lo nuevo. Que la
  // sincronización falle sin señal es correcto; que mienta con datos rancios, no.
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for offline if not in cache
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
