// app/static/js/notifications.js


window.AppNotifications = {
    registerServiceWorker: function () {
        if (!('serviceWorker' in navigator)) {
            console.warn('Service workers are not supported.');
            this.updateNotificationButtonState(); // Update UI to show not supported
            return Promise.reject('Service workers not supported');
        }

        console.log("Registering Service Worker at /sw.js");
        // Register SW script located at the root, controlling the root scope
        return navigator.serviceWorker.register("/sw.js", { scope: '/' })
            .then(reg => {
                console.log('Service Worker registered successfully. Scope:', reg.scope);
                AppState.swRegistration = reg; // Store registration in state

                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    if (installingWorker == null) return;
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('New content is available; please refresh.');
                            AppUI.showConfirmationDialog("Update Available", "A new version of the app is available. Please refresh the page.", () => window.location.reload());
                        } else if (installingWorker.state === 'installed') {
                            console.log('Content is cached for offline use.');
                        }
                    };
                };

                this.updateNotificationButtonState();
                return navigator.serviceWorker.ready;
            })
            .then(readyRegistration => {
                console.log('Service Worker is active and ready.');
                AppState.swRegistration = readyRegistration; // Ensure state has the active registration
                this.ensureSubscription();

                navigator.serviceWorker.addEventListener('message', event => {
                    console.log('[Client] Received message from SW:', event.data);
                    if (event.data && event.data.type === 'SW_UPDATE') {
                        console.log('[Client] SW Update Available message received.');
                        // Call a UI function to show the update prompt
                        if (window.AppUI && typeof window.AppUI.showUpdateAvailablePrompt === 'function') {
                            AppUI.showUpdateAvailablePrompt(event.source); // Pass the worker source if needed
                        } else {
                            // Fallback if UI function isn't ready or defined
                            if (confirm("A new version is available. Refresh now?")) {
                                window.location.reload(); // Less ideal fallback
                            }
                        }
                    }
                    // Handle other message types if needed
                    else if (event.data?.type === 'focusDevice' && event.data.deviceId) {
                        console.log(`[Client] Received focus message for device ${event.data.deviceId}`);
                        // Ensure map is ready before attempting to view
                        if (window.AppMap && AppState.mapReady) {
                            AppMap.viewDeviceOnMap(event.data.deviceId);
                        } else {
                            console.warn("[Client] Map not ready, cannot focus device from SW message immediately.");
                            // Optionally queue the action or just ignore if map isn't ready
                        }
                    }
                });

                // --- NEW: Listen for Controller Change (for reload after SKIP_WAITING) ---
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    console.log('[Client] Controller changed. New SW activated.');
                    if (refreshing) return; // Avoid multiple reloads if event fires rapidly
                    refreshing = true;
                    console.log('[Client] Reloading page to use new Service Worker.');
                    window.location.reload();
                });
                // --- END: Listen for Controller Change ---



                return readyRegistration;
            })
            .catch(err => {
                console.error('Service Worker registration failed:', err);
                let message = `Could not register service worker. Check console for details. Error: ${err.message}`;
                if (err.name === 'SecurityError') { message = `Registration failed due to security restrictions. Ensure the page is served over HTTPS (except for localhost) and the 'Service-Worker-Allowed' header is correctly set if the script is not at the root. Error: ${err.message}`; }
                AppUI.showErrorDialog("Service Worker Error", message);
                this.updateNotificationButtonState();
                throw err;
            });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('Service Worker controller changed (new worker activated). Reloading recommended.');
            // window.location.reload();
        });
    },

    updateNotificationButtonState: function () {
        const notifyButton = document.getElementById('enable-notifications-button');
        const notifyStatus = document.getElementById('notification-status');
        const unsubscribeButton = document.getElementById('unsubscribe-button');
        const testButton = document.getElementById('test-notification-button');

        if (!notifyButton || !notifyStatus || !unsubscribeButton || !testButton) {
            // console.warn("Notification UI elements not found. Cannot update state.");
            return;
        }

        unsubscribeButton.style.display = 'none';
        notifyButton.disabled = false;
        notifyButton.textContent = "Enable Notifications";
        testButton.style.display = 'none';

        if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
            notifyStatus.textContent = "Not supported by browser";
            notifyButton.disabled = true;
            notifyButton.textContent = "Notifications N/A";
            return;
        }

        if (!AppConfig.VAPID_PUBLIC_KEY) {
            notifyStatus.textContent = "Disabled by server";
            notifyButton.disabled = true;
            notifyButton.textContent = "Notifications N/A";
            return;
        }

        const permission = Notification.permission;
        notifyStatus.textContent = `Permission: ${permission}`;

        if (!AppState.swRegistration) {
            if (permission === 'denied') { notifyStatus.textContent = "Blocked by browser"; notifyButton.textContent = "Notifications Blocked"; notifyButton.disabled = true; }
            else if (permission === 'default') { notifyStatus.textContent = "Click to enable"; }
            else { notifyStatus.textContent = "Enabled (Initializing...)"; notifyButton.textContent = "Subscribe"; }
            return;
        }

        AppState.swRegistration.pushManager.getSubscription()
            .then(subscription => {
                AppState.currentPushSubscription = subscription;

                switch (permission) {
                    case 'granted':
                        if (subscription) {
                            notifyStatus.textContent = "Enabled & Subscribed"; notifyButton.textContent = "Subscribed"; notifyButton.disabled = true; unsubscribeButton.style.display = 'inline-flex'; unsubscribeButton.disabled = false; testButton.style.display = 'inline-flex';
                        } else { notifyStatus.textContent = "Enabled, Not Subscribed"; notifyButton.textContent = "Subscribe"; notifyButton.disabled = false; }
                        break;
                    case 'denied':
                        notifyStatus.textContent = "Blocked by browser"; notifyButton.textContent = "Notifications Blocked"; notifyButton.disabled = true; break;
                    case 'default':
                        notifyStatus.textContent = "Click to enable"; notifyButton.textContent = "Enable Notifications"; notifyButton.disabled = false; break;
                }
            }).catch(err => { console.error("Error getting push subscription state:", err); notifyStatus.textContent = "Error checking status"; notifyButton.disabled = true; });
    },

    handleNotificationPermission: async function () {
        const button = document.getElementById('enable-notifications-button');
        if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator) || !AppConfig.VAPID_PUBLIC_KEY) {
            AppUI.showErrorDialog("Not Supported", "Notifications are not supported, or server configuration is incomplete."); this.updateNotificationButtonState(); return;
        }
        button.disabled = true;

        const currentPermission = Notification.permission;

        try {
            if (currentPermission === 'granted') {
                if (!AppState.currentPushSubscription) { console.log("Permission granted, attempting to subscribe..."); button.textContent = "Subscribing..."; await this.subscribeUser(); }
                else { console.log("Already subscribed."); this.updateNotificationButtonState(); }
                return;
            }
            if (currentPermission === 'denied') { AppUI.showErrorDialog("Permission Blocked", "Notification permission was previously blocked. Please enable it in your browser settings for this site."); this.updateNotificationButtonState(); return; }

            console.log("Requesting notification permission...");
            button.textContent = "Requesting Permission...";
            const permissionResult = await Notification.requestPermission();
            console.log('Notification permission result:', permissionResult);

            if (permissionResult === 'granted') { console.log('Permission granted, attempting to subscribe...'); button.textContent = "Subscribing..."; await this.subscribeUser(); }
            else { console.warn('Notification permission denied or dismissed.'); AppUI.showErrorDialog("Permission Denied", "You denied or dismissed the notification permission request."); this.updateNotificationButtonState(); }
        } catch (error) { console.error('Error handling notification permission or subscription:', error); AppUI.showErrorDialog("Error", `An error occurred: ${error.message}`); this.updateNotificationButtonState(); }
    },

    subscribeUser: async function () {
        console.log("Attempting to subscribe user...");
        if (!AppConfig.VAPID_PUBLIC_KEY) { AppUI.showErrorDialog("Error", "Server VAPID key missing."); this.updateNotificationButtonState(); return null; }
        if (!AppState.swRegistration) { AppUI.showErrorDialog("Error", "Service worker not ready."); this.updateNotificationButtonState(); return null; }

        try {
            const applicationServerKey = AppUtils.urlBase64ToUint8Array(AppConfig.VAPID_PUBLIC_KEY);
            console.log("Calling pushManager.subscribe...");
            const subscription = await AppState.swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey });
            console.log('User subscribed successfully:', subscription);
            AppState.currentPushSubscription = subscription;

            console.log("Sending subscription to backend...");
            try {
                const backendResponse = await AppApi.subscribePush(subscription);
                console.log(`Backend subscription sync successful:`, backendResponse);
                if (backendResponse && backendResponse.message) { AppUI.showConfirmationDialog("Subscribed!", "You have successfully subscribed to notifications."); }
                else { AppUI.showErrorDialog("Subscription Issue", "Subscribed locally, but server response was unexpected. Notifications might not work."); }
            } catch (backendError) {
                console.error("Failed to send subscription to backend:", backendError);
                AppUI.showErrorDialog("Subscription Issue", `Subscribed locally, but failed to sync with the server: ${backendError.message}. Notifications might not work until sync succeeds.`);
            }
            this.updateNotificationButtonState();
            return subscription;
        } catch (err) {
            console.error('Failed to subscribe the user:', err);
            AppState.currentPushSubscription = null;
            if (err.name === 'NotAllowedError' || Notification.permission === 'denied') { AppUI.showErrorDialog("Subscription Failed", "Notification permission was denied. Please enable it in browser settings."); }
            else { AppUI.showErrorDialog("Subscription Failed", `Could not subscribe to notifications. Error: ${err.name} - ${err.message}`); }
            this.updateNotificationButtonState();
            return null;
        }
    },

    unsubscribeUser: async function () {
        const subscription = AppState.currentPushSubscription;
        if (!subscription) { AppUI.showErrorDialog("Not Subscribed", "You are not currently subscribed."); this.updateNotificationButtonState(); return; }
        const unsubscribeButton = document.getElementById('unsubscribe-button');
        unsubscribeButton.disabled = true; unsubscribeButton.textContent = "Unsubscribing...";
        console.log("Attempting to unsubscribe:", subscription.endpoint);
        let backendError = null;
        try {
            const successful = await subscription.unsubscribe();
            if (successful) {
                console.log("Unsubscribed successfully on client.");
                const endpointToRemove = subscription.endpoint;
                AppState.currentPushSubscription = null;
                try { await AppApi.unsubscribePush(endpointToRemove); console.log("Sent unsubscribe request to backend."); }
                catch (error) { backendError = error; console.error("Error sending unsubscribe request to backend:", backendError); AppUI.showConfirmationDialog("Unsubscribed (Partial)", "Unsubscribed locally, but could not notify the server. You might receive old notifications temporarily."); }
                if (!backendError) { AppUI.showConfirmationDialog("Unsubscribed", "You have been unsubscribed from notifications."); }
                this.updateNotificationButtonState();
            } else { console.error("Client unsubscribe method returned false."); AppUI.showErrorDialog("Unsubscribe Failed", "Could not unsubscribe on the client. Please try again."); this.updateNotificationButtonState(); }
        } catch (error) { console.error("Error during client unsubscribe:", error); AppUI.showErrorDialog("Unsubscribe Failed", `An error occurred during client unsubscribe: ${error.message}`); this.updateNotificationButtonState(); }
    },

    ensureSubscription: async function () {
        console.log("Ensuring subscription status...");
        if (!AppState.swRegistration || !('Notification' in window) || Notification.permission !== 'granted') {
            console.log("Cannot ensure subscription: SW not ready, Notifications not supported, or permission not granted.");
            AppState.currentPushSubscription = null; this.updateNotificationButtonState(); return;
        }
        try {
            const subscription = await AppState.swRegistration.pushManager.getSubscription();
            AppState.currentPushSubscription = subscription;
            console.log(`EnsureSubscription: User ${subscription ? 'is' : 'is NOT'} subscribed.`);
        } catch (error) { console.error("Error checking subscription:", error); AppState.currentPushSubscription = null; }
        finally { this.updateNotificationButtonState(); }
    },

    handleTestNotification: function (notificationType = 'test') { // Accept type
        console.log(`Attempting to show ${notificationType} notification via SW...`);
        const sw = AppState.swRegistration;
        if (sw && 'showNotification' in sw) {
            // Use icons based on type passed from config/backend
            const iconUrl = window.AppConfig.TEST_NOTIFICATION_ICON_URL || '/static/icons/favicon.svg';
            const badgeUrl = window.AppConfig.TEST_NOTIFICATION_ICON_URL || '/static/icons/badge-icon.png'; // Same as icon for test

            const payload = {
                title: "Test Notification",
                body: "This is a test message from the app!",
                icon: iconUrl, // Use static path
                badge: badgeUrl, // Use static path
                tag: `${notificationType}-notification-` + Date.now(),
                data: { type: notificationType } // Pass type in data
            };
            sw.showNotification(payload.title, {
                body: payload.body,
                icon: payload.icon,
                badge: payload.badge,
                tag: payload.tag,
                data: payload.data
            })
                .then(() => { AppUI.showConfirmationDialog("Test Sent", "If notifications are enabled and allowed, you should see a test notification."); })
                .catch(err => { console.error("Error showing test notification:", err); AppUI.showErrorDialog("Test Failed", `Could not show notification: ${err.message}`); });
        } else { AppUI.showErrorDialog("Test Failed", "Service worker not ready or does not support showing notifications."); }
    }
};