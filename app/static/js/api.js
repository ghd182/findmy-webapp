// app/static/js/api.js

window.AppApi = {
    _fetch: async function (url, options = {}) {
        console.log(`API Call: ${options.method || 'GET'} ${url}`, options.body ? (typeof options.body === 'string' ? 'JSON body' : 'FormData/Other body') : '');
        let response;
        try {
            const defaultHeaders = {
                'Accept': 'application/json', // Explicitly prefer JSON
                ...(options.headers || {}),
            };
            if (options.body && typeof options.body === 'string') {
                defaultHeaders['Content-Type'] = 'application/json';
            }
            const method = options.method?.toUpperCase() || 'GET';
            if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
                const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
                if (csrfToken) { defaultHeaders['X-CSRFToken'] = csrfToken; }
                else { console.warn("[API] CSRF meta tag not found."); }
            }

            response = await fetch(url, { ...options, headers: defaultHeaders });

            const contentType = response.headers.get("content-type");
            const isJson = contentType && contentType.includes("application/json");

            if (!response.ok) {
                // Handle non-OK responses (errors)
                let errorData;
                let errorMessage = `HTTP error ${response.status}`;
                if (isJson) {
                    try { errorData = await response.json(); errorMessage = errorData.error || errorData.description || errorData.message || errorMessage; }
                    catch (e) { errorMessage = `${errorMessage} (Failed to parse JSON error response)`; errorData = { message: errorMessage }; }
                } else {
                    try { const text = await response.text(); errorMessage = `${errorMessage}: ${text.substring(0, 150)}...`; }
                    catch (e) { /* ignore inability to get text */ }
                    errorData = { message: errorMessage };
                }
                const error = new Error(errorMessage);
                error.status = response.status;
                error.code = errorData?.code || `HTTP_${response.status}`;
                error.data = errorData;
                console.error(`API Error ${error.status} (${error.code || 'N/A'}) on ${url}: ${error.message}`, error.data);
                throw error;
            }

            // Handle OK responses
            if (isJson) {
                const data = await response.json();
                console.log(`API Response OK (JSON) from ${url}:`, data);
                return data;
            } else {
                // --- STRICTER CHECK: Treat non-JSON 200 OK as an error ---
                const errorText = `API Error: Expected JSON response but received Content-Type: ${contentType || 'N/A'} for ${url}`;
                console.error(errorText);
                const error = new Error("Invalid response format from server.");
                error.status = response.status; // Still 200, but bad format
                error.code = 'INVALID_CONTENT_TYPE';
                error.data = { message: errorText };
                throw error;
                // --- ---------------------------------------------------- ---
            }

        } catch (error) {
            // --- START: Specific CSRF Error Handling ---
            if (error.status === 400 && (error.code === 'CSRF Error' || (error.message && error.message.includes('CSRF')))) {
                console.warn("[API Fetch CSRF] Detected CSRF error. Showing dialog.");
                // Use AppUI to show a specific dialog
                if (window.AppUI && typeof window.AppUI.showErrorDialog === 'function') {
                    AppUI.showErrorDialog(
                        "Security Token Error",
                        "Your session security token may have expired or is invalid. Please <strong>reload the page</strong> and try the action again."
                    );
                } else {
                    // Fallback alert if AppUI isn't ready
                    alert("Security Token Error: Your session may have expired. Please reload the page and try again.");
                }
                // IMPORTANT: Do not re-throw the error here, as we've handled it with the dialog.
                // We might want to return a specific object or null to indicate failure to the caller.
                // Let's return a rejected Promise with a specific code so callers can optionally check.
                return Promise.reject({ code: 'CSRF_ERROR_HANDLED', message: 'CSRF token error, user notified.' });
            }
            // --- END: Specific CSRF Error Handling ---

            // Handle Network Errors / Other Errors
            if (!error.status) { // Network error or CORS issue maybe
                console.error(`API Network Error on ${url}:`, error);
                error.message = `Network error or server unreachable: ${error.message}`;
                error.code = 'NETWORK_ERROR';
            }
            // Re-throw other errors
            throw error;
        }
    },

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