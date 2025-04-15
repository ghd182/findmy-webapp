// app/static/sw.js

const CACHE_NAME = 'findmy-cache-v12'; // <<< INCREMENT CACHE NAME
const urlsToCache = [
  // Core App Shell (URLs remain the same)
  '/', // Cache the root app shell
  '/static/css/style.css',
  '/static/js/config.js',
  '/static/js/state.js',
  '/static/js/utils.js',
  '/static/js/api.js',
  '/static/js/ui.js',
  '/static/js/map.js',
  '/static/js/notifications.js',
  '/static/js/app.js',
  '/static/js/scanner.js', // Include scanner JS

  // Icons (URLs remain the same)
  '/static/icons/web-app-manifest-192x192.png',
  '/static/icons/web-app-manifest-512x512.png',
  '/static/icons/favicon.svg',
  '/static/icons/apple-touch-icon.png',
  '/static/icons/icon.svg',
  '/static/img/wifi_tethering_16dp.png',
  '/static/img/crisis_alert_16dp.png',
  '/static/img/labs_16dp.png',
  '/static/img/battery_alert_16dp.png',
  '/favicon.ico', // Served by Flask at root

  // Leaflet assets (URLs remain the same)
  // Corrected paths assuming libs is under static
  '/static/libs/leaflet/leaflet.js',
  '/static/libs/leaflet/leaflet.css',
  // Corrected image paths assuming styles/leaflet/images is under static
  '/static/styles/leaflet/images/marker-icon.png',
  '/static/styles/leaflet/images/marker-icon-2x.png',
  '/static/styles/leaflet/images/marker-shadow.png',

  // Material Icons & Symbols CSS (URLs remain the same)
  '/static/styles/material-icons/material-icons.css',
  '/static/styles/material-symbols/material-symbols-outlined.css',
  // Add specific WOFF2 font files if you want explicit caching (optional, CSS usually triggers load)
  // e.g., '/static/fonts/material-icons.woff2',
  // e.g., '/static/fonts/material-symbols-outlined.woff2',
  // You'll need to list the actual filenames you downloaded

  // Material Color Utilities (local fallback)
  '/static/libs/material-color/material-color-utilities.esm.js',
  // Manifest (Served by public blueprint)
  '/public/manifest.json', // <<< CORRECT PATH
];

// --- Install Event (Keep as is, but ensure paths are correct) ---
self.addEventListener('install', event => {
    console.log(`[SW-${CACHE_NAME}] Install event started.`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log(`[SW-${CACHE_NAME}] Caching core assets... (${urlsToCache.length} items)`);
                const cachePromises = urlsToCache.map(urlToCache => {
                    // Ensure requests respect potential redirects during caching
                    return cache.add(new Request(urlToCache, { redirect: 'follow' })).catch(err => {
                        console.warn(`[SW-${CACHE_NAME}] Failed to cache on install: ${urlToCache}`, err);
                        return null; // Don't fail install for optional assets
                    });
                });
                return Promise.all(cachePromises);
            })
            .then(() => {
                console.log(`[SW-${CACHE_NAME}] Core assets caching finished.`);
                // Don't skip waiting here; let UI prompt for update.
            })
            .catch(error => {
                console.error(`[SW-${CACHE_NAME}] Installation failed:`, error);
            })
    );
});

// --- Activate Event (Keep as is) ---
self.addEventListener('activate', event => {
    console.log(`[SW-${CACHE_NAME}] Activate event started.`);
    event.waitUntil(
        (async () => {
            // Client Claiming
            if (self.clients && typeof self.clients.claim === 'function') {
                try { await self.clients.claim(); console.log(`[SW-${CACHE_NAME}] Clients claimed successfully.`); }
                catch (err) { console.error(`[SW-${CACHE_NAME}] Error claiming clients:`, err); }
            }
            // Cache Cleanup
            try {
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log(`[SW-${CACHE_NAME}] Deleting old cache:`, cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
                console.log(`[SW-${CACHE_NAME}] Old caches deleted successfully.`);
            } catch (err) { console.error(`[SW-${CACHE_NAME}] Error deleting old caches:`, err); }
            console.log(`[SW-${CACHE_NAME}] Activation complete.`);
        })()
    );
});


// --- Fetch Event (REVISED STRATEGY) ---
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const request = event.request; // Store request for convenience

    // --- 1. API Calls: Network Only (Keep) ---
    if (url.pathname.startsWith('/api/')) {
        // console.log(`[SW Fetch] Network Only (API): ${url.pathname}`);
        event.respondWith(
            fetch(request).catch(error => {
                console.warn(`[SW Fetch] Network request failed for API ${request.method} ${url.pathname}:`, error);
                // Provide a generic JSON error response for failed GET API calls when offline
                if (request.method === 'GET') {
                    return new Response(JSON.stringify({ error: 'Offline', message: 'Network connection unavailable.' }), {
                        status: 503, headers: { 'Content-Type': 'application/json' }
                    });
                }
                // For non-GET API calls when offline, rethrow the error to let the browser show a network error
                throw error;
            })
        );
        return; // Handled
    }

    // --- 2. Auth/Action Routes: Bypass SW (Keep) ---
    if (url.pathname === '/logout' || url.pathname === '/login' || url.pathname === '/register' || url.pathname === '/manage_apple_creds') {
        console.log(`[SW Fetch] Bypassing SW for critical route: ${url.pathname}`);
        return; // Let browser handle directly
    }

    // --- 3. Static Assets: Stale-While-Revalidate (Keep) ---
    if (request.method === 'GET' && (
        url.pathname.startsWith('/static/') ||
        url.pathname === '/favicon.ico' ||
        url.pathname === '/public/manifest.json' // Served by public blueprint
    )) {
        // console.log(`[SW Fetch] StaleWhileRevalidate: ${url.pathname}`);
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(request);
                const networkFetchPromise = fetch(request).then(networkResponse => {
                    if (networkResponse && networkResponse.ok) {
                        // Cache the new response only if fetch was successful
                        cache.put(request, networkResponse.clone());
                    } else if (networkResponse) {
                        console.warn(`[SW Fetch] SWR: Network fetch for ${url.pathname} returned status ${networkResponse.status}. Not caching.`);
                    }
                    return networkResponse;
                }).catch(error => {
                    console.warn(`[SW Fetch] SWR: Network fetch failed for ${url.pathname}:`, error);
                    // If network fails, return null to signal the failure *after* checking cache
                    return null;
                });

                // Return cached version first if available, otherwise wait for network.
                // If network also fails (returns null), let the browser handle the error (e.g., show broken image).
                return cachedResponse || networkFetchPromise.then(response => {
                     // If network fetch failed AND there was no cache, respond with a 404
                     if (!response && !cachedResponse) {
                         console.warn(`[SW Fetch] SWR: Network failed and no cache for ${url.pathname}. Returning 404.`);
                         return new Response(null, { status: 404 });
                     }
                     return response; // Return network response (or null if it failed)
                });
            })
        );
        return; // Handled
    }

    // --- 4. HTML Navigation Requests (REVISED LOGIC) ---
    if (request.mode === 'navigate' && request.method === 'GET' && url.origin === self.location.origin) {

        // --- Strategy Revision: ---
        // a) Main App Shell ('/'): Network First, Cache Fallback (to '/' cache).
        // b) Dynamic Pages (like /public/shared/*): Network Only. NEVER CACHE HTML.
        // c) Other HTML pages (if any): Default to Network Only for safety.

        if (url.pathname === '/') {
            // --- Network First for Root App Shell ---
            console.log(`[SW Fetch] Network First (Root Shell Nav): ${url.pathname}`);
            event.respondWith(
                fetch(request)
                    .then(response => {
                        // Cache only successful, basic root response
                        if (response && response.ok && response.type === 'basic') {
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(new Request('/'), responseToCache); // Cache the '/' request
                                console.log(`[SW Fetch] Cached root '/' response.`);
                            });
                            return response; // Serve the fresh response
                        } else {
                            // Network error/bad response for root, try cache fallback
                            console.warn(`[SW Fetch] Network First: Bad network response for root shell (${response?.status}). Trying cache...`);
                            return caches.match(new Request('/')); // Fallback to cached '/'
                        }
                    })
                    .catch(async (error) => {
                        // Network failed completely for root, serve from cache
                        console.warn(`[SW Fetch] Network First: Network failed for root shell. Serving '/' from cache. Error:`, error);
                        const cachedResponse = await caches.match(new Request('/'));
                        if (cachedResponse) {
                            return cachedResponse;
                        } else {
                            console.error(`[SW Fetch] Network First: Network failed and root '/' not in cache.`);
                            // Optional: Return a generic offline HTML page if available
                            // return caches.match('/offline.html');
                            // If no offline page, rethrow the error to show browser's network error
                            throw error;
                        }
                    })
            );
        } else if (url.pathname.startsWith('/public/shared/')) {
            // --- Network Only for Shared Link Pages ---
            console.log(`[SW Fetch] Network Only (Shared Page Nav): ${url.pathname}`);
            // Don't try cache, just go to network. If network fails, browser shows error.
            // Avoid catching here unless you want to show a custom offline message *specifically* for shared pages.
            event.respondWith(fetch(request));

        } else {
            // --- Network Only for any other unknown HTML pages ---
            console.log(`[SW Fetch] Network Only (Other HTML Nav): ${url.pathname}`);
            event.respondWith(fetch(request));
        }
        return; // Handled navigation
    }

    // --- 5. Default: Let the browser handle any other requests ---
    // console.log(`[SW Fetch] Default browser handling: ${url.pathname}`);
});

// --- Push Event Listener (Keep as is) ---
self.addEventListener('push', event => {
    console.log('[SW] Push Received.');
    let payload = {};
    try { payload = event.data.json(); console.log('[SW] Push data payload:', payload); }
    catch (e) { console.error('[SW] Error parsing push data:', e); payload = { notification: { title: "Notification", body: "Error parsing content." } }; }
    const notificationData = payload.notification || {};
    const title = notificationData.title || 'FindMy Alert';
    const options = {
        body: notificationData.body || 'You received a notification.',
        icon: notificationData.icon || '/static/icons/favicon.svg',
        badge: notificationData.badge || '/static/icons/badge-icon.png',
        tag: notificationData.tag || 'findmy-notification-' + Date.now(),
        renotify: notificationData.renotify || false,
        requireInteraction: notificationData.requireInteraction || false,
        data: notificationData.data || {},
        actions: notificationData.actions || []
    };
    console.log('[SW] Showing notification:', title, options);
    const notificationPromise = self.registration.showNotification(title, options);
    event.waitUntil(notificationPromise);
});

// --- Notification Click Listener (Keep as is) ---
self.addEventListener('notificationclick', event => {
    const clickedNotification = event.notification;
    const notificationData = clickedNotification.data;
    const action = event.action;
    console.log('[SW] Notification click Received.'); console.log('[SW] Notification Tag:', clickedNotification.tag); console.log('[SW] Notification Data Payload:', notificationData); console.log('[SW] Clicked Action:', action);
    clickedNotification.close();
    let targetUrl = new URL('/', self.location.origin).href; let focusMessage = null; let urlToOpen = targetUrl;
    if (action === 'view_device') { if (notificationData?.deviceId) { console.log(`[SW Click Action] 'view_device' for: ${notificationData.deviceId}`); focusMessage = { type: 'focusDevice', deviceId: notificationData.deviceId }; urlToOpen = `${targetUrl}?focusDevice=${notificationData.deviceId}`; } else { console.warn("[SW Click Action] 'view_device' clicked, but no deviceId in data."); focusMessage = { type: 'focusApp' }; } }
    else if (!action) { console.log('[SW Click Action] Clicked notification body.'); if (notificationData?.deviceId) { focusMessage = { type: 'focusDevice', deviceId: notificationData.deviceId }; urlToOpen = `${targetUrl}?focusDevice=${notificationData.deviceId}`; } else { focusMessage = { type: 'focusApp' }; } }
    else { console.log(`[SW Click Action] Unhandled action: '${action}'`); focusMessage = { type: 'focusApp' }; }
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => { let focusedClient = null; for (const client of clientList) { if (new URL(client.url).pathname === '/' && 'focus' in client) { focusedClient = client; break; } } if (focusedClient) { return focusedClient.focus().then(() => { if (focusMessage) focusedClient.postMessage(focusMessage); }).catch(focusErr => { console.error('[SW Click] Error focusing client:', focusErr); if (clients.openWindow) { console.log('[SW Click] Focusing failed. Opening new window:', urlToOpen); return clients.openWindow(urlToOpen); } }); } else { if (clients.openWindow) { console.log('[SW Click] No matching client found. Opening new window:', urlToOpen); return clients.openWindow(urlToOpen); } else { console.warn('[SW Click] clients.openWindow() is not supported.'); } } }).catch(err => { console.error('[SW Click] Error handling notification click:', err); }));
});

// --- Message Listener for SKIP_WAITING (Keep as is) ---
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log(`[SW-${CACHE_NAME}] Received SKIP_WAITING message. Activating new worker...`);
        self.skipWaiting();
    }
});

console.log(`[SW-${CACHE_NAME}] Script loaded. Event listeners attached.`);