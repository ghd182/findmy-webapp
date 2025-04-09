// app/static/sw.js

// Keep existing constants and install/activate listeners...
const CACHE_NAME = 'findmy-cache-v11'; // Increment if significant changes
const urlsToCache = [
  // Core App Shell
  '/', // Explicitly cache the root
  '/static/css/style.css',
  '/static/js/config.js',
  '/static/js/state.js',
  '/static/js/utils.js',
  '/static/js/api.js',
  '/static/js/ui.js',
  '/static/js/map.js',
  '/static/js/notifications.js',
  '/static/js/app.js',

  // Icons
  '/static/icons/web-app-manifest-192x192.png',
  '/static/icons/web-app-manifest-512x512.png',
  '/static/icons/favicon.svg',
  '/static/icons/apple-touch-icon.png',
  '/static/icons/icon.svg',
  '/static/img/wifi_tethering_16dp.png', // Examples - keep if used
  '/static/img/crisis_alert_16dp.png',   // Examples - keep if used
  '/static/img/labs_16dp.png',         // Examples - keep if used
   '/static/img/battery_warning_16dp.png',
   '/favicon.ico', // Use root route now handled by Flask

  // Leaflet assets
  '/static/libs/leaflet/leaflet.js',
  '/static/libs/leaflet/leaflet.css',
  // '/static/styles/leaflet/leaflet.css',
  '/static/styles/leaflet/images/marker-icon.png',
  '/static/styles/leaflet/images/marker-icon-2x.png',
  '/static/styles/leaflet/images/marker-shadow.png',

  // Material Icons & Symbols CSS (fonts are loaded BY the CSS)
  '/static/styles/material-icons/material-icons.css',
  '/static/styles/material-symbols/material-symbols-outlined.css',
  // Add specific WOFF2 font files if you want explicit caching (optional, CSS usually triggers load)
  // e.g., '/static/fonts/material-icons.woff2',
  // e.g., '/static/fonts/material-symbols-outlined.woff2',
  // You'll need to list the actual filenames you downloaded

  // Material Color Utilities (local fallback)
  '/static/libs/material-color/material-color-utilities.esm.js',
  // Manifest (served by blueprint)
  '/public/manifest.json', // Correct path

];

// --- Install Event ---
self.addEventListener('install', event => {
  console.log(`[SW-${CACHE_NAME}] Install event started.`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log(`[SW-${CACHE_NAME}] Caching core assets... (${urlsToCache.length} items)`);
        // Simplified error handling for install
        const cachePromises = urlsToCache.map(urlToCache => {
          return cache.add(urlToCache).catch(err => {
            console.warn(`[SW-${CACHE_NAME}] Failed to cache on install: ${urlToCache}`, err);
            // Don't throw error for non-critical assets during install
            // Critical assets check removed for simplicity, rely on fetch strategy
            return null; // Indicate optional asset failed
          });
        });
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log(`[SW-${CACHE_NAME}] Core assets caching finished.`);
        // Don't call skipWaiting here immediately. Let the update UX handle it.
        // return self.skipWaiting(); // <<< REMOVED immediate skipWaiting
      })
      .catch(error => {
        // This catch might still trigger if a critical fetch fails network-wise
        console.error(`[SW-${CACHE_NAME}] Installation failed:`, error);
      })
  );
});

// --- Activate Event ---
self.addEventListener('activate', event => {
  console.log(`[SW-${CACHE_NAME}] Activate event started.`);
  event.waitUntil(
    (async () => {
      // --- Client Claiming (Keep) ---
      if (self.clients && typeof self.clients.claim === 'function') {
        try { await self.clients.claim(); console.log(`[SW-${CACHE_NAME}] Clients claimed successfully.`); }
        catch (err) { console.error(`[SW-${CACHE_NAME}] Error claiming clients:`, err); }
      }
      // --- Cache Cleanup (Keep) ---
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

// --- Fetch Event (Implementing Stale-While-Revalidate for Static Assets) ---
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network Only for API calls (unchanged)
  if (url.pathname.startsWith('/api/')) {
    // console.log(`[SW Fetch] Network Only: ${url.pathname}`);
    event.respondWith(
      fetch(event.request).catch(error => {
        console.warn(`[SW Fetch] Network request failed for API ${event.request.method} ${url.pathname}:`, error);
        if (event.request.method === 'GET') {
          return new Response(JSON.stringify({ error: 'Offline', message: 'Network connection unavailable.' }), {
            status: 503, headers: { 'Content-Type': 'application/json' }
          });
        }
        throw error;
      })
    );
    return;
  }

  // --- MODIFICATION START ---
  // Bypass SW for logout and potentially other non-cacheable action routes
  if (url.pathname === '/logout' || url.pathname === '/login' || url.pathname === '/register' || url.pathname === '/manage_apple_creds') {
    console.log(`[SW Fetch] Bypassing SW for navigation to: ${url.pathname}`);
    // Let the browser handle the request directly without interception
    return; // IMPORTANT: Do not call event.respondWith()
  }
  // --- MODIFICATION END ---


  // Network First for OTHER HTML Navigations (e.g., /, /?page=...)
  if (event.request.mode === 'navigate' && event.request.method === 'GET' && url.origin === self.location.origin) {
    console.log(`[SW Fetch] Network First (HTML Nav): ${url.pathname}${url.search}`);
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Only cache valid, basic responses (like the main index.html)
          if (response && response.ok && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              // Cache the root request '/' specifically
              cache.put(new Request('/'), responseToCache);
              console.log(`[SW Fetch] Cached root '/' response.`);
            });
            return response;
          } else {
            // If network response is bad (redirect, error, opaque), try cache
            console.warn(`[SW Fetch] Network First: Bad network response for ${url.pathname}${url.search} (${response?.status}). Trying cache for '/'...`);
            return caches.match('/'); // Fallback to root cache
          }
        })
        .catch(async (error) => {
          // Network failed completely, try cache for root
          console.warn(`[SW Fetch] Network First: Network failed for ${url.pathname}${url.search}. Serving '/' from cache. Error:`, error);
          const cachedResponse = await caches.match('/');
          if (cachedResponse) {
            return cachedResponse;
          } else {
            console.error(`[SW Fetch] Network First: Network failed and '/' not in cache.`);
            // Optional: Return a generic offline HTML page if available
            // return caches.match('/offline.html');
            throw error; // Rethrow if no cache and no offline page
          }
        })
    );
    return;
  }


  // Stale-While-Revalidate for Static Assets (unchanged)
  if (event.request.method === 'GET' && (
    url.pathname.startsWith('/static/') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/public/manifest.json' // Correct manifest path
  )) {
    // console.log(`[SW Fetch] StaleWhileRevalidate: ${url.pathname}`); // Can be noisy
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        const networkFetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          } else if (networkResponse) {
            console.warn(`[SW Fetch] StaleWhileRevalidate: Network fetch for ${url.pathname} returned status ${networkResponse.status}. Not caching.`);
          }
          return networkResponse;
        }).catch(error => {
          console.warn(`[SW Fetch] StaleWhileRevalidate: Network fetch failed for ${url.pathname}:`, error);
          return null;
        });
        return cachedResponse || networkFetchPromise;
      })
    );
    return;
  }

  // Let the browser handle any other requests by default
  // console.log(`[SW Fetch] Default browser handling: ${url.pathname}`);
});

// --- Push Event Listener (Keep as is, but ensure icon paths are correct) ---
self.addEventListener('push', event => {
  console.log('[SW] Push Received.');
  let payload = {};
  try { payload = event.data.json(); console.log('[SW] Push data payload:', payload); }
  catch (e) { console.error('[SW] Error parsing push data:', e); payload = { notification: { title: "Notification", body: "Error parsing content." } }; }

  const notificationData = payload.notification || {};
  const title = notificationData.title || 'FindMy Alert';
  // --- Construct options, including actions from payload ---
  const options = {
    body: notificationData.body || 'You received a notification.',
    icon: notificationData.icon || '/static/icons/favicon.svg',
    badge: notificationData.badge || '/static/icons/badge-icon.png',
    tag: notificationData.tag || 'findmy-notification-' + Date.now(),
    renotify: notificationData.renotify || false,
    requireInteraction: notificationData.requireInteraction || false,
    data: notificationData.data || {}, // Ensure data exists
    actions: notificationData.actions || [] // Add actions from payload
  };
  // --- ------------------------------------------------- ---
  console.log('[SW] Showing notification:', title, options);
  const notificationPromise = self.registration.showNotification(title, options);
  event.waitUntil(notificationPromise);
});

// --- Notification Click Listener (MODIFIED) ---
self.addEventListener('notificationclick', event => {
  const clickedNotification = event.notification;
  const notificationData = clickedNotification.data;
  const action = event.action; // <<< Get the clicked action identifier

  console.log('[SW] Notification click Received.');
  console.log('[SW] Notification Tag:', clickedNotification.tag);
  console.log('[SW] Notification Data Payload:', notificationData);
  console.log('[SW] Clicked Action:', action); // Log the action

  clickedNotification.close();

  let targetUrl = new URL('/', self.location.origin).href;
  let focusMessage = null;
  let urlToOpen = targetUrl; // Default URL to open

  // --- Determine action based on event.action ---
  if (action === 'view_device') {
    if (notificationData?.deviceId) {
      console.log(`[SW Click Action] 'view_device' for: ${notificationData.deviceId}`);
      focusMessage = { type: 'focusDevice', deviceId: notificationData.deviceId };
      urlToOpen = `${targetUrl}?focusDevice=${notificationData.deviceId}`; // Append to URL for new window case
    } else {
      console.warn("[SW Click Action] 'view_device' clicked, but no deviceId in data.");
      focusMessage = { type: 'focusApp' }; // Fallback to generic focus
    }
  } else if (!action) {
    // User clicked the main body of the notification (no specific action)
    console.log('[SW Click Action] Clicked notification body.');
    // Default behavior: focus app, or device if ID is present
    if (notificationData?.deviceId) {
      focusMessage = { type: 'focusDevice', deviceId: notificationData.deviceId };
      urlToOpen = `${targetUrl}?focusDevice=${notificationData.deviceId}`;
    } else {
      focusMessage = { type: 'focusApp' };
    }
  } else {
    // Handle other potential future actions? Or ignore them?
    console.log(`[SW Click Action] Unhandled action: '${action}'`);
    focusMessage = { type: 'focusApp' }; // Default to focusing app
  }
  // --- End Action Determination ---

  // --- Client Focusing/Opening Logic (Unchanged) ---
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      let focusedClient = null;
      for (const client of clientList) {
        if (new URL(client.url).pathname === '/' && 'focus' in client) {
          focusedClient = client; break;
        }
      }
      if (focusedClient) {
        return focusedClient.focus().then(() => {
          if (focusMessage) focusedClient.postMessage(focusMessage);
        }).catch(focusErr => {
          console.error('[SW Click] Error focusing client:', focusErr);
          if (clients.openWindow) {
            console.log('[SW Click] Focusing failed. Opening new window:', urlToOpen);
            return clients.openWindow(urlToOpen);
          }
        });
      } else {
        if (clients.openWindow) {
          console.log('[SW Click] No matching client found. Opening new window:', urlToOpen);
          return clients.openWindow(urlToOpen);
        } else {
          console.warn('[SW Click] clients.openWindow() is not supported.');
        }
      }
    }).catch(err => { console.error('[SW Click] Error handling notification click:', err); })
  );
});


// --- NEW: Message Listener for SKIP_WAITING ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log(`[SW-${CACHE_NAME}] Received SKIP_WAITING message. Activating new worker...`);
    self.skipWaiting();
  }
});


console.log(`[SW-${CACHE_NAME}] Script loaded. Event listeners attached.`);