// Service Worker for H3 Viewer: Offline caching for app assets & map tiles (OpenStreetMap & Esri)
const CACHE_NAME = 'h3-viewer-app-v1';
const TILE_CACHE_NAME = 'h3-viewer-tiles-v1';
const MAX_TILE_ENTRIES = 4000;

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

// Helper to limit cache size
async function trimCache(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        if (keys.length > maxItems) {
            await cache.delete(keys[0]);
            trimCache(cacheName, maxItems);
        }
    } catch (e) {}
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Map Tiles (OpenStreetMap & Esri World Imagery / Boundaries / Roads)
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
                        trimCache(TILE_CACHE_NAME, MAX_TILE_ENTRIES);
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
