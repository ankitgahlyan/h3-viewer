// Service Worker for H3 Viewer: Unlimited offline caching for map tiles (OpenStreetMap & Esri) and app assets
const CACHE_NAME = 'h3-viewer-app-v1';
const TILE_CACHE_NAME = 'h3-viewer-tiles-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './map.js',
    './h3.js',
    './olc.js',
    './hex.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
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
    const url = new URL(event.request.url);

    // 1. Map Tiles (OpenStreetMap & Esri World Imagery / Boundaries / Roads) - No size limit
    if (
        url.hostname.includes('tile.openstreetmap.org') ||
        url.hostname.includes('server.arcgisonline.com') ||
        url.pathname.includes('/tile/') ||
        url.pathname.includes('/MapServer/')
    ) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                try {
                    const networkResponse = await fetch(event.request);
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (err) {
                    return cachedResponse || Promise.reject(err);
                }
            })
        );
        return;
    }

    // 2. Static assets & CDNs (Stale-While-Revalidate)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
