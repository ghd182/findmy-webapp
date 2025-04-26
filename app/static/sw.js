// app/static/sw.js

const CACHE_NAME = 'findmy-cache-v14'; // <<< INCREMENT CACHE NAME
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
    '/static/img/input_circle_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png',
    '/static/img/output_circle_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png',
    '/static/img/labs_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png',
    '/static/img/battery_alert_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png',
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

async function notifyClientOfCloudflareAuth(failedUrl) {
    console.log('[SW] Attempting to notify client about Cloudflare Auth requirement.');
    const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
    });
    if (clients && clients.length) {
        clients.forEach(client => {
            console.log(`[SW] Sending CLOUDFLARE_AUTH_REQUIRED message to client ${client.id}`);
            client.postMessage({ type: 'CLOUDFLARE_AUTH_REQUIRED', url: failedUrl });
        });
    } else {
        console.warn('[SW] No active clients found to notify about Cloudflare Auth.');
    }
}


// --- Fetch Event (REVISED STRATEGY) ---
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const request = event.request;

    // --- 1. API Calls: Network Only (with Cloudflare Detection) ---
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).catch(async error => { // Make catch async
                const isCorsFetchError = error instanceof TypeError && error.message.includes('Failed to fetch');
                const isSameOriginRequest = url.origin === self.location.origin;

                if (isCorsFetchError && isSameOriginRequest) {
                    console.warn(`[SW API Catch] CORS/Fetch error for same-origin API ${url.pathname}. Suspecting Cloudflare block.`);
                    await notifyClientOfCloudflareAuth(url.href); // Notify the client page
                    // Respond with 401 to signal auth issue clearly to the fetch call
                    return new Response(JSON.stringify({
                        error: 'Authentication Required', code: 'CLOUDFLARE_AUTH_REQUIRED',
                        message: 'Access session may have expired. Please re-authenticate.'
                    }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }
                // Original fallback for other network errors
                console.warn(`[SW API Catch] Other network error for API ${request.method} ${url.pathname}:`, error);
                if (request.method === 'GET') {
                    return new Response(JSON.stringify({ error: 'Offline', message: 'Network connection unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
                }
                throw error; // Rethrow for non-GET or other errors
            })
        );
        return;
    }

    // --- 2. Auth/Action Routes: Bypass SW (Keep) ---
    if (url.pathname === '/logout' || url.pathname === '/login' || url.pathname === '/register' || url.pathname === '/manage_apple_creds') {
        console.log(`[SW Fetch] Bypassing SW for critical route: ${url.pathname}`);
        return; // Let browser handle directly
    }

    // --- 3. Static Assets: Stale-While-Revalidate (Simplified Error Handling) ---
    // Let the browser handle CORS errors for static assets more directly initially.
    // The main app.js fallback loader will catch the M3 utils error.
    if (request.method === 'GET' && (url.pathname.startsWith('/static/') || url.pathname === '/favicon.ico' || url.pathname === '/public/manifest.json')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(request);
                const networkFetchPromise = fetch(request).then(networkResponse => {
                    if (networkResponse && networkResponse.ok) {
                        cache.put(request, networkResponse.clone());
                    }
                    // Don't log *every* non-ok status as a warning here if it might be CF redirect
                    return networkResponse;
                }).catch(error => {
                    // Log the fetch failure but don't intercept specifically for Cloudflare here.
                    // Let the main page script handle failures for critical JS like M3 utils.
                    console.warn(`[SW Static Catch] SWR: Network fetch failed for ${url.pathname}:`, error);
                    throw error; // Rethrow to trigger cache fallback or browser error
                });

                return cachedResponse || networkFetchPromise;
            }).catch(error => {
                console.error(`[SW Static] Final error (cache or network) for ${request.url}:`, error);
                // Return generic 404 if both cache and network fail.
                return new Response(null, { status: 404 });
            })
        );
        return; // Handled static asset
    }

    // --- 4. HTML Navigation Requests (REVISED LOGIC) ---
    if (request.mode === 'navigate' && request.method === 'GET' && url.origin === self.location.origin) {

        if (url.pathname === '/') {
            // Network First for Root App Shell
            console.log(`[SW Fetch] Network First (Root Shell Nav): ${url.pathname}`);
            event.respondWith(
                fetch(request)
                    .then(response => {
                        if (response && response.ok && response.type === 'basic') {
                            // Cache successful response
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(new Request('/'), responseToCache);
                                console.log(`[SW Fetch] Cached root '/' response.`);
                            });
                            return response; // Serve fresh response
                        }
                        // Network error/bad response, try cache (don't throw error yet)
                        console.warn(`[SW Fetch] Network First: Bad network response for root shell (${response?.status}). Trying cache...`);
                        return caches.match(new Request('/'));
                    })
                    .catch(async (error) => {
                        // Network failed completely, try cache
                        console.warn(`[SW Fetch] Network First: Network failed for root shell. Serving '/' from cache. Error:`, error);
                        const cachedResponse = await caches.match(new Request('/'));
                        if (cachedResponse) {
                            return cachedResponse; // Serve cached version
                        } else {
                            // Network failed AND cache miss - CRITICAL FAILURE
                            console.error(`[SW Fetch] Network First: Network failed and root '/' not in cache.`);
                            // *** Let the browser handle the failure ***
                            // Re-throwing the original network error is often best here.
                            // This allows the client-side JS fetch (if any part loaded)
                            // or the browser's default offline page to potentially show.
                            throw error;
                            // ---- OLD response that crashed ----
                            // return new Response("Network error and page not cached.", { status: 503, statusText: "Service Unavailable" });
                            // ---- ------------------------- ----
                        }
                    })
            );
        } else { // Other HTML pages (like /public/shared/*) - Network Only
            console.log(`[SW Fetch] Network Only (Other HTML Nav): ${url.pathname}`);
            // Let browser handle fetch and errors directly
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