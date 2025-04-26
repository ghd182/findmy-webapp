// app/static/js/api.js

window.AppApi = {
    _fetch: async function (url, options = {}) {
        // --- Helper to get CSRF token (ensure this exists or add it) ---
        function getCsrfToken() {
            return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        }

        console.log(`API Call: ${options.method || 'GET'} ${url}`, options.body ? (typeof options.body === 'string' ? 'JSON body' : 'FormData/Other body') : '');
        let response;
        const originalRequestUrl = url; // Keep track for error messages

        try {
            const defaultHeaders = {
                'Accept': 'application/json',
                ...(options.headers || {}),
            };



            // Determine method (default to GET)
            const method = options.method?.toUpperCase() || 'GET';

            // Automatically add CSRF token header for relevant methods
            if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
                const csrfToken = getCsrfToken();
                if (csrfToken) {
                    defaultHeaders['X-CSRFToken'] = csrfToken;
                    console.debug(`[API Fetch] Added X-CSRFToken header for ${method} ${url}`);
                } else {
                    // Log a warning but proceed? Or throw an error?
                    // Proceeding might be okay if some POSTs are exempt, but risky.
                    // Let's throw an error to enforce protection.
                    console.error("[API Fetch] CSRF meta tag not found. Cannot send protected request.");
                    throw new Error("CSRF token is missing, cannot perform action.");
                }
            }

            // Set Content-Type for JSON bodies
            if (options.body && typeof options.body === 'string' && !defaultHeaders['Content-Type']) {
                defaultHeaders['Content-Type'] = 'application/json';
            }

            response = await fetch(url, { ...options, method: method, headers: defaultHeaders });

            const contentType = response.headers.get("content-type");
            const isJson = contentType && contentType.includes("application/json");

            if (!response.ok) {
                let errorData; let errorMessage = `HTTP error ${response.status}`;
                if (isJson) { try { errorData = await response.json(); errorMessage = errorData.error || errorData.description || errorData.message || errorMessage; } catch (e) { errorMessage = `${errorMessage} (Failed to parse JSON error response)`; errorData = { message: errorMessage }; } }
                else { try { const text = await response.text(); errorMessage = `${errorMessage}: ${text.substring(0, 150)}...`; } catch (e) { /* ignore */ } errorData = { message: errorMessage }; }
                const error = new Error(errorMessage); error.status = response.status; error.code = errorData?.code || `HTTP_${response.status}`; error.data = errorData;
                console.error(`API Error ${error.status} (${error.code || 'N/A'}) on ${url}: ${error.message}`, error.data);

                // --- Specific CSRF Error Handling (keep this) ---
                if (error.status === 400 && (error.code === 'CSRF Error' || (error.message && error.message.includes('CSRF')) || (error.data?.message && error.data.message.includes('CSRF token is missing')))) {
                    console.warn("[API Fetch CSRF] Detected CSRF error. Showing dialog.");
                    if (window.AppUI && typeof window.AppUI.showErrorDialog === 'function') {
                        AppUI.showErrorDialog("Security Token Error", "Your security token has expired or is invalid. Please <strong>reload the page</strong> and try the action again.");
                    } else { alert("Security Token Error: Your session may have expired. Please reload the page and try again."); }
                    return Promise.reject({ code: 'CSRF_ERROR_HANDLED', message: 'CSRF token error, user notified.' });
                }
                // --- End Specific CSRF ---
                throw error; // Throw other errors
            }

            if (isJson) { const data = await response.json(); console.log(`API Response OK (JSON) from ${url}:`, data); return data; }
            else { /* Strict check: non-JSON OK response is an error */ const errorText = `API Error: Expected JSON response but received Content-Type: ${contentType || 'N/A'} for ${url}`; console.error(errorText); const error = new Error("Invalid response format from server."); error.status = response.status; error.code = 'INVALID_CONTENT_TYPE'; error.data = { message: errorText }; throw error; }

        } catch (error) {
            // --- Cloudflare Access Error Detection ---
            const isCorsFetchError = error instanceof TypeError && error.message.includes('Failed to fetch');
            // Check if the error message contains the Cloudflare URL OR if the SW sent our specific code
            const isCloudflareAccessUrlInError = error.message.includes('cloudflareaccess.com');
            const isCloudflareCode = error.code === 'CLOUDFLARE_AUTH_REQUIRED'; // Check code from SW
        
            if ((isCorsFetchError && isCloudflareAccessUrlInError) || isCloudflareCode) {
                console.warn("[API Fetch] Detected potential Cloudflare Access block.", error);
                if (window.AppUI && typeof window.AppUI.showCloudflareReauthPrompt === 'function') {
                    // Check if prompt is already shown to prevent duplicates
                    const existingPrompt = document.getElementById('confirmation-dialog-overlay');
                     if (!existingPrompt || !existingPrompt.classList.contains('show')) {
                         AppUI.showCloudflareReauthPrompt(originalRequestUrl);
                     } else {
                         console.log("[API Fetch] Cloudflare prompt already visible, skipping new one.");
                     }
                } else {
                    // Fallback if UI isn't ready
                    alert("Your security session may have expired. Please reload the page to re-authenticate.");
                }
                // Reject the promise to signal failure, but mark it as handled
                return Promise.reject({ code: 'CLOUDFLARE_AUTH_REQUIRED', message: 'Cloudflare Access re-authentication needed.' });
            }
            // --- END: Cloudflare Access Error Detection ---
    
            // Handle other errors (CSRF Handled, Network Errors etc.)
            if (error.code === 'CSRF_ERROR_HANDLED') {
                return Promise.reject(error); // Don't re-handle
            }
            // If it wasn't Cloudflare, treat TypeError as likely network issue
            if (!error.status && error instanceof TypeError) {
                 error.message = `Network error or server unreachable fetching ${originalRequestUrl}. Are you offline?`;
                 error.code = 'NETWORK_ERROR';
             } else if (!error.status) { // Other non-HTTP errors
                error.message = `Error fetching ${originalRequestUrl}: ${error.message}`;
                error.code = error.code || 'FETCH_ERROR';
            }
            console.error(`[API Fetch Catch] Unhandled Error: ${error.code || 'N/A'} - ${error.message}`); // Log other errors
            throw error; // Re-throw other errors
        }
    }, // End _fetch

    triggerUserRefresh: async function () { // NEW FUNCTION
        return await this._fetch('/api/user/refresh', {
            method: 'POST',
            // No body needed
        });
    },

    /** Fetch all devices and their latest status */
    fetchDevices: async function () { return await this._fetch('/api/devices'); },
    /** Fetch all global geofence definitions */
    fetchGlobalGeofences: async function () { return await this._fetch('/api/geofences'); },
    /** Update device display properties (name, label, color) */
    updateDeviceDisplay: async function (deviceId, displayData) { return await this._fetch(`/api/devices/${deviceId}`, { method: 'PUT', body: JSON.stringify(displayData), }); },
    /** Update the geofences linked to a device */
    updateDeviceGeofenceLinks: async function (deviceId, links) { return await this._fetch(`/api/devices/${deviceId}/geofence_links`, { method: 'PUT', body: JSON.stringify({ linked_geofences: links }), }); },
    /** Create a new global geofence */
    createGeofence: async function (geofenceData) { return await this._fetch('/api/geofences', { method: 'POST', body: JSON.stringify(geofenceData), }); },
    /** Update an existing global geofence */
    updateGeofence: async function (geofenceId, geofenceData) { return await this._fetch(`/api/geofences/${geofenceId}`, { method: 'PUT', body: JSON.stringify(geofenceData), }); },
    /** Delete a global geofence */
    deleteGeofence: async function (geofenceId) { return await this._fetch(`/api/geofences/${geofenceId}`, { method: 'DELETE', }); },
    /** Subscribe to push notifications */
    subscribePush: async function (subscriptionObject) { return await this._fetch('/api/subscribe', { method: 'POST', body: JSON.stringify(subscriptionObject), }); },
    /** Unsubscribe from push notifications */
    unsubscribePush: async function (endpoint) { return await this._fetch('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: endpoint }), }); },
    /** Fetch VAPID public key */
    getVapidKey: async function () { return await this._fetch('/api/vapid_public_key'); },

    // --- Config API Calls (Modified) ---
    /** Fetch a specific server-side config part */
    getConfigPart: async function (partName) {
        return await this._fetch(`/api/config/get_part/${partName}`);
    },

    /** Apply imported server-side config parts */
    applyImportedConfig: async function (partsToImport) {
        return await this._fetch('/api/config/import_apply', {
            method: 'POST',
            body: JSON.stringify({ parts: partsToImport }),
        });
    },

    // --- NEW API Calls ---
    /** Fetch user's theme preferences */
    fetchUserPreferences: async function () {
        return await this._fetch('/api/user/preferences');
    },
    /** Update user's theme preferences */
    updateUserPreferences: async function (themeMode, themeColor) {
        return await this._fetch('/api/user/preferences', {
            method: 'PUT',
            body: JSON.stringify({ theme_mode: themeMode, theme_color: themeColor }),
        });
    },


    testDeviceNotification: async function (deviceId, notificationType) {
        return await this._fetch(`/api/devices/${deviceId}/test_notification/${notificationType}`, {
            method: 'POST',
        });
    },

    // --- NEW: Notification History APIs ---
    fetchNotificationHistory: async function () {
        return await this._fetch('/api/notifications/history'); // Add limit/offset later if needed
    },
    markNotificationRead: async function (notificationId) {
        return await this._fetch(`/api/notifications/history/${notificationId}/read`, { method: 'PUT' });
    },
    markNotificationUnread: async function (notificationId) {
        return await this._fetch(`/api/notifications/history/${notificationId}/unread`, { method: 'PUT' });
    },
    deleteNotification: async function (notificationId) {
        return await this._fetch(`/api/notifications/history/${notificationId}`, { method: 'DELETE' });
    },
    deleteAllNotifications: async function () {
        return await this._fetch('/api/notifications/history', { method: 'DELETE' });
    },

    deleteDevice: async function (deviceId) {
        return await this._fetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
    },

    /** Delete the current user's account */
    deleteAccount: async function () { // Add password if verification needed: (password)
        // const payload = password ? { password: password } : {};
        return await this._fetch('/api/user/delete', {
            method: 'DELETE',
            // body: password ? JSON.stringify(payload) : undefined, // Include if password needed
        });
    },

    // --- START: New Share API Calls ---
    /**
     * Creates a share link for a device.
     * @param {string} deviceId - The ID of the device to share.
     * @param {string} duration - Duration string (e.g., "1h", "24h", "7d", "indefinite").
     * @param {string} [note] - Optional note for the share.
     * @returns {Promise<object>} The created share details including share_url.
     */
    createDeviceShare: async function (deviceId, duration, note) {
        const payload = { duration: duration };
        if (note && note.trim().length > 0) payload.note = note.trim();
        return await this._fetch(`/api/devices/${deviceId}/share`, { method: 'POST', body: JSON.stringify(payload) });
    },
    fetchUserShares: async function () { return await this._fetch('/api/shares'); },
    revokeShare: async function (shareId) { return await this._fetch(`/api/shares/${shareId}`, { method: 'DELETE' }); },
    // --- START: New Share Management Functions ---
    /**
     * Toggles the active status of a share.
     * @param {string} shareId - The ID of the share.
     * @param {boolean} isActive - The desired active status (true=resume, false=suspend).
     * @returns {Promise<object>} The updated share object.
     */
    toggleShareStatus: async function (shareId, isActive) {
        return await this._fetch(`/api/shares/${shareId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ active: !!isActive }) // Ensure boolean
        });
    },
    /**
     * Updates the duration and optionally the note of an existing share.
     * @param {string} shareId - The ID of the share.
     * @param {string} duration - New duration string (e.g., "1h", "indefinite").
     * @param {string|null} [note] - Optional new note (null to leave unchanged).
     * @returns {Promise<object>} The updated share object.
     */
    updateShareDuration: async function (shareId, duration, note = null) {
        const payload = { duration: duration };
        if (note !== null) { // Only include note if it's explicitly passed (even if empty string)
            payload.note = (note || "").trim();
        }
        return await this._fetch(`/api/shares/${shareId}/duration`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }
    // --- END: New Share API Calls ---

    // Note: upload_device_file uses the base _fetch now, which includes CSRF
};