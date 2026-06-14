const CACHE_NAME = 'bill-tracker-v4';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

// Network-first strategy: always try fresh files, fallback to cache only if offline
self.addEventListener('fetch', e => {
    e.respondWith(
        fetch(e.request).then(response => {
            // Update cache with fresh version
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
            return response;
        }).catch(() => {
            // Offline: serve from cache
            return caches.match(e.request);
        })
    );
});
