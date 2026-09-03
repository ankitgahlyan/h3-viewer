// Service Worker for H3 Viewer: Complete offline support and unlimited map tile caching
const CACHE_NAME = 'h3-viewer-app-v2';
const TILE_CACHE_NAME = 'h3-viewer-tiles-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './map.js',
    './h3.js',
    './olc.js',
    './hex.png',
    './manifest.json',
    'https://maxcdn.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.4.1/font/bootstrap-icons.css',
    'https://cdn.jsdelivr.net/npm/vue@2/dist/vue.js',
    'https://unpkg.com/leaflet@1.6.0/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.6.0/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachePromises = STATIC_ASSETS.map((url) => {
                return fetch(new Request(url, { mode: 'cors' }))
                    .then((res) => {
                        if (res.ok || res.type === 'opaque') {
                            return cache.put(url, res);
                        }
                        return cache.add(url);
                    })
                    .catch(() => {
                        return cache.add(url).catch((err) => {
                            console.warn('Pre-cache item failed:', url, err);
                        });
                    });
            });
            await Promise.all(cachePromises);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME && name !== TILE_CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // 1. Map Tiles (OpenStreetMap & Esri World Imagery / Boundaries / Roads) - Unlimited tile cache
    if (
        url.hostname.includes('tile.openstreetmap.org') ||
        url.hostname.includes('server.arcgisonline.com') ||
        url.pathname.includes('/tile/') ||
        url.pathname.includes('/MapServer/')
    ) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                try {
                    const networkResponse = await fetch(request);
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        cache.put(request, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (err) {
                    return cachedResponse || Promise.reject(err);
                }
            })
        );
        return;
    }

    // 2. Navigation / HTML Document (Network-First with offline cache fallback to index.html)
    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return networkResponse;
                })
                .catch(async () => {
                    const cached = await caches.match(request, { ignoreSearch: true });
                    if (cached) return cached;
                    const indexCached = await caches.match('./index.html', { ignoreSearch: true });
                    if (indexCached) return indexCached;
                    return caches.match('./', { ignoreSearch: true });
                })
        );
        return;
    }

    // 3. Static assets, scripts, stylesheets, fonts, CDNs (Cache-First / Stale-While-Revalidate)
    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                // In background, refresh cache from network if online
                fetch(request)
                    .then((networkResponse) => {
                        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
                        }
                    })
                    .catch(() => {});
                return cachedResponse;
            }

            return fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return networkResponse;
                })
                .catch((err) => {
                    return cachedResponse || Promise.reject(err);
                });
        })
    );
});
