// ============================================
// SERVICE WORKER — ShopFlow for Teachers
// Caches external scripts for offline use.
// Update CACHE_VERSION when deploying changes.
// ============================================

const CACHE_VERSION = 'esb-v115';

const EXTERNAL_SCRIPTS = [
    'https://unpkg.com/dexie@4.0.8/dist/dexie.js',
    'https://unpkg.com/@phosphor-icons/web@2.1.1/src/index.js',
];

const LOCAL_FILES = [
    './index.html',
    './sw.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './css/base.css',
    './css/layout.css',
    './css/components.css',
    './css/pages.css',
    './css/responsive.css',
    './css/utilities.css',
    './js/core/constants.js',
    './js/core/utils.js',
    './js/core/state.js',
    './js/core/db.js',
    './js/core/webhook.js',
    './js/core/router.js',
    './js/ui/toasts.js',
    './js/ui/modals.js',
    './js/ui/charts.js',
    './js/features/driveSync.js',    
    './js/features/skillsMigrationCrosswalk.js',
    './js/features/skillsMigration.js',
    './js/features/formImport.js',
    './js/features/pinLock.js',
    './js/features/exportManager.js',
    './js/features/autoTasks.js',
    './js/features/appFeatures.js',
    './js/pages/dashboard.js',
    './js/pages/students.js',
    './js/pages/attendance.js',
    './js/pages/teams.js',
    './js/pages/activities.js',
    './js/pages/activityDetail.js',
    './js/pages/checkpoint.js',
    './js/pages/settings.js',
    './js/pages/skills.js',
    './js/pages/misc.js',
    './js/init.js',
];

// On install — cache all external scripts
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(async cache => {
            // Cache external scripts (best effort — may fail if offline on first load)
            await Promise.allSettled(
                EXTERNAL_SCRIPTS.map(url =>
                    fetch(url, { mode: 'cors' })
                        .then(response => {
                            if (response.ok) return cache.put(url, response);
                        })
                        .catch(err => console.warn(`SW: Failed to cache ${url}`, err))
                )
            );
            // Cache local files (always available)
            await Promise.allSettled(
                LOCAL_FILES.map(url =>
                    fetch(url)
                        .then(response => {
                            if (response.ok) return cache.put(url, response);
                        })
                        .catch(err => console.warn(`SW: Failed to cache local file ${url}`, err))
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// On activate — delete old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_VERSION)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Allow the page to trigger skipWaiting when user taps "reload"
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// On fetch — serve external scripts from cache, fall back to network
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // Don't intercept POST requests (webhook calls to Google Apps Script, etc.)
    if (event.request.method !== 'GET') return;
    // Only intercept our known external scripts
    if (EXTERNAL_SCRIPTS.some(script => url.startsWith(script.split('?')[0]))) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) {
                    // Serve from cache, refresh in background
                    fetch(event.request)
                        .then(response => {
                            if (response && response.ok) {
                                caches.open(CACHE_VERSION)
                                    .then(cache => cache.put(event.request, response));
                            }
                        })
                        .catch(() => {}); // Silent fail — we already have a cached copy
                    return cached;
                }
                // Not in cache — try network
                return fetch(event.request).catch(() => {
                    console.warn('SW: Offline and no cache for', url);
                });
            })
        );
        return;
    }

    // For local files — network first, update cache in background
    const requestUrl = new URL(event.request.url);
    if (LOCAL_FILES.some(f => requestUrl.pathname.endsWith(f.replace('./', '')))) {
        const reqClone = event.request.clone();
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        const respClone = response.clone();
                        caches.open(CACHE_VERSION)
                            .then(cache => cache.put(reqClone, respClone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // For everything else — network first, fall back to cache
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
