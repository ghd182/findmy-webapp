// app/static/js/ui.js

window.AppUI = {
    // --- Dialog Management ---
    openDialog: function (dialogId) {
        console.log("[UI] Opening dialog:", dialogId);
        const overlay = document.getElementById(dialogId + '-overlay');
        const dialog = document.getElementById(dialogId);
        if (!overlay || !dialog) { console.error("[UI] Dialog or overlay not found:", dialogId); return; }

        if (dialogId === 'share-location-dialog') {
            const triggerButton = document.activeElement;
            const isMainShare = triggerButton && triggerButton.id === 'share-button';
            if (isMainShare) {
                console.log("[UI] Populating share dialog with current user location.");
                const address = document.getElementById('location-address-text')?.textContent || 'Address Unknown';
                const coords = document.getElementById('location-coordinates-text')?.textContent || 'Coordinates Unknown';
                const updated = document.getElementById('last-updated-text')?.textContent || 'Timestamp Unknown';
                const latMatch = coords.match(/^(-?\d+\.\d+)/); const lngMatch = coords.match(/(-?\d+\.\d+)(?!.*\d)/);
                const lat = latMatch ? latMatch[1] : null; const lng = lngMatch ? lngMatch[1] : null;
                let text = `My Location:\n${address}\n${coords}\n${updated}`;
                if (lat && lng) { text += `\nMap: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}\nGoogle Maps: https://www.google.com/maps?q=${lat},${lng}`; }
                const ta = document.getElementById('share-location-textarea'); const p = document.getElementById('share-location-dialog-content')?.querySelector('p');
                if (ta) ta.value = text; if (p) p.textContent = `Copy text to share current location:`;
            }
        }

        overlay.classList.add('show');
        overlay.scrollTop = 0;
        this._trapFocus(dialog);

        if (dialogId === 'add-place-dialog') AppMap.initPlacePickerDialogMap();
        if (dialogId === 'geofence-dialog') {
            const editId = document.getElementById('geofence-edit-id').value;
            if (editId) {
                const gf = AppState.globalGeofenceData.find(g => g.id === editId);
                if (gf) AppMap.initGeofenceDialogMap([gf.lat, gf.lng], 16, gf.radius);
                else console.error("[UI] Cannot init geofence dialog map: editing non-existent geofence");
            } else {
                const center = AppState.locationMarker ? AppState.locationMarker.getLatLng() : L.latLng(20, 0);
                const zoom = AppState.locationMarker ? 15 : 2;
                AppMap.initGeofenceDialogMap(center, zoom, 100);
            }
        }
        // Call setupDialogSearch AFTER potential map init
        if (dialogId === 'add-place-dialog' || dialogId === 'geofence-dialog') {
            setTimeout(() => this.setupDialogSearch(dialogId), 50);
        }
        if (dialogId === 'config-import-dialog') { this.resetImportDialog(); }
    },

    closeDialog: function (dialogId) {
        console.log("[UI] Closing dialog:", dialogId);
        const overlay = document.getElementById(dialogId + '-overlay');
        const dialog = document.getElementById(dialogId);
        if (!overlay || !dialog) return;
        overlay.classList.remove('show');
        this._releaseFocus(dialog);
        if (dialogId === 'add-place-dialog') AppMap.destroyPlacePickerDialogMap();
        if (dialogId === 'geofence-dialog') AppMap.destroyGeofenceDialogMap();
        if (dialogId === 'add-place-dialog' || dialogId === 'geofence-dialog') { this.cleanupDialogSearch(dialogId); this.hideSearchResults('place-picker-search-results'); this.hideSearchResults('geofence-picker-search-results'); }
        if (dialogId === 'config-import-dialog') { this.resetImportDialog(); }
    },

    closeDialog: function (dialogId) {
        console.log("[UI] Closing dialog:", dialogId);
        const overlay = document.getElementById(dialogId + '-overlay');
        const dialog = document.getElementById(dialogId);
        if (!overlay || !dialog) return;

        overlay.classList.remove('show');
        this._releaseFocus(dialog);

        // Handle specific dialog cleanups
        if (dialogId === 'add-place-dialog') AppMap.destroyPlacePickerDialogMap();
        if (dialogId === 'geofence-dialog') AppMap.destroyGeofenceDialogMap();
        // Clean up search listeners
        if (dialogId === 'add-place-dialog' || dialogId === 'geofence-dialog') {
            this.cleanupDialogSearch(dialogId);
            this.hideSearchResults('place-picker-search-results');
            this.hideSearchResults('geofence-picker-search-results');
        }
        // Clear temporary import data when closing the import dialog
        if (dialogId === 'config-import-dialog') {
            this.resetImportDialog(); // Reset UI and clear state
        }
    },

    // --- NEW: Function to show update prompt ---
    showUpdateAvailablePrompt: function (sourceWorker) {
        console.log("[UI] Showing update available prompt.");
        // Use your existing confirmation dialog or create a dedicated toast/banner
        this.showConfirmationDialog(
            "Update Available",
            "A new version of the app has been downloaded. Refresh to apply the update?",
            () => { // onConfirm (Refresh clicked)
                console.log("[UI] User confirmed update refresh.");
                // --- Tell the waiting SW to activate ---
                if (AppState.swRegistration && AppState.swRegistration.waiting) {
                    console.log("[UI] Sending SKIP_WAITING message to waiting SW...");
                    AppState.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    // The 'controllerchange' listener in app.js will handle the reload
                } else {
                    console.warn("[UI] No waiting SW found to send SKIP_WAITING message. Reloading directly (might be less smooth).");
                    window.location.reload(); // Fallback direct reload
                }
            },
            () => { // onCancel (optional)
                console.log("[UI] User declined immediate refresh.");
                // User can continue using the old version until next full page load/close+reopen
            }
        );
    },

    _trapFocus: function (dialogElement) {
        const focusableElementsString = 'button, [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusableElements = Array.from(dialogElement.querySelectorAll(focusableElementsString)).filter(el => el.offsetParent !== null);
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0]; const lastElement = focusableElements[focusableElements.length - 1];
        dialogElement._originalFocusedElement = document.activeElement; // Store previously focused element
        setTimeout(() => { try { firstElement.focus(); } catch (e) { } }, 100);
        const handleKeyDown = (event) => {
            if (event.key !== 'Tab') return;
            const currentlyFocusedIndex = focusableElements.indexOf(document.activeElement);
            if (event.shiftKey) {
                if (currentlyFocusedIndex === 0 || currentlyFocusedIndex === -1) { lastElement.focus(); event.preventDefault(); }
            } else {
                if (currentlyFocusedIndex === focusableElements.length - 1 || currentlyFocusedIndex === -1) { firstElement.focus(); event.preventDefault(); }
            }
        };
        dialogElement.addEventListener('keydown', handleKeyDown);
        dialogElement._focusTrapHandler = handleKeyDown;
    },

    _releaseFocus: function (dialogElement) {
        if (dialogElement._focusTrapHandler) { dialogElement.removeEventListener('keydown', dialogElement._focusTrapHandler); delete dialogElement._focusTrapHandler; }
        if (dialogElement._originalFocusedElement && typeof dialogElement._originalFocusedElement.focus === 'function') {
            try { dialogElement._originalFocusedElement.focus(); } catch (e) { }
        }
        delete dialogElement._originalFocusedElement;
    },

    showErrorDialog: function (title, message) {
        document.getElementById('error-dialog-title').textContent = title;
        document.getElementById('error-dialog-content').innerHTML = message; // Use innerHTML to render breaks
        this.openDialog('error-dialog');
    },

    showConfirmationDialog: function (title, message, onConfirm = null, onCancel = null) {
        document.getElementById('confirmation-dialog-title').textContent = title;
        document.getElementById('confirmation-dialog-content').innerHTML = message; // Use innerHTML
        const actions = document.getElementById('confirmation-dialog-actions');
        actions.innerHTML = ''; // Clear previous buttons

        if (onConfirm && typeof onConfirm === 'function') {
            // Confirmation mode
            const cancelButton = document.createElement('button'); cancelButton.className = 'text-button'; cancelButton.textContent = 'Cancel';
            cancelButton.onclick = () => {
                if (onCancel && typeof onCancel === 'function') onCancel();
                this.closeDialog('confirmation-dialog');
            };

            const confirmButton = document.createElement('button'); confirmButton.className = 'button'; confirmButton.textContent = 'Confirm';
            confirmButton.onclick = () => {
                onConfirm();
                this.closeDialog('confirmation-dialog');
            };
            actions.appendChild(cancelButton);
            actions.appendChild(confirmButton);
        } else {
            // Simple OK mode
            const okButton = document.createElement('button'); okButton.className = 'button'; okButton.textContent = 'OK';
            okButton.onclick = () => this.closeDialog('confirmation-dialog');
            actions.appendChild(okButton);
        }
        this.openDialog('confirmation-dialog');
    },


    confirmRemoveItem: function (itemType, identifier, name, callback) {
        document.getElementById('remove-confirmation-dialog-title').textContent = `Remove ${itemType}?`;
        document.getElementById('remove-confirmation-dialog-content').textContent = `Are you sure you want to remove "${name}"? This cannot be undone.`;
        const confirmButton = document.getElementById('remove-confirm-button');
        const newConfirmButton = confirmButton.cloneNode(true); // Clone to remove old listeners
        newConfirmButton.onclick = () => { callback(identifier); this.closeDialog('remove-confirmation-dialog'); };
        confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
        this.openDialog('remove-confirmation-dialog');
    },

    openDeviceMenu: function (deviceIndex, anchorElement) {
        const device = AppState.getCurrentDeviceData()[deviceIndex]; if (!device) return;
        const displayInfo = AppState.getDeviceDisplayInfo(device.id); const menuItems = [];
        const latestLocationAvailable = displayInfo.lat != null && displayInfo.lng != null;

        if (latestLocationAvailable) { menuItems.push({ label: "View on Map", icon: "map", action: () => AppMap.viewDeviceOnMap(device.id) }); }
        else { menuItems.push({ label: "View on Map", icon: "map", action: () => { }, disabled: true }); }

        menuItems.push({ label: "Share Device", icon: "share", action: () => this.openShareDeviceDialog(device.id, displayInfo.name) });
        menuItems.push({ label: "Edit Display", icon: "edit", action: () => this.openEditDeviceDialog(device.id) });
        menuItems.push({ label: "Manage Geofences", icon: "location_searching", action: () => this.navigateToGeofenceDeviceCard(device.id) });

        // --- START: Ensure Test Buttons are Present ---
        menuItems.push({ type: 'divider' }); // Optional divider before tests
        menuItems.push({ label: "Test Geofence Entry", icon: "notifications_active", action: () => this.triggerTestNotification(device.id, 'geofence_entry') });
        menuItems.push({ label: "Test Geofence Exit", icon: "notifications", action: () => this.triggerTestNotification(device.id, 'geofence_exit') });
        menuItems.push({ label: "Test Low Battery", icon: "battery_alert", action: () => this.triggerTestNotification(device.id, 'battery_low') });
        // --- END: Ensure Test Buttons are Present ---

        menuItems.push({ type: 'divider' }); // Optional divider before remove
        menuItems.push({
            label: "Remove Device",
            icon: "delete_outline",
            action: () => this.confirmRemoveItem('device', device.id, displayInfo.name, AppActions.handleRemoveDevice),
            isDestructive: true
        });

        const dialogContent = document.getElementById('device-menu-dialog-content'); dialogContent.innerHTML = '';
        document.getElementById('device-menu-dialog-title').textContent = displayInfo.name || "Device Options";
        menuItems.forEach(item => {
            if (item.type === 'divider') {
                const divider = document.createElement('hr');
                divider.style.margin = '8px 0';
                divider.style.borderColor = 'var(--m3-sys-color-outline-variant)';
                dialogContent.appendChild(divider);
                return;
            }
            const menuItem = document.createElement('div'); menuItem.classList.add('drawer-item'); menuItem.setAttribute('tabindex', item.disabled ? '-1' : '0'); menuItem.setAttribute('role', 'menuitem');
            if (item.disabled) { menuItem.style.opacity = '0.5'; menuItem.style.cursor = 'not-allowed'; }
            if (item.isDestructive) { menuItem.style.color = 'var(--m3-sys-color-error)'; }

            menuItem.innerHTML = `${item.icon ? `<span class="material-icons drawer-item-icon" ${item.isDestructive ? 'style="color: inherit;"' : ''}>${item.icon}</span>` : ''}<span class="drawer-item-text">${item.label} ${item.disabled ? '(N/A)' : ''}</span>`;

            if (!item.disabled) { const actionHandler = () => { item.action(); this.closeDialog('device-menu-dialog'); }; menuItem.onclick = actionHandler; menuItem.onkeypress = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actionHandler(); } }; }
            dialogContent.appendChild(menuItem);
        });
        this.openDialog('device-menu-dialog');
    },




    // --- START: New Share Dialog Functions ---
    openShareDeviceDialog: function (deviceId, deviceName) {
        document.getElementById('share-device-id').value = deviceId;
        document.getElementById('share-device-dialog-title').textContent = `Share "${deviceName}"`;
        document.getElementById('share-duration-select').value = '24h'; // Default duration
        document.getElementById('share-note-input').value = ''; // Clear note
        document.getElementById('share-create-error').style.display = 'none';
        document.getElementById('share-create-error').textContent = '';

        // Clear previous listener and add new one
        const createButton = document.getElementById('create-share-link-button');
        const newCreateButton = createButton.cloneNode(true); // Clone to remove old listeners
        newCreateButton.onclick = () => this.handleShareDeviceSubmit(); // Attach new listener
        createButton.parentNode.replaceChild(newCreateButton, createButton);

        this.openDialog('share-device-dialog');
    },

    handleShareDeviceSubmit: async function () {
        const deviceId = document.getElementById('share-device-id').value;
        const duration = document.getElementById('share-duration-select').value;
        const note = document.getElementById('share-note-input').value;
        const errorElement = document.getElementById('share-create-error');
        const createButton = document.getElementById('create-share-link-button');

        if (!deviceId || !duration) {
            errorElement.textContent = "Missing device ID or duration.";
            errorElement.style.display = 'block';
            return;
        }

        errorElement.style.display = 'none';
        createButton.disabled = true;
        createButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Creating...`;

        try {
            const shareResult = await AppApi.createDeviceShare(deviceId, duration, note);
            console.log("Share created:", shareResult);

            this.closeDialog('share-device-dialog');

            // Populate and open the link dialog
            document.getElementById('share-link-textarea').value = shareResult.share_url || 'Error: URL not returned';
            const expiryInfo = document.getElementById('share-link-expiry-info');
            if (shareResult.expires_at) {
                try {
                    const expiryDate = new Date(shareResult.expires_at);
                    expiryInfo.textContent = `Link expires: ${AppUtils.formatTimeRelative(expiryDate)} (${AppUtils.formatTime(expiryDate)})`;
                } catch (e) {
                    expiryInfo.textContent = `Link expires: ${shareResult.expires_at}`;
                }
            } else {
                expiryInfo.textContent = "Link does not expire automatically.";
            }
            // Setup copy button listener
            const copyButton = document.getElementById('copy-share-link-button');
            const newCopyButton = copyButton.cloneNode(true);
            newCopyButton.onclick = () => this.copyShareLink();
            copyButton.parentNode.replaceChild(newCopyButton, copyButton);

            this.openDialog('share-link-dialog');

            // Refresh lists in the background
            this.renderActiveSharesList(); // Update settings page list
            AppActions.refreshDevices(); // Update main device list for icon

        } catch (error) {
            console.error("Error creating share link:", error);
            errorElement.textContent = `Failed to create link: ${error.message}`;
            errorElement.style.display = 'block';
            this.showErrorDialog("Share Failed", `Could not create share link: ${error.message}`);
        } finally {
            createButton.disabled = false;
            createButton.innerHTML = 'Create Share Link';
        }
    },

    copyShareLink: async function () {
        const textarea = document.getElementById('share-link-textarea');
        const copyButton = document.getElementById('copy-share-link-button');
        if (!textarea || !copyButton) return;

        textarea.select();
        textarea.setSelectionRange(0, 99999); // For mobile

        const originalButtonHtml = copyButton.innerHTML;
        copyButton.innerHTML = 'Copying...';
        copyButton.disabled = true;

        try {
            await navigator.clipboard.writeText(textarea.value);
            copyButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">check</span> Copied!`;
            setTimeout(() => {
                copyButton.innerHTML = originalButtonHtml; // Reset after a delay
                copyButton.disabled = false;
            }, 1500);
        } catch (err) {
            console.error('Failed to copy share link: ', err);
            copyButton.innerHTML = 'Failed!';
            this.showErrorDialog("Copy Failed", "Could not copy link automatically. Please copy manually.");
            setTimeout(() => {
                copyButton.innerHTML = originalButtonHtml;
                copyButton.disabled = false;
            }, 2000);
        }
    },

    renderActiveSharesList: async function () {
        const listContainer = document.getElementById('devices-active-shares-list');
        const loadingIndicator = document.getElementById('devices-active-shares-loading');
        const noItemsMessage = document.getElementById('devices-no-active-shares-message');
        if (!listContainer || !loadingIndicator || !noItemsMessage) return;

        loadingIndicator.style.display = 'block'; listContainer.style.display = 'none'; noItemsMessage.style.display = 'none'; listContainer.innerHTML = '';

        try {
            const shares = await AppApi.fetchUserShares();
            AppState.setUserActiveShares(shares);

            // --- ADD SAFETY CHECK ---
            if (!Array.isArray(shares)) {
                console.error("Received non-array data for shares:", shares);
                throw new Error("Invalid data format received for shares.");
            }
            // --- ------------------ ---

            if (shares.length === 0) { noItemsMessage.style.display = 'block'; }
            else {
                listContainer.style.display = 'block';
                shares.forEach(share => { // Safe to call forEach 
                    const item = document.createElement('div');
                    item.className = 'settings-item share-item'; // Keep same classes for styling
                    item.dataset.shareId = share.share_id;
                    item.classList.toggle('share-inactive', !share.active);
                    item.classList.toggle('share-expired', !!share.is_expired);

                    const createdDate = share.created_at ? AppUtils.formatTimeRelative(new Date(share.created_at)) : 'Unknown';
                    let expiryText = share.active ? "Never" : "Inactive";
                    let expiryClass = share.active ? "" : "inactive";
                    if (share.expires_at) {
                        try { const expiryDate = new Date(share.expires_at.replace("Z", "+00:00")); const isExpired = expiryDate < new Date(); expiryText = `${isExpired ? 'Expired' : 'Expires'} ${AppUtils.formatTimeRelative(expiryDate)}`; if (isExpired) expiryClass = "expired"; else if (!share.active) expiryClass = "inactive"; } catch (e) { expiryText = "Invalid expiry"; expiryClass = "error"; }
                    } else if (!share.active) { expiryText = "Inactive"; expiryClass = "inactive"; }

                    const noteHtml = share.note ? `<div class="settings-item-description share-note">Note: ${AppUtils.escapeHtml(share.note)}</div>` : '';
                    const toggleButtonIcon = share.active ? 'pause_circle' : 'play_circle';
                    const toggleButtonTitle = share.active ? 'Suspend Share (Deactivate Link)' : 'Resume Share (Activate Link)';
                    const toggleButtonClass = share.active ? 'suspend-share-button' : 'resume-share-button';

                    const createdISO = share.created_at || '';
                    const createdDateStr = createdISO ? AppUtils.formatTimeRelative(new Date(createdISO)) : 'Unknown';


                    item.innerHTML = `
                    <span class="material-icons drawer-item-icon share-status-icon ${expiryClass}">${share.active ? (share.is_expired ? 'history_toggle_off' : 'share') : 'pause_circle'}</span>
                    <div class="settings-item-text">
                        <div class="settings-item-title">${AppUtils.escapeHtml(share.device_name || 'Unknown Device')}</div>
                        <div class="settings-item-description share-details">
                            Created: <span class="relative-time" data-timestamp="${createdISO}">${createdDateStr}</span> | <span class="share-expiry ${expiryClass}">${expiryText}</span>
                        </div>
                            <div class="settings-item-description share-link-display">
                                <a href="${share.share_url}" target="_blank" title="Open share link">${share.share_url.replace(/^https:\/\/|^http:\/\//, '')}</a>
                                <button class="text-button copy-share-button-list" title="Copy Link" data-url="${share.share_url}">
                                    <span class="material-icons" style="font-size: 16px;">content_copy</span>
                                </button>
                            </div>
                            ${noteHtml}
                    </div>
                    <div class="share-item-actions">
                            <button class="text-button toggle-share-button ${toggleButtonClass}" title="${toggleButtonTitle}" data-share-id="${share.share_id}" data-active="${share.active}">
                                <span class="material-icons" style="font-size: 22px;">${toggleButtonIcon}</span>
                            </button>
                            <button class="text-button edit-share-button" title="Edit Duration/Note" data-share-id="${share.share_id}">
                                <span class="material-icons" style="font-size: 20px;">edit_calendar</span>
                            </button>
                            <button class="text-button revoke-share-button" title="Delete Share Link Permanently" data-share-id="${share.share_id}" style="color: var(--m3-sys-color-error);">
                                <span class="material-icons" style="font-size: 20px;">delete_forever</span>
                            </button>
                    </div>
                `;
                    item.querySelector('.revoke-share-button').addEventListener('click', (e) => { e.stopPropagation(); this.handleDeleteShare(share.share_id, share.device_name); });
                    item.querySelector('.toggle-share-button').addEventListener('click', (e) => { e.stopPropagation(); this.handleToggleShareStatus(share.share_id, share.active); });
                    item.querySelector('.edit-share-button').addEventListener('click', (e) => { e.stopPropagation(); this.openEditShareDialog(share); });
                    item.querySelector('.copy-share-button-list').addEventListener('click', (e) => { e.stopPropagation(); this.copyTextToClipboard(share.share_url, e.currentTarget); });

                    listContainer.appendChild(item);
                });
            }
        } catch (error) {
            console.error("Error loading active shares:", error);
            noItemsMessage.textContent = `Error loading shares: ${error.message}`;
            noItemsMessage.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    },

    // Rename revoke handler to DELETE handler
    handleDeleteShare: function (shareId, deviceName) {
        this.showConfirmationDialog(
            "Delete Share Permanently?",
            `Are you sure you want to <strong>permanently delete</strong> the share link for "${AppUtils.escapeHtml(deviceName || 'this device')}"? This cannot be undone.`,
            async () => {
                console.log(`[UI] Deleting share ${shareId} permanently.`);
                try {
                    // This calls DELETE /api/shares/<share_id>
                    const result = await AppApi.revokeShare(shareId); // <<< KEEP THIS NAME, it maps to the DELETE route
                    this.showConfirmationDialog("Share Deleted", result.message || "Share link permanently deleted."); // Use result message
                    this.renderActiveSharesList(); // Refresh the list
                    AppActions.refreshDevices(); // Refresh device list status
                } catch (error) {
                    console.error("Error deleting share:", error);
                    this.showErrorDialog("Deletion Failed", `Could not delete share: ${error.message}`);
                }
            },
            null,
            true
        );
    },




    // --- START: New Share Management Handlers ---
    handleToggleShareStatus: async function (shareId, currentIsActive) {
        const newStatus = !currentIsActive;
        const action = newStatus ? "resume" : "suspend";
        console.log(`[UI] Toggling share ${shareId} status to ${newStatus}`);
        // Optionally show visual feedback on the button
        const button = document.querySelector(`.toggle-share-button[data-share-id="${shareId}"]`);
        if (button) button.disabled = true;

        try {
            await AppApi.toggleShareStatus(shareId, newStatus);
            // Refresh lists to reflect the change
            this.renderActiveSharesList();
            AppActions.refreshDevices(); // Refresh device list to update share icon
            this.showConfirmationDialog("Share Updated", `Share link has been ${action}d.`);
        } catch (error) {
            console.error(`Error ${action}ing share:`, error);
            this.showErrorDialog("Update Failed", `Could not ${action} share link: ${error.message}`);
            if (button) button.disabled = false; // Re-enable button on error
        }
    },

    // Helper to copy text - used by share link dialog and list item copy button
    copyTextToClipboard: async function (textToCopy, buttonElement = null) {
        if (!textToCopy) return;

        let originalButtonContent = null;
        if (buttonElement) {
            originalButtonContent = buttonElement.innerHTML;
            buttonElement.innerHTML = '<span class="material-icons" style="font-size: 16px;">pending</span>'; // Show pending/spinner
            buttonElement.disabled = true;
        }

        try {
            await navigator.clipboard.writeText(textToCopy);
            console.log('[UI] Text copied to clipboard:', textToCopy.substring(0, 50) + '...');
            if (buttonElement) {
                buttonElement.innerHTML = '<span class="material-icons" style="font-size: 16px; color: var(--m3-sys-color-primary);">check</span>'; // Show success
                setTimeout(() => {
                    if (originalButtonContent) buttonElement.innerHTML = originalButtonContent;
                    buttonElement.disabled = false;
                }, 1500);
            } else {
                // If no button, maybe show general confirmation
                this.showConfirmationDialog("Copied!", "Link copied to clipboard.");
            }
        } catch (err) {
            console.error('[UI] Failed to copy text: ', err);
            if (buttonElement) {
                buttonElement.innerHTML = '<span class="material-icons" style="font-size: 16px; color: var(--m3-sys-color-error);">close</span>'; // Show failure
                setTimeout(() => {
                    if (originalButtonContent) buttonElement.innerHTML = originalButtonContent;
                    buttonElement.disabled = false;
                }, 2000);
            }
            this.showErrorDialog("Copy Failed", "Could not copy text automatically. Please copy manually.");
        }
    },


    _approximateDurationStringFromExpiry: function (expiresAtISO) {
        if (!expiresAtISO) return "indefinite";
        try {
            const expiryDate = new Date(expiresAtISO.replace("Z", "+00:00"));
            const now = new Date();
            if (expiryDate < now) return "expired"; // Indicate if already expired

            const diffHours = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60);

            if (diffHours < 1.5) return "1h";
            if (diffHours < 7) return "6h";
            if (diffHours < 25) return "24h";
            if (diffHours < (8 * 24)) return "7d";
            if (diffHours < (31 * 24)) return "30d";
            return "indefinite"; // If very far in future, treat as indefinite for dropdown
        } catch {
            return "24h"; // Default fallback
        }
    },


    openEditShareDialog: function (share) {
        // --- Updated with Null Checks ---
        if (!share) return;
        const shareIdInput = document.getElementById('edit-share-id');
        const deviceNameEl = document.getElementById('edit-share-device-name');
        const expiryEl = document.getElementById('edit-share-current-expiry');
        const durationSelect = document.getElementById('edit-share-duration-select');
        const noteInput = document.getElementById('edit-share-note-input');
        const errorEl = document.getElementById('edit-share-error');
        const saveButton = document.getElementById('save-share-edit-button');
        if (!shareIdInput || !deviceNameEl || !expiryEl || !durationSelect || !noteInput || !errorEl || !saveButton) { console.error("[UI Error] Elements missing in edit-share-dialog."); this.showErrorDialog("UI Error", "Could not load dialog elements."); return; }

        shareIdInput.value = share.share_id;
        deviceNameEl.textContent = share.device_name || 'this device';
        if (share.expires_at) { try { expiryEl.textContent = AppUtils.formatTime(new Date(share.expires_at.replace("Z", "+00:00"))); } catch { expiryEl.textContent = "Invalid Date"; } }
        else { expiryEl.textContent = "Never"; }
        const approxDuration = this._approximateDurationStringFromExpiry(share.expires_at);
        durationSelect.value = approxDuration;
        noteInput.value = share.note || '';
        errorEl.style.display = 'none';
        const newSaveButton = saveButton.cloneNode(true);
        newSaveButton.onclick = () => this.handleEditShareSubmit();
        saveButton.parentNode.replaceChild(newSaveButton, saveButton);
        this.openDialog('edit-share-dialog');
        // --- End Updated with Null Checks ---
    },

    handleEditShareSubmit: async function () {
        const shareId = document.getElementById('edit-share-id').value;
        const duration = document.getElementById('edit-share-duration-select').value;
        const note = document.getElementById('edit-share-note-input').value;
        const errorElement = document.getElementById('edit-share-error');
        const saveButton = document.getElementById('save-share-edit-button');

        if (!shareId || !duration) { errorElement.textContent = "Missing share ID or duration."; errorElement.style.display = 'block'; return; }

        errorElement.style.display = 'none';
        saveButton.disabled = true;
        saveButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Saving...`;

        try {
            await AppApi.updateShareDuration(shareId, duration, note);
            this.closeDialog('edit-share-dialog');
            this.showConfirmationDialog("Share Updated", "Share duration and note have been updated.");
            this.renderActiveSharesList(); // Refresh list
        } catch (error) {
            console.error("Error updating share:", error);
            errorElement.textContent = `Failed to update share: ${error.message}`;
            errorElement.style.display = 'block';
            this.showErrorDialog("Update Failed", `Could not update share: ${error.message}`);
        } finally {
            saveButton.disabled = false;
            saveButton.innerHTML = 'Save Changes';
        }
    },










    // --- END: New Share Dialog Functions ---




    // --- NEW: Trigger Test Notification ---
    triggerTestNotification: async function (deviceId, type) {
        console.log(`[UI] Triggering test notification for ${deviceId}, type: ${type}`);
        try {
            this.showConfirmationDialog("Sending...", `Sending test '${type}' notification...`, null, null);
            const result = await AppApi.testDeviceNotification(deviceId, type);
            this.closeDialog('confirmation-dialog'); // Close sending dialog
            this.showConfirmationDialog("Test Sent", result.message || "Test notification sent.");
        } catch (error) {
            console.error("Failed to send test notification:", error);
            this.closeDialog('confirmation-dialog'); // Close sending dialog
            this.showErrorDialog("Test Failed", `Could not send test notification: ${error.message}`);
        }
    },

    // --- NEW: Notification History Rendering ---
    renderNotificationHistory: async function () {
        const listContainer = document.getElementById('notifications-history-list');
        const loadingIndicator = document.getElementById('notifications-history-loading');
        const noItemsMessage = document.getElementById('no-notifications-history-message');
        const markAllReadButton = document.getElementById('mark-all-read-button');
        const clearAllButton = document.getElementById('clear-all-history-button');

        if (!listContainer || !loadingIndicator || !noItemsMessage || !markAllReadButton || !clearAllButton) {
            console.error("Notification history UI elements missing."); return;
        }
        loadingIndicator.style.display = 'block'; listContainer.style.display = 'none'; noItemsMessage.style.display = 'none'; listContainer.innerHTML = '';
        markAllReadButton.onclick = null; clearAllButton.onclick = null;

        try {
            const history = await AppApi.fetchNotificationHistory();
            // --- ADD SAFETY CHECK ---
            if (!Array.isArray(history)) {
                console.error("Received non-array data for notification history:", history);
                throw new Error("Invalid data format received for history.");
            }
            // --- ------------------ ---
            if (history.length === 0) {
                noItemsMessage.style.display = 'block'; markAllReadButton.disabled = true; clearAllButton.disabled = true;
            } else {
                listContainer.style.display = 'block'; let hasUnread = false;
                history.forEach(item => {
                    const itemElement = document.createElement('div');
                    itemElement.classList.add('notification-item'); itemElement.dataset.id = item.id; itemElement.dataset.type = item.data?.type || 'unknown';
                    if (!item.is_read) { itemElement.classList.add('unread'); hasUnread = true; }

                    let icon = 'notifications';
                    switch (item.data?.type) {
                        case 'geofence': icon = 'location_searching'; break;
                        case 'battery': icon = 'battery_alert'; break;
                        case 'welcome': icon = 'celebration'; break;
                        case 'test': icon = 'science'; break;
                    }

                    // --- Use formatted timestamp for display ---
                    const timestampISO = item.timestamp || '';
                    // Use the pre-formatted timestamp from the backend if available, otherwise format locally
                    const displayTimestamp = item.timestamp_formatted || (timestampISO ? AppUtils.formatTime(new Date(timestampISO)) : 'Unknown time');
                    // --- ----------------------------------- ---

                    itemElement.innerHTML = `
                        <div class="notification-icon">
                            <span class="material-icons">${icon}</span>
                        </div>
                        <div class="notification-content">
                            <div class="notification-title">${item.title || 'Notification'}</div>
                            <div class="notification-body">${item.body || '(No body)'}</div>
                            <div class="notification-timestamp" data-timestamp="${timestampISO}">${displayTimestamp}</div>
                        </div>
                        <div class="notification-actions">
                            <button class="mark-read-unread-button" title="${item.is_read ? 'Mark as Unread' : 'Mark as Read'}" data-id="${item.id}" data-current-status="${item.is_read}">
                                <span class="material-icons">${item.is_read ? 'mark_chat_unread' : 'mark_chat_read'}</span>
                            </button>
                            <button class="delete-notification-button" title="Delete Notification" data-id="${item.id}">
                                <span class="material-icons">delete_outline</span>
                            </button>
                        </div>
                    `;
                    itemElement.querySelector('.mark-read-unread-button').addEventListener('click', (e) => { e.stopPropagation(); this.handleMarkNotificationReadUnread(item.id, !item.is_read); });
                    itemElement.querySelector('.delete-notification-button').addEventListener('click', (e) => { e.stopPropagation(); this.handleDeleteNotification(item.id, item.title); });
                    listContainer.appendChild(itemElement);
                });
                markAllReadButton.disabled = !hasUnread; clearAllButton.disabled = false;
                markAllReadButton.onclick = () => this.handleMarkAllRead();
                clearAllButton.onclick = () => this.handleClearAllHistory();
            }
        } catch (error) {
            console.error("Error loading notification history:", error); noItemsMessage.textContent = `Error loading history: ${error.message}`; noItemsMessage.style.display = 'block';
            markAllReadButton.disabled = true; clearAllButton.disabled = true;
        } finally {
            loadingIndicator.style.display = 'none';
        }
    },

    handleMarkNotificationReadUnread: async function (notificationId, markAsRead) {
        console.log(`[UI] Marking notification ${notificationId} as ${markAsRead ? 'read' : 'unread'}`);
        const itemElement = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
        const button = itemElement?.querySelector('.mark-read-unread-button');
        if (button) button.disabled = true; // Disable button during API call

        try {
            if (markAsRead) {
                await AppApi.markNotificationRead(notificationId);
            } else {
                await AppApi.markNotificationUnread(notificationId);
            }
            // Visually update the item without full refresh
            if (itemElement) {
                itemElement.classList.toggle('unread', !markAsRead);
                const iconEl = button.querySelector('.material-icons');
                const titleEl = itemElement.querySelector('.notification-title');
                if (iconEl) iconEl.textContent = markAsRead ? 'mark_chat_unread' : 'mark_chat_read';
                if (button) button.title = markAsRead ? 'Mark as Unread' : 'Mark as Read';
                if (button) button.dataset.currentStatus = markAsRead;
                if (titleEl) titleEl.style.fontWeight = markAsRead ? 'normal' : 'var(--title-medium-weight)';
            }
            // Check if Mark All Read button needs updating
            const hasAnyUnread = document.querySelector('#notifications-history-list .notification-item.unread');
            const markAllBtn = document.getElementById('mark-all-read-button');
            if (markAllBtn) markAllBtn.disabled = !hasAnyUnread;

        } catch (error) {
            console.error("Error updating notification read status:", error);
            this.showErrorDialog("Update Failed", `Could not update notification status: ${error.message}`);
        } finally {
            if (button) button.disabled = false;
        }
    },

    handleDeleteNotification: function (notificationId, title) {
        this.showConfirmationDialog(
            "Delete Notification?",
            `Are you sure you want to delete the notification "${title || notificationId}"?`,
            async () => {
                console.log(`[UI] Deleting notification ${notificationId}`);
                try {
                    await AppApi.deleteNotification(notificationId);
                    const itemElement = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
                    if (itemElement) {
                        itemElement.style.transition = 'opacity 0.3s ease-out, height 0.3s ease-out';
                        itemElement.style.opacity = '0';
                        itemElement.style.height = '0';
                        itemElement.style.padding = '0';
                        itemElement.style.margin = '0';
                        setTimeout(() => {
                            itemElement.remove();
                            // Check if list is now empty
                            const listContainer = document.getElementById('notifications-history-list');
                            const noItemsMessage = document.getElementById('no-notifications-history-message');
                            if (listContainer && noItemsMessage && listContainer.children.length === 0) {
                                noItemsMessage.style.display = 'block';
                                listContainer.style.display = 'none';
                                document.getElementById('clear-all-history-button').disabled = true;
                                document.getElementById('mark-all-read-button').disabled = true;
                            }
                        }, 300);
                    }
                } catch (error) {
                    console.error("Error deleting notification:", error);
                    this.showErrorDialog("Delete Failed", `Could not delete notification: ${error.message}`);
                }
            }
        );
    },

    handleMarkAllRead: async function () {
        console.log("[UI] Marking all notifications as read...");
        const unreadItems = document.querySelectorAll('#notifications-history-list .notification-item.unread');
        if (unreadItems.length === 0) return;

        const markAllBtn = document.getElementById('mark-all-read-button');
        markAllBtn.disabled = true;

        let success = true;
        // Mark all visually first for responsiveness
        unreadItems.forEach(itemElement => {
            itemElement.classList.remove('unread');
            const button = itemElement.querySelector('.mark-read-unread-button');
            const iconEl = button?.querySelector('.material-icons');
            const titleEl = itemElement.querySelector('.notification-title');
            if (iconEl) iconEl.textContent = 'mark_chat_unread';
            if (button) button.title = 'Mark as Unread';
            if (button) button.dataset.currentStatus = 'true';
            if (titleEl) titleEl.style.fontWeight = 'normal';
        });

        // Then send API requests (can be done concurrently)
        const promises = Array.from(unreadItems).map(item => AppApi.markNotificationRead(item.dataset.id));

        try {
            await Promise.all(promises);
            console.log("[UI] Mark all read API calls completed.");
        } catch (error) {
            console.error("Error marking all notifications read:", error);
            this.showErrorDialog("Update Failed", `Could not mark all notifications read: ${error.message}`);
            success = false;
            // Re-render might be needed here to correct visual state on error
            this.renderNotificationHistory();
        } finally {
            if (success) markAllBtn.disabled = true; // Should be no unread left
            else markAllBtn.disabled = false; // Re-enable if errors occurred
        }
    },

    handleClearAllHistory: function () {
        this.showConfirmationDialog(
            "Clear All History?",
            "Are you sure you want to delete ALL notification history? This cannot be undone.",
            async () => {
                console.log("[UI] Clearing all notification history...");
                try {
                    await AppApi.deleteAllNotifications();
                    this.renderNotificationHistory(); // Re-render the empty list
                    this.showConfirmationDialog("History Cleared", "Notification history has been deleted.");
                } catch (error) {
                    console.error("Error clearing notification history:", error);
                    this.showErrorDialog("Clear Failed", `Could not clear history: ${error.message}`);
                }
            }
        );
    },

    openPlaceMenu: function (placeIndex, anchorElement) {
        const place = AppState.savedPlaces[placeIndex]; if (!place) return; const menuItems = [];
        if (place.lat && place.lng) { menuItems.push({ label: "View on Map", icon: "map", action: () => AppMap.viewPlaceOnMap(placeIndex) }); }
        menuItems.push({ label: "Share", icon: "share", action: () => this.sharePlace(placeIndex) });
        menuItems.push({ label: "Remove", icon: "delete_outline", action: () => this.confirmRemoveItem('place', placeIndex, place.name, this.removePlace.bind(this)) });
        const dialogContent = document.getElementById('device-menu-dialog-content'); dialogContent.innerHTML = '';
        document.getElementById('device-menu-dialog-title').textContent = place.name || "Place Options";
        menuItems.forEach(item => {
            const menuItem = document.createElement('div'); menuItem.classList.add('drawer-item'); menuItem.setAttribute('tabindex', '0'); menuItem.setAttribute('role', 'menuitem');
            menuItem.innerHTML = `${item.icon ? `<span class="material-icons drawer-item-icon">${item.icon}</span>` : ''}<span class="drawer-item-text">${item.label}</span>`;
            const actionHandler = () => { item.action(); this.closeDialog('device-menu-dialog'); }; menuItem.onclick = actionHandler; menuItem.onkeypress = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actionHandler(); } };
            dialogContent.appendChild(menuItem);
        });
        this.openDialog('device-menu-dialog');
    },

    openMoreMenu: function () {
        const menu = document.getElementById('more-menu-dialog');
        const overlay = document.getElementById('more-menu-dialog-overlay');
        const button = document.getElementById('more-button');
        if (!menu || !overlay || !button) {
            console.error("[UI Error] More menu elements not found.");
            return;
        }

        const rect = button.getBoundingClientRect();
        const items = [
            // { label: "Refresh Devices", icon: "refresh", action: () => { AppActions.refreshDevices(true); } }, // Manual refresh optional here
            // { type: 'divider' }, 
            { label: "Add Saved Place", icon: "add_location", action: this.openAddPlaceDialog.bind(this) },
            { label: "Import/Export", icon: "import_export", action: () => this.changePage('settings', 'settings-import-export') },
            { label: "Update Positions", icon: "refresh", action: () => /* i need to trigger the fetch new positions button AppActions.fetchNewPositions() or something similar */ AppActions.refreshDevices(true) },
            { label: "Settings", icon: "settings", action: () => this.changePage('settings') },
            { label: "Help & Feedback", icon: "help_outline", action: () => this.openDialog('help-dialog') },
            { type: 'divider' },
            { label: "Logout", icon: "logout", action: () => { window.location.href = '/logout'; } }
        ];

        const content = menu.querySelector('.dialog-content');
        if (!content) { console.error("[UI Error] Dialog content area not found in more-menu-dialog"); return; }
        content.innerHTML = ''; // Clear previous items

        items.forEach(item => {
            // (Keep the item creation logic exactly as before)
            if (item.type === 'divider') {
                const divider = document.createElement('hr');
                divider.style.margin = '8px 0';
                divider.style.borderColor = 'var(--m3-sys-color-outline-variant)';
                content.appendChild(divider);
                return;
            }
            const menuItem = document.createElement('div');
            menuItem.classList.add('drawer-item'); // Re-use drawer item styling
            menuItem.setAttribute('tabindex', '0');
            menuItem.setAttribute('role', 'menuitem');
            menuItem.innerHTML = `
                <span class="material-icons drawer-item-icon">${item.icon}</span>
                <span class="drawer-item-text">${item.label}</span>
            `;
            menuItem.onclick = () => { item.action(); this.closeMoreMenu(); };
            menuItem.onkeypress = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    item.action();
                    this.closeMoreMenu();
                }
            };
            content.appendChild(menuItem);
        });

        // Position the menu
        // menu.style.top = `${rect.bottom + 8}px`;
        // menu.style.right = `${window.innerWidth - rect.right}px`;
        // menu.style.left = 'auto';

        // Show both overlay AND menu
        overlay.classList.add('show');
        menu.classList.add('show'); // <<< ADD THIS LINE

        this._trapFocus(menu);
        console.log("More menu opened, overlay and menu should be visible.");
    },

    closeMoreMenu: function () {
        const overlay = document.getElementById('more-menu-dialog-overlay');
        const menu = document.getElementById('more-menu-dialog');
        if (overlay) overlay.classList.remove('show');
        if (menu) menu.classList.remove('show'); // <<< ADD THIS LINE
        if (menu) this._releaseFocus(menu);
        console.log("More menu closed, overlay and menu should be hidden.");
    },

    // --- Drawer ---
    openDrawer: function () {
        const drawer = document.getElementById('drawer');
        const overlay = document.getElementById('drawer-overlay');
        if (drawer) drawer.classList.add('open');
        if (overlay) overlay.classList.add('show');
        if (drawer) this._trapFocus(drawer);
    },
    closeDrawer: function () {
        const drawer = document.getElementById('drawer');
        const overlay = document.getElementById('drawer-overlay');
        if (drawer) drawer.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        if (drawer) this._releaseFocus(drawer);
        document.getElementById('menu-button')?.focus();
    },

    // --- Page Navigation ---
    changePage: function (pageId, sectionId = null) {
        console.log(`[UI Debug] changePage called with pageId: "${pageId}" (type: ${typeof pageId})`);
        const mainContent = document.getElementById('main-content');
        const pages = ['index', 'shared', 'places', 'history', 'geofences', 'settings', 'notifications-history', 'scanner']; // <-- ADD 'scanner'

        // --- Stop Scanner if navigating away ---
        if (AppState.lastActivePageId === 'scanner' && pageId !== 'scanner' && window.Scanner) {
            Scanner.stopScan("Navigated away from Scanner tab.");
        }
        // --- --------------------------------- ---

        if (pages.includes(pageId)) {
            AppState.saveLastActivePageId(pageId);
        } else {
            console.warn(`[UI] Attempted to navigate to invalid page ID: ${pageId}. Not saving state. Defaulting to index.`);
            pageId = 'index';
        }

        pages.forEach(id => { const pageElement = document.getElementById(id + '-page'); if (pageElement) pageElement.style.display = 'none'; });
        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.remove('active');
            if (l.getAttribute('data-page') === pageId) {
                l.classList.add('active');
            }
        });

        const targetPage = document.getElementById(pageId + '-page');
        if (targetPage) {
            targetPage.style.display = 'block';
            if (mainContent) { mainContent.scrollTop = 0; }
            else { console.warn("main-content element not found for scrolling."); }

            // Handle page-specific actions
            if (pageId === 'index') {
                if (AppState.getMap() && AppState.mapReady) { AppMap.invalidateMapSize(); AppMap.updateMapView(); }
                else if (!AppState.getMap()) { AppMap.initMap(); }
            }
            else if (pageId === 'shared') { this.renderDevicesList(AppState.getCurrentDeviceData()); AppActions.refreshDevices(); this.renderActiveSharesList(); } // Also render shares here now
            // else if (pageId === 'places') { this.renderSavedPlacesList(); }
            // else if (pageId === 'history') { this.renderLocationHistory(); }
            else if (pageId === 'settings') { this.setupSettingsPage(); this.renderActiveSharesList(); if (sectionId) { setTimeout(() => this.scrollToSection(sectionId), 100); } } // Call renderActiveSharesList here
            else if (pageId === 'geofences') { this.renderGlobalGeofences(); this.renderDeviceGeofenceLinks(); AppActions.refreshGeofencesAndDevices(); }
            else if (pageId === 'notifications-history') { this.renderNotificationHistory(); }
            // --- ADD Scanner Init ---
            else if (pageId === 'scanner') {
                if (window.Scanner) Scanner.initScannerPage();
                else console.error("Scanner object not found when changing to scanner page.");
            }
            // --- END Scanner Init ---
            // Removed places/history specific logic as they are gone from nav
        } else {
            console.error("[UI] Target page not found:", pageId + '-page');
            this.changePage('index');
        }

        // FAB visibility (keep hidden as places page is gone)
        const fab = document.getElementById('add-place-button');
        if (fab) fab.style.display = 'none';
    },

    // --- NEW Helper for Initial Navigation ---
    navigateToInitialPage: function () {
        const lastPageId = AppState.getLastActivePageId();
        console.log(`[UI Debug] navigateToInitialPage: Read lastPageId = "${lastPageId}" (type: ${typeof lastPageId})`);

        const validPages = ['index', 'shared', 'places', 'history', 'geofences', 'settings', 'notifications-history'];
        const isValid = lastPageId && typeof lastPageId === 'string' && validPages.includes(lastPageId);
        console.log(`[UI Debug] navigateToInitialPage: Is lastPageId valid? ${isValid}`);

        const initialPage = isValid ? lastPageId : 'index';
        // --- CORRECTED LOG ---
        console.log(`[UI] Navigating to initial page: ${initialPage} (From stored: "${lastPageId}")`);
        // --- --------------- ---

        this.changePage(initialPage);
    },


    updateRelativeTimes: function () {
        const timeElements = document.querySelectorAll('.relative-time[data-timestamp]');
        if (!timeElements || timeElements.length === 0) return;

        // console.log(`[UI] Updating ${timeElements.length} relative time elements.`); // Can be noisy

        timeElements.forEach(el => {
            const timestampISO = el.dataset.timestamp;
            if (!timestampISO) {
                // Maybe set to 'Never' or 'Unknown' if timestamp is missing/invalid initially
                if (el.textContent !== 'Never') el.textContent = 'Never';
                return;
            }

            try {
                const date = new Date(timestampISO);
                if (!isNaN(date)) {
                    const relativeStr = AppUtils.formatTimeRelative(date);
                    if (el.textContent !== relativeStr) {
                        el.textContent = relativeStr;
                    }
                } else {
                    if (el.textContent !== 'Invalid Time') el.textContent = 'Invalid Time';
                }
            } catch (e) {
                console.warn("Error parsing timestamp for relative update:", timestampISO, e);
                if (el.textContent !== 'Error') el.textContent = 'Error';
            }
        });
    },





    scrollToSection: function (sectionId) {
        const sectionElement = document.getElementById(sectionId);
        if (sectionElement) {
            console.log(`[UI] Scrolling to section: #${sectionId}`);
            sectionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            sectionElement.style.outline = '2px solid var(--primary-color)';
            setTimeout(() => { sectionElement.style.outline = 'none'; }, 2500);
        } else { console.warn(`[UI] Section element not found: #${sectionId}`); }
    },

    navigateToGeofenceDeviceCard: function (deviceId) {
        this.changePage('geofences');
        setTimeout(() => {
            const card = document.getElementById(`device-link-card-${deviceId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.outline = '2px solid var(--primary-color)';
                setTimeout(() => { card.style.outline = 'none'; }, 2000);
            } else { console.warn(`[UI] Device card device-link-card-${deviceId} not found after page change.`); }
        }, 300);
    },

    // --- List Rendering ---
    renderDevicesList: function (devices) {
        const listElement = document.getElementById('shared-devices-list');
        const loadingIndicator = document.getElementById('devices-loading-indicator');
        const noDevicesMessage = document.getElementById('no-devices-message');
        const errorMessageElement = document.getElementById('devices-error-message');
        if (!listElement || !loadingIndicator || !noDevicesMessage || !errorMessageElement) return;

        loadingIndicator.style.display = 'none'; errorMessageElement.style.display = 'none'; listElement.innerHTML = '';
        if (!devices || devices.length === 0) { noDevicesMessage.innerHTML = `...`; noDevicesMessage.style.display = 'block'; listElement.style.display = 'none'; return; }
        noDevicesMessage.style.display = 'none'; listElement.style.display = 'block';


        devices.forEach((device, index) => {
            const displayInfo = AppState.getDeviceDisplayInfo(device.id);
            const deviceElement = document.createElement('div');
            deviceElement.classList.add('shared-device'); deviceElement.setAttribute('tabindex', '0'); deviceElement.setAttribute('role', 'button');
            const locationStatusText = (displayInfo.lat != null && displayInfo.lng != null) ? displayInfo.status : "Location Unknown"; deviceElement.setAttribute('aria-label', `Device: ${displayInfo.name}, Status: ${locationStatusText}`); deviceElement.dataset.deviceId = device.id;

            let batteryIcon = 'battery_unknown';
            let batteryClass = ''; // For error styling
            let batteryTooltip = '';
            if (displayInfo.batteryLevel != null) {
                const level = displayInfo.batteryLevel;
                batteryTooltip = `${level.toFixed(0)}%`;
                // Use Material Symbols names
                if (level > 95) batteryIcon = 'battery_full';
                else if (level > 80) batteryIcon = 'battery_6_bar';
                else if (level > 60) batteryIcon = 'battery_5_bar';
                else if (level > 40) batteryIcon = 'battery_4_bar';
                else if (level > 25) batteryIcon = 'battery_3_bar';
                // Use LOW_BATTERY_THRESHOLD from AppConfig
                else if (level >= AppConfig.LOW_BATTERY_THRESHOLD) batteryIcon = 'battery_alert'; // Low but not critical yet? Or use 1/2 bar? Let's use alert for now.
                else { batteryIcon = 'battery_0_bar'; batteryClass = 'error'; } // Very Low/Critical
            } else if (displayInfo.batteryStatus !== 'Unknown') {
                batteryTooltip = displayInfo.batteryStatus;
                if (displayInfo.batteryStatus === 'Low' || displayInfo.batteryStatus === 'Very Low') {
                    batteryIcon = 'battery_alert'; batteryClass = 'error';
                }
            }

            // --- START: Fix Battery Indicator ---
            // Use material-symbols-outlined class
            const batteryIndicator = batteryTooltip
                ? `<span class="material-symbols-outlined ${batteryClass}" style="font-size: 18px; vertical-align: middle; font-variation-settings: 'FILL' 1;" title="${batteryTooltip}">${batteryIcon}</span>`
                : '';
            // --- END: Fix Battery Indicator ---

            const iconHtml = displayInfo.svg_icon || `<div class="device-icon-fallback">?</div>`;
            const isCurrentlyVisible = displayInfo.isVisible;
            const visibilityToggleHtml = `<label class="toggle-switch device-visibility-toggle" style="margin-left: 16px;" title="Show/Hide on Map"><input type="checkbox" data-device-id="${device.id}" ${isCurrentlyVisible ? 'checked' : ''}><span class="toggle-slider"></span></label>`;
            let displayStatus = displayInfo.status || 'Unknown Status';
            if (displayInfo.lat == null && displayInfo.lng == null && displayInfo.status === 'Location Unknown') { displayStatus = 'Awaiting first location...'; }
            else { displayStatus = displayStatus.replace(/ - Batt:.*$/, ''); } // Remove battery part if present

            const shareIndicatorHtml = device.is_shared
                ? `<span class="material-icons share-indicator" title="Shared" style="font-size: 16px; vertical-align: middle; margin-left: 4px; opacity: 0.7; color: var(--m3-sys-color-secondary);">share</span>`
                : '';

            const timestampISO = device.rawLocation?.timestamp || ''; // Get ISO timestamp
            const relativeTimeStr = timestampISO ? AppUtils.formatTimeRelative(new Date(timestampISO)) : 'Never';
            const addressTitle = displayInfo.address || ''; // Use formatted address string as title

            deviceElement.innerHTML = `
                   <div class="device-icon">${iconHtml}</div>
                   <div class="device-info">
                       <div class="device-name">${displayInfo.name}</div>
                       <div class="device-status" title="${addressTitle}">
                           <span class="relative-time" data-timestamp="${timestampISO}">${relativeTimeStr}</span> ${batteryIndicator} ${shareIndicatorHtml}
                       </div>
                       <div class="device-status" style="font-size: var(--body-small-size); opacity: 0.7;">${displayInfo.model || 'Accessory/Tag'}</div>
                   </div>
                   ${visibilityToggleHtml}
                   <span class="material-icons device-menu" data-device-index="${index}" tabindex="0" role="button" aria-label="Device options for ${displayInfo.name}">more_vert</span>`;
            listElement.appendChild(deviceElement);
        });
    },

    renderSavedPlacesList: function () {
        const listElement = document.getElementById('saved-places-list'); const noPlacesMessage = document.getElementById('no-places-message');
        if (!listElement || !noPlacesMessage) return; listElement.innerHTML = ''; const savedPlaces = AppState.savedPlaces;
        if (savedPlaces.length === 0) { noPlacesMessage.style.display = 'block'; listElement.appendChild(noPlacesMessage); return; }
        noPlacesMessage.style.display = 'none';
        savedPlaces.forEach((place, index) => {
            const placeElement = document.createElement('div'); placeElement.classList.add('shared-device'); placeElement.setAttribute('tabindex', '0'); placeElement.setAttribute('role', 'button'); placeElement.dataset.placeIndex = index;
            placeElement.innerHTML = `<div class="device-icon" style="background-color: var(--primary-color-light); border-radius: 50%;"><span class="material-icons" style="color: var(--primary-color);">star</span></div><div class="device-info"><div class="device-name">${place.name}</div><div class="device-status">${place.description || 'Saved Location'}</div><div class="device-status" style="font-size: var(--body-small-size); opacity: 0.7;">${place.lat ? place.lat.toFixed(4) + '°, ' + place.lng.toFixed(4) + '°' : 'Coordinates N/A'}</div></div><span class="material-icons device-menu" data-place-index="${index}" tabindex="0" role="button" aria-label="Options for ${place.name}">more_vert</span>`;
            listElement.appendChild(placeElement);
        });
    },

    renderGlobalGeofences: function () {
        const listContainer = document.getElementById('global-geofences-list'); const loadingIndicator = document.getElementById('global-geofences-loading'); const noItemsMessage = document.getElementById('no-global-geofences-message');
        if (!listContainer || !loadingIndicator || !noItemsMessage) return; const geofences = AppState.getGlobalGeofences();
        loadingIndicator.style.display = 'none'; listContainer.innerHTML = '';

        if (!Array.isArray(geofences)) {
            console.error("Received non-array data for geofences:", geofences);
            noItemsMessage.textContent = "Error: Invalid geofence data received.";
            noItemsMessage.style.display = 'block';
            listContainer.style.display = 'none';
            return; // Stop processing
        }

        if (geofences.length === 0) { noItemsMessage.style.display = 'block'; listContainer.style.display = 'none'; return; }
        noItemsMessage.style.display = 'none'; listContainer.style.display = 'block';

        geofences.forEach(gf => {
            const item = document.createElement('div'); item.className = 'settings-item geofence-list-item'; item.setAttribute('tabindex', '0'); item.setAttribute('role', 'button'); item.setAttribute('aria-label', `Geofence: ${gf.name}, click to edit`); item.dataset.geofenceId = gf.id;
            item.innerHTML = `<span class="material-icons drawer-item-icon" style="margin-right: 16px;">location_searching</span> <div class="settings-item-text"> <div class="settings-item-title">${gf.name}</div> <div class="settings-item-description"> Radius: ${gf.radius}m | Center: ${gf.lat.toFixed(4)}°, ${gf.lng.toFixed(4)}° </div> </div> <span class="material-icons geofence-edit" title="Edit Geofence" data-geofence-id="${gf.id}" style="margin-left: auto; cursor: pointer; opacity: 0.6;" tabindex="0" role="button" aria-label="Edit ${gf.name}">edit</span> <span class="material-icons geofence-remove" title="Remove Geofence" data-geofence-id="${gf.id}" style="margin-left: 8px; cursor: pointer; opacity: 0.6; color: var(--error-color);" tabindex="0" role="button" aria-label="Remove ${gf.name}">delete_outline</span>`;
            listContainer.appendChild(item);
        });
    },

    renderDeviceGeofenceLinks: function () {
        const container = document.getElementById('device-geofence-links-list'); const loadingIndicator = document.getElementById('device-links-loading'); const noDevicesMsg = document.getElementById('links-no-devices-message');
        if (!container || !loadingIndicator || !noDevicesMsg) return; const devices = AppState.getCurrentDeviceData(); const globalGeofences = AppState.getGlobalGeofences();
        loadingIndicator.style.display = 'none'; container.innerHTML = '';
        if (devices.length === 0) { noDevicesMsg.style.display = 'block'; return; } noDevicesMsg.style.display = 'none';
        devices.forEach(device => {
            const displayInfo = AppState.getDeviceDisplayInfo(device.id); const iconHtml = displayInfo.svg_icon || `<div class="device-icon-fallback">?</div>`;
            const deviceCard = document.createElement('div'); deviceCard.className = 'card device-geofence-card'; deviceCard.id = `device-link-card-${device.id}`;
            const linkedItemsHtml = (displayInfo.geofences || []).map(linkedGf => `<div class="geofence-link-item" data-geofence-id="${linkedGf.id}"><div class="geofence-link-info"><div class="geofence-link-name">${linkedGf.name}</div><div class="geofence-link-details">Radius: ${linkedGf.radius}m</div></div><div class="geofence-link-toggles"><label class="geofence-link-toggle-label" title="Notify on Entry"><input type="checkbox" data-notify-type="entry" ${linkedGf.notify_on_entry ? 'checked' : ''}> Entry</label><label class="geofence-link-toggle-label" title="Notify on Exit"><input type="checkbox" data-notify-type="exit" ${linkedGf.notify_on_exit ? 'checked' : ''}> Exit</label><span class="material-icons geofence-remove" title="Unlink Geofence" data-geofence-id="${linkedGf.id}" style="margin-left: 8px; cursor: pointer; opacity: 0.6; color: var(--error-color);" tabindex="0" role="button" aria-label="Unlink ${linkedGf.name}">link_off</span></div></div>`).join('');
            const linkedIds = new Set((displayInfo.geofences || []).map(gf => gf.id)); const availableGeofences = globalGeofences.filter(gf => !linkedIds.has(gf.id));
            const addOptionsHtml = availableGeofences.length > 0 ? availableGeofences.map(gf => `<option value="${gf.id}">${gf.name}</option>`).join('') : '<option value="" disabled>No other geofences available</option>';
            const addSectionHtml = `<div style="display: flex; align-items: center; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--outline-variant-color);"><select class="add-geofence-select" style="flex-grow: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--outline-color); background-color: var(--surface-color); color: var(--on-surface-color);"><option value="" disabled selected>-- Link a Geofence --</option>${addOptionsHtml}</select><button class="button link-geofence-button" style="padding: 8px 16px;" ${availableGeofences.length === 0 ? 'disabled' : ''}><span class="material-icons" style="font-size: 18px; vertical-align: bottom;">link</span></button></div><p id="link-error-${device.id}" style="color: var(--error-color); font-size: var(--body-small-size); margin-top: 4px; display: none;"></p>`;
            deviceCard.innerHTML = `<div class="card-title" style="display: flex; align-items: center;"><div class="device-icon" style="width: 36px; height: 36px; margin-right: 12px;">${iconHtml}</div><span style="flex-grow: 1;">${displayInfo.name}</span><button class="button save-links-button" data-device-id="${device.id}" style="margin-left: auto; padding: 8px 12px; display: none;"><span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">save</span> Save Changes</button></div><div class="linked-geofences-list">${linkedItemsHtml || '<p class="no-geofences-message" style="padding: 8px 0; font-style: italic; opacity: 0.7;">No geofences linked yet.</p>'}</div>${addSectionHtml}`;
            container.appendChild(deviceCard);
        });
    },

    renderAddGeofenceDropdown: function (deviceCardElement, deviceId) {
        const selectElement = deviceCardElement.querySelector('.add-geofence-select'); const linkButton = deviceCardElement.querySelector('.link-geofence-button');
        if (!selectElement || !linkButton) return; const currentLinkedItems = deviceCardElement.querySelectorAll('.geofence-link-item');
        const linkedIds = new Set(Array.from(currentLinkedItems).map(item => item.dataset.geofenceId)); const globalGeofences = AppState.getGlobalGeofences();
        const availableGeofences = globalGeofences.filter(gf => !linkedIds.has(gf.id));
        const addOptionsHtml = availableGeofences.length > 0 ? availableGeofences.map(gf => `<option value="${gf.id}">${gf.name}</option>`).join('') : '<option value="" disabled>No other geofences available</option>';
        selectElement.innerHTML = `<option value="" disabled selected>-- Link a Geofence --</option> ${addOptionsHtml}`; linkButton.disabled = availableGeofences.length === 0;
    },

    renderLocationHistory: function () {
        const c = document.getElementById('location-history-container'); const l = document.getElementById('history-loading-indicator'); const t = document.getElementById('location-timeline');
        const n = document.getElementById('no-history-message'); const d = document.getElementById('history-disabled-message'); if (!c || !l || !t || !n || !d) return;
        l.style.display = 'none'; t.innerHTML = ''; n.style.display = 'none'; d.style.display = 'none'; t.style.display = 'block';
        if (!AppState.locationHistoryEnabled) { d.style.display = 'block'; t.style.display = 'none'; return; }
        if (AppState.locationHistory.length === 0) { n.style.display = 'block'; t.appendChild(n); return; }
        AppState.locationHistory.forEach(item => {
            const li = document.createElement('div');
            li.classList.add('timeline-item');
            const timestampISO = item.timestampISO || ''; // Assuming you store ISO time in history items
            const relativeTimeStr = timestampISO ? AppUtils.formatTimeRelative(new Date(timestampISO)) : 'Unknown time';

            li.innerHTML = `
                <div class="timeline-dot"></div>
                <div class="timeline-time relative-time" data-timestamp="${timestampISO}">${relativeTimeStr}</div>
                <div class="timeline-content">
                    <div class="timeline-location">${item.location}</div>
                    <p>${item.address || 'N/A'}</p>
                    ${item.lat ? `<p style="font-size:var(--body-small-size);opacity:0.7;">${item.lat.toFixed(4)}°, ${item.lng.toFixed(4)}°</p>` : ''}
                </div>`;
            t.appendChild(li);
        });
    },

    // --- UI State Updates ---
    setTheme: function (themeName) {
        console.log("[UI] Setting theme:", themeName); AppState.currentTheme = themeName; AppState.saveTheme();
        const body = document.body; const metaThemeColor = document.getElementById('meta-theme-color'); body.classList.remove('dark-theme', 'light-theme');
        let isDark = false;
        if (themeName === 'dark') { body.classList.add('dark-theme'); isDark = true; }
        else if (themeName === 'light') { body.classList.add('light-theme'); }
        else { if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) { body.classList.add('dark-theme'); isDark = true; } else { body.classList.add('light-theme'); } }
        if (metaThemeColor) metaThemeColor.setAttribute('content', isDark ? '#1E1B22' : '#FDFCFE'); // Match CSS background
        AppMap.updateMapThemeStyle(isDark); document.querySelectorAll('input[name="theme"]').forEach(r => r.checked = (r.value === AppState.currentTheme));
        document.querySelectorAll('input[name="theme-dialog"]').forEach(r => r.checked = (r.value === AppState.currentTheme));
        AppMap.redrawGeofenceLayer();
    },

    updateShowAllButtonState: function () {
        const button = document.getElementById('show-all-button'); const icon = document.getElementById('show-all-icon'); if (!button || !icon) return;
        const isActive = AppState.isShowingAllDevices; button.classList.toggle('active', isActive); button.setAttribute('aria-pressed', isActive.toString());
        button.setAttribute('aria-label', isActive ? 'Hide all devices and places' : 'Show all devices and places'); icon.textContent = isActive ? 'layers_clear' : 'layers';
    },

    updateShowHistoryButtonState: function () {
        const button = document.getElementById('show-history-button');
        const sliderContainer = document.querySelector('.history-slider-container'); // Use querySelector
        if (!button || !sliderContainer) return;

        const isActive = AppState.showDeviceHistory; // Read from state
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive.toString());

        // --- FIX: Toggle slider visibility based on state ---
        sliderContainer.classList.toggle('visible', isActive);
        // --- END FIX ---

        console.log(`[UI Update] Show History Button Active: ${isActive}, Slider Visible: ${isActive}`);
    },

    updateHistorySliderLabel: function () {
        const label = document.getElementById('history-slider-label');
        const slider = document.getElementById("history-slider");
        const hours = AppState.historyTimeFilterHours; // Read from state

        if (slider) {
            slider.value = parseInt(hours, 10); // Ensure this line is present and correct
            console.log(`[UI Update] Set history slider value to: ${slider.value} (from state: ${hours})`); // Add log
        } else {
            console.warn("[UI Update] History slider element not found when trying to set value.");
        }
        // --- END FIX ---

        if (label) {
            if (hours < 24) { label.textContent = `Last ${hours}h`; }
            else if (hours === 24) { label.textContent = `Last 24h`; }
            else { label.textContent = `Last ${(hours / 24).toFixed(0)}d`; }
        }
    },

    setTheme: function (themePreference) {
        // DELEGATE all theme application logic to AppTheme
        console.log("[UI] Setting theme preference via AppTheme:", themePreference);
        AppState.currentTheme = themePreference; // Update state
        localStorage.setItem('theme', themePreference); // Save preference
        AppTheme.applyTheme(AppState.userColor, themePreference); // Apply with current color

        // Update UI elements (radio buttons) if needed - AppTheme.initialize might cover this
        document.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.checked = (radio.value === AppState.currentTheme);
        });
    },

    setupSettingsPage: function () {
        const versionElement = document.getElementById('app-version');
        if (versionElement) versionElement.textContent = `Version ${AppConfig.APP_VERSION}`;

        // --- Theme (Unchanged) ---
        const colorPicker = document.getElementById('theme-color-picker');
        if (colorPicker) colorPicker.value = AppState.userColor;
        document.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.checked = (radio.value === AppState.currentTheme);
        });

        // --- Toggles (Unchanged) ---
        const historyToggle = document.getElementById('location-history-toggle');
        if (historyToggle) historyToggle.checked = AppState.locationHistoryEnabled;
        const showAllToggle = document.getElementById('show-all-default-toggle');
        if (showAllToggle) showAllToggle.checked = AppState.isShowingAllDevices;
        const showHistoryToggle = document.getElementById('show-history-default-toggle');
        if (showHistoryToggle) showHistoryToggle.checked = AppState.showDeviceHistory;

        // --- Notifications (Unchanged) ---
        AppNotifications.updateNotificationButtonState();

        // --- Device File Upload (Keep existing setup for settings page) ---
        const deviceFileInput = document.getElementById('device-file-input');
        const deviceFileListDisplay = document.getElementById('selected-files-list');
        const uploadButtonInitialRef = document.getElementById('upload-file-button');

        if (deviceFileInput) deviceFileInput.value = '';
        if (deviceFileListDisplay) deviceFileListDisplay.innerHTML = '';
        if (uploadButtonInitialRef) uploadButtonInitialRef.disabled = true;

        deviceFileInput?.addEventListener('change', () => {
            const currentUploadButton = document.getElementById('upload-file-button');
            const currentFileListDisplay = document.getElementById('selected-files-list');
            if (!currentFileListDisplay || !currentUploadButton) return;
            currentFileListDisplay.innerHTML = '';
            if (deviceFileInput.files.length > 0) {
                const list = document.createElement('ul');
                Array.from(deviceFileInput.files).forEach(file => {
                    const item = document.createElement('li'); item.textContent = file.name; list.appendChild(item);
                });
                currentFileListDisplay.appendChild(list);
                currentUploadButton.disabled = false;
            } else {
                currentUploadButton.disabled = true;
            }
        });

        if (uploadButtonInitialRef) {
            const newUploadButton = uploadButtonInitialRef.cloneNode(true);
            newUploadButton.addEventListener('click', async () => {
                console.log("[UI] Device upload button clicked.");
                if (!deviceFileInput?.files || deviceFileInput.files.length === 0) return;
                const formData = new FormData();
                Array.from(deviceFileInput.files).forEach(file => formData.append('device_file', file));

                newUploadButton.disabled = true;
                newUploadButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Uploading...`;
                const statusEl = document.getElementById('upload-status');
                if (statusEl) { statusEl.textContent = 'Uploading...'; statusEl.style.color = 'inherit'; }

                try {
                    const result = await AppApi._fetch('/api/files/upload', { method: 'POST', body: formData });
                    console.log("[UI] Device upload API result:", result);
                    if (statusEl) {
                        statusEl.textContent = result.message || 'Upload complete.';
                        const hasErrors = result.details?.errors?.length > 0;
                        const hasSuccess = result.details?.success?.length > 0;
                        if (hasErrors && !hasSuccess) statusEl.style.color = 'var(--m3-sys-color-error)';
                        else if (hasErrors && hasSuccess) statusEl.style.color = 'var(--m3-sys-color-secondary)';
                        else statusEl.style.color = 'var(--m3-sys-color-primary)';
                    }
                    if (result.details?.success?.length > 0) {
                        AppUI.showConfirmationDialog("Upload Complete", result.message || "Files processed.", async () => { await AppActions.refreshDevices(); });
                    } else if (result.details?.errors?.length > 0) {
                        AppUI.showErrorDialog("Upload Failed", result.message || "Some files failed to upload.");
                        await AppActions.refreshDevices();
                    }
                    if (deviceFileInput) deviceFileInput.value = '';
                    if (deviceFileListDisplay) deviceFileListDisplay.innerHTML = '';
                    newUploadButton.disabled = true;
                    newUploadButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">upload_file</span> Upload Selected Files`;
                } catch (error) {
                    console.error('[UI] Device upload failed:', error);
                    if (statusEl) { statusEl.textContent = `Upload failed: ${error.message}`; statusEl.style.color = 'var(--m3-sys-color-error)'; }
                    AppUI.showErrorDialog("Upload Failed", `Could not upload files.<br>Details: ${error.message}`);
                    newUploadButton.disabled = true;
                    newUploadButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">upload_file</span> Upload Selected Files`;
                }
            });
            uploadButtonInitialRef.parentNode.replaceChild(newUploadButton, uploadButtonInitialRef);
        }
        // --- End device file upload setup ---

        // --- Config Import/Export Listener Setup (REVISED) ---
        const exportButton = document.getElementById('export-config-button');
        if (exportButton) {
            const newExportButton = exportButton.cloneNode(true);
            newExportButton.addEventListener('click', AppActions.handleExportConfig);
            exportButton.parentNode.replaceChild(newExportButton, exportButton);
        }

        // Setup button on settings page to OPEN the dialog
        const openImportDialogButton = document.getElementById('open-import-dialog-button');
        if (openImportDialogButton) {
            const newOpenImportButton = openImportDialogButton.cloneNode(true);
            // Add listener to OPEN the dialog
            newOpenImportButton.addEventListener('click', () => this.openDialog('config-import-dialog'));
            openImportDialogButton.parentNode.replaceChild(newOpenImportButton, openImportDialogButton);
        } else {
            console.warn("[UI Setup] Button #open-import-dialog-button not found!");
        }

        // Setup listeners for elements *inside* the dialog - these NEED unique IDs
        const dialogImportInput = document.getElementById('dialog-import-config-file-input');
        if (dialogImportInput) {
            const newDialogImportInput = dialogImportInput.cloneNode(true);
            // Use the NEW dialog-specific handler
            newDialogImportInput.addEventListener('change', (e) => this.handleDialogImportFileSelection(e));
            dialogImportInput.parentNode.replaceChild(newDialogImportInput, dialogImportInput);
            console.log("[UI Setup] Listener added for #dialog-import-config-file-input");
        } else {
            console.warn("[UI Setup] Input #dialog-import-config-file-input not found!");
        }

        const dialogConfirmButton = document.getElementById('dialog-confirm-import-button');
        if (dialogConfirmButton) {
            const newDialogConfirmButton = dialogConfirmButton.cloneNode(true);
            // Attach listener to the action handler which now targets dialog elements
            newDialogConfirmButton.addEventListener('click', AppActions.handleImportConfirm);
            dialogConfirmButton.parentNode.replaceChild(newDialogConfirmButton, dialogConfirmButton);
            console.log("[UI Setup] Listener added for #dialog-confirm-import-button");
        } else {
            console.warn("[UI Setup] Button #dialog-confirm-import-button not found!");
        }
        // --- End Revised Import/Export Setup ---

        // --- Test Notification Button (Unchanged) ---
        const testButton = document.getElementById('test-notification-button');
        if (testButton) {
            const newTestButton = testButton.cloneNode(true);
            newTestButton.addEventListener('click', () => AppNotifications.handleTestNotification('test'));
            testButton.parentNode.replaceChild(newTestButton, testButton);
        }

        // --- Account Deletion Button (Unchanged) ---
        const deleteAccountButton = document.getElementById('delete-account-button');
        if (deleteAccountButton) {
            const newDelButton = deleteAccountButton.cloneNode(true);
            newDelButton.addEventListener('click', () => {
                this.showConfirmationDialog(
                    "Delete Account?",
                    "<strong>This action is permanent...</strong>", // Keep confirmation message
                    () => AppActions.handleDeleteAccount(), // Call action handler
                    () => console.log("Account deletion cancelled.")
                );
            });
            deleteAccountButton.parentNode.replaceChild(newDelButton, deleteAccountButton);
        }

    }, // End setupSettingsPag


    // --- Action Handlers ---
    handleDeviceVisibilityToggle: function (checkbox) {
        const id = checkbox.dataset.deviceId; const isVisible = checkbox.checked; console.log(`[UI] Visibility toggle changed for ${id}: ${isVisible}`);
        AppState.setDeviceVisibility(id, isVisible); this.saveDeviceVisibilityWithDebounce();
        if (document.getElementById('index-page').style.display !== 'none') { AppMap.updateMapView(); }
        const editDialogToggle = document.getElementById('edit-device-visibility');
        const editDialogOverlay = document.getElementById('edit-device-dialog-overlay');
        if (editDialogOverlay?.classList.contains('show') && document.getElementById('edit-device-id')?.value === id) {
            if (editDialogToggle) editDialogToggle.checked = isVisible;
        }
    },

    _saveVisibilityDebounced: null,
    saveDeviceVisibilityWithDebounce: function () {
        if (!this._saveVisibilityDebounced) { this._saveVisibilityDebounced = AppUtils.debounce(() => { AppState.saveDeviceVisibilityState(); console.log("[UI] Debounced: Saved device visibility state."); }, AppConfig.SAVE_VISIBILITY_DEBOUNCE); }
        this._saveVisibilityDebounced();
    },

    openAddPlaceDialog: function () {
        document.getElementById('new-place-name').value = ''; document.getElementById('new-place-description').value = ''; document.getElementById('new-place-lat').value = ''; document.getElementById('new-place-lng').value = '';
        document.getElementById('place-picker-search-input').value = ''; document.getElementById('place-picker-search-error').style.display = 'none';
        this.openDialog('add-place-dialog'); // Map init handled in openDialog
    },

    handleAddPlaceSubmit: function () {
        const name = document.getElementById('new-place-name').value.trim(); const desc = document.getElementById('new-place-description').value.trim();
        const lat = parseFloat(document.getElementById('new-place-lat').value); const lng = parseFloat(document.getElementById('new-place-lng').value);
        if (!name) { this.showErrorDialog("Input Required", "Please enter a name for the place."); return; }
        if (isNaN(lat) || isNaN(lng)) { this.showErrorDialog("Location Required", "Please select a location on the map."); return; }
        const newPlace = { name, description: desc, lat, lng, id: `place_${Date.now()}` }; AppState.savedPlaces.push(newPlace); AppState.saveSavedPlaces();
        console.log("[UI] Added place:", newPlace);
        if (document.getElementById('places-page').style.display !== 'none') { this.renderSavedPlacesList(); }
        AppMap.renderSavedPlaceMarkers(); if (document.getElementById('index-page').style.display !== 'none') { AppMap.updateMapView(); }
        this.showConfirmationDialog("Place Saved", `"${name}" has been saved.`); this.closeDialog('add-place-dialog');
    },

    removePlace: function (placeIndex) {
        if (placeIndex >= 0 && placeIndex < AppState.savedPlaces.length) {
            const removed = AppState.savedPlaces.splice(placeIndex, 1)[0]; console.log("[UI] Removed place:", removed.name); AppState.saveSavedPlaces();
            this.renderSavedPlacesList(); AppMap.renderSavedPlaceMarkers(); if (document.getElementById('index-page').style.display !== 'none') { AppMap.updateMapView(); }
        }
    },

    sharePlace: function (placeIndex) {
        const place = AppState.savedPlaces[placeIndex];
        if (!place) return;
        const lat = place.lat;
        const lng = place.lng;
        const name = place.name;
        const desc = place.description || '';

        // --- Construct the text for the specific place ---
        let text = `Saved Place: ${name}`;
        if (desc) {
            text += `\nDescription: ${desc}`;
        }
        if (lat != null && lng != null) {
            text += `\nLocation: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            text += `\nMap: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
            text += `\nGoogle Maps: https://www.google.com/maps?q=${lat},${lng}`;
        } else {
            text += `\n(Location not available)`;
        }

        // --- Populate the dialog textarea ---
        const ta = document.getElementById('share-location-textarea');
        const p = document.getElementById('share-location-dialog-content')?.querySelector('p');
        if (ta) {
            ta.value = text;
            console.log("[UI] Populated share dialog with place details:", name);
        }
        if (p) {
            p.textContent = `Copy text to share "${name}":`;
        }

        // --- Open the dialog ---
        this.openDialog('share-location-dialog');

        // --- Select text after dialog is likely visible ---
        setTimeout(() => {
            if (ta) {
                ta.select();
                ta.setSelectionRange(0, 99999); // For mobile
            }
        }, 100); // Small delay
    },

    // --- Search Results ---
    _createSearchResultItem: function (item) {
        const element = document.createElement('div'); element.classList.add('search-result-item'); element.setAttribute('tabindex', '0'); element.setAttribute('role', 'option');
        element.dataset.type = item.type; if (item.id) element.dataset.id = item.id; if (item.target) element.dataset.target = item.target;
        if (item.query) element.dataset.query = item.query; if (item.lat) element.dataset.lat = item.lat; if (item.lng) element.dataset.lng = item.lng;
        if (item.placeIndex !== undefined) element.dataset.placeIndex = item.placeIndex; if (item.section) element.dataset.section = item.section;
        let iconHtml = `<span class="material-icons search-result-icon">${item.icon || 'search'}</span>`;
        if (item.type === 'device' && item.svg_icon) { iconHtml = `<span class="search-result-icon" style="display:flex; align-items:center; justify-content:center; width:24px; height:24px;">${item.svg_icon.replace(/width="\d+"/, 'width="24"').replace(/height="\d+"/, 'height="24"')}</span>`; }
        element.innerHTML = `${iconHtml}<div class="search-result-text"><div class="search-result-title">${item.name || 'Unknown'}</div><div class="search-result-description">${item.description || ''}</div></div>`;
        element.addEventListener('click', this.handleSearchResultClick.bind(this)); element.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.handleSearchResultClick(e); } });
        return element;
    },

    renderSearchResults: function (results, containerId) {
        const container = document.getElementById(containerId); if (!container) return; container.innerHTML = '';
        if (!results || results.length === 0) { container.innerHTML = '<div class="search-result-item no-results">No results found</div>'; return; }

        let filteredResults = results;
        const isDialogSearch = containerId !== 'search-results-container';
        if (isDialogSearch) { filteredResults = results.filter(item => item.type === 'location'); }
        if (filteredResults.length === 0 && isDialogSearch) { container.innerHTML = '<div class="search-result-item no-results">No locations found</div>'; return; }
        if (filteredResults.length === 0 && !isDialogSearch) { container.innerHTML = '<div class="search-result-item no-results">No results found</div>'; return; }

        if (!isDialogSearch) {
            const groupedResults = filteredResults.reduce((acc, item) => { const category = item.type || 'other'; if (!acc[category]) acc[category] = []; acc[category].push(item); return acc; }, {});
            const categoryOrder = ['location', 'device', 'place', 'geofence', 'action']; const categoryNames = { location: 'Locations', device: 'Devices', place: 'Saved Places', geofence: 'Geofences', action: 'App Actions' };
            categoryOrder.forEach(category => {
                if (groupedResults[category]) {
                    const categoryHeader = document.createElement('div'); categoryHeader.className = 'search-result-category'; categoryHeader.textContent = categoryNames[category] || category.charAt(0).toUpperCase() + category.slice(1); container.appendChild(categoryHeader);
                    groupedResults[category].forEach(item => { container.appendChild(this._createSearchResultItem(item)); });
                }
            });
            Object.keys(groupedResults).forEach(category => { if (!categoryOrder.includes(category)) { groupedResults[category].forEach(item => container.appendChild(this._createSearchResultItem(item))); } });
        } else {
            filteredResults.forEach(item => { container.appendChild(this._createSearchResultItem(item)); });
        }
    },

    showSearchResults: function (containerId = 'search-results-container') {
        const container = document.getElementById(containerId); if (container) container.classList.add('show');
    },

    hideSearchResults: function (containerId = 'search-results-container') {
        const container = document.getElementById(containerId); if (container) container.classList.remove('show');
    },

    handleSearchResultClick: function (event) {
        const itemElement = event.currentTarget; const type = itemElement.dataset.type; const id = itemElement.dataset.id; const target = itemElement.dataset.target;
        const query = itemElement.dataset.query; const lat = parseFloat(itemElement.dataset.lat); const lng = parseFloat(itemElement.dataset.lng);
        const placeIndex = parseInt(itemElement.dataset.placeIndex, 10); const section = itemElement.dataset.section;
        const sourceDialogId = itemElement.closest('.dialog')?.id;

        console.log(`[UI] Search result clicked: Type=${type}, ID=${id}, Target=${target}, Query=${query}, Section=${section}, SourceDialog=${sourceDialogId}`);
        const resultsContainerId = itemElement.closest('.search-results-container')?.id; if (resultsContainerId) { this.hideSearchResults(resultsContainerId); }
        const searchInputId = sourceDialogId ? (sourceDialogId === 'add-place-dialog' ? 'place-picker-search-input' : 'geofence-picker-search-input') : 'location-search-input';
        const searchInput = document.getElementById(searchInputId); if (searchInput) searchInput.value = '';

        try {
            switch (type) {
                case 'location':
                    if (sourceDialogId === 'add-place-dialog' && !isNaN(lat) && !isNaN(lng)) {
                        const mapState = AppState.placePickerDialog;
                        if (mapState.map) mapState.map.setView([lat, lng], 15);
                        if (mapState.marker) mapState.marker.setLatLng([lat, lng]);
                        document.getElementById('new-place-lat').value = lat.toFixed(5);
                        document.getElementById('new-place-lng').value = lng.toFixed(5);
                        if (searchInput) searchInput.value = itemElement.querySelector('.search-result-description')?.textContent || query || '';
                    } else if (sourceDialogId === 'geofence-dialog' && !isNaN(lat) && !isNaN(lng)) {
                        const mapState = AppState.geofenceDialog;
                        if (mapState.map) mapState.map.setView([lat, lng], 15);
                        if (mapState.marker) mapState.marker.setLatLng([lat, lng]);
                        if (mapState.circle) mapState.circle.setLatLng([lat, lng]);
                        document.getElementById('geofence-lat').value = lat.toFixed(5);
                        document.getElementById('geofence-lng').value = lng.toFixed(5);
                        if (searchInput) searchInput.value = itemElement.querySelector('.search-result-description')?.textContent || query || '';
                    } else if (!sourceDialogId && query) { AppMap.geocodeAddress(query, true); }
                    else if (!sourceDialogId && !isNaN(lat) && !isNaN(lng)) { this.changePage('index'); setTimeout(() => { AppMap.addSearchMarker(lat, lng, itemElement.querySelector('.search-result-description')?.textContent || 'Selected Location'); AppMap.updateMapView(); }, 50); }
                    else { console.warn("[UI] Unhandled location click scenario:", sourceDialogId, query, lat, lng); }
                    break;
                case 'device': AppMap.viewDeviceOnMap(id); break;
                case 'place': if (!isNaN(placeIndex)) { AppMap.viewPlaceOnMap(placeIndex); } else { console.warn("[UI] Place index missing"); } break;
                case 'geofence': AppMap.viewGeofenceOnMap(id); break;
                case 'action':
                    if (target === 'manage_apple_creds') { window.location.href = '/manage_apple_creds'; }
                    else if (target.startsWith('dialog:')) { this.openDialog(target.substring(7)); }
                    else { this.changePage(target, section); }
                    break;
                default: console.warn("[UI] Unknown search result type:", type);
            }
        } catch (error) { console.error("[UI] Error handling search result action:", error); this.showErrorDialog("Action Failed", `Could not perform action. Error: ${error.message}`); }
        if (searchInput) searchInput.blur();
    },

    copyShareLocationText: async function () { // Keep the improved version from previous step
        const ta = document.getElementById('share-location-textarea');
        const copyButton = document.getElementById('copy-share-button');
        if (!ta || !copyButton) return;

        ta.select();
        ta.setSelectionRange(0, 99999);

        const originalButtonText = copyButton.textContent;
        copyButton.textContent = 'Copying...';
        copyButton.disabled = true;

        let success = false;
        let errorMessage = "Could not copy automatically.";

        if (navigator.clipboard && window.isSecureContext) {
            console.log('[UI] Attempting copy via Clipboard API...');
            try {
                await navigator.clipboard.writeText(ta.value);
                console.log('[UI] Copied via Clipboard API');
                success = true;
            } catch (err) {
                console.error('[UI] Clipboard API failed:', err);
                errorMessage = `Clipboard API Error: ${err.message}. Please copy manually.`;
            }
        } else {
            if (!window.isSecureContext) { console.warn('[UI] Clipboard API skipped: Page is not secure (HTTPS).'); errorMessage = "Copy failed: Page is not secure (HTTPS). Please copy manually."; }
            else { console.warn('[UI] Clipboard API not available.'); errorMessage = "Clipboard API unavailable. Trying fallback..."; }
        }

        if (!success) {
            console.log('[UI] Attempting copy via document.execCommand...');
            try {
                ta.focus();
                if (document.execCommand('copy')) {
                    console.log('[UI] Copied via execCommand fallback');
                    success = true;
                } else {
                    console.warn('[UI] execCommand returned false.');
                    errorMessage = "Fallback copy command failed. Please copy manually.";
                }
            } catch (execErr) {
                console.error('[UI] Fallback execCommand failed:', execErr);
                errorMessage = `Fallback copy error: ${execErr.message}. Please copy manually.`;
            }
            ta.blur();
        }

        copyButton.disabled = false;
        if (success) {
            copyButton.textContent = 'Copied!';
            this.showConfirmationDialog("Copied!", "Location text copied to clipboard.");
            setTimeout(() => {
                this.closeDialog('share-location-dialog');
                copyButton.textContent = originalButtonText;
            }, 1000);
        } else {
            copyButton.textContent = 'Failed!';
            this.showErrorDialog("Copy Failed", errorMessage);
            setTimeout(() => {
                copyButton.textContent = originalButtonText;
            }, 2000);
        }
    },

    openEditDeviceDialog: function (deviceId) {
        const device = AppState.getDeviceDisplayInfo(deviceId); if (!device) { this.showErrorDialog("Error", "Device data not found."); return; }
        document.getElementById('edit-device-id').value = deviceId; document.getElementById('edit-device-name').value = device.name === deviceId ? '' : device.name;
        document.getElementById('edit-device-name').placeholder = device.name; document.getElementById('edit-device-label').value = device.label === '❓' ? '' : device.label;
        document.getElementById('edit-device-color').value = device.color || AppUtils.getDefaultColorForId(deviceId); document.getElementById('edit-device-dialog-title').textContent = `Edit "${device.name}"`;
        const visibilityToggle = document.getElementById('edit-device-visibility'); const newVisibilityToggle = visibilityToggle.cloneNode(true); newVisibilityToggle.checked = device.isVisible;
        newVisibilityToggle.addEventListener('change', (e) => { const currentId = document.getElementById('edit-device-id').value; AppState.setDeviceVisibility(currentId, e.target.checked); this.saveDeviceVisibilityWithDebounce(); if (document.getElementById('index-page').style.display !== 'none') { AppMap.updateMapView(); } const listToggle = document.querySelector(`.device-visibility-toggle input[data-device-id="${currentId}"]`); if (listToggle) listToggle.checked = e.target.checked; });
        visibilityToggle.parentNode.replaceChild(newVisibilityToggle, visibilityToggle);
        const saveButton = document.getElementById('save-device-edit-button'); const newSaveButton = saveButton.cloneNode(true); newSaveButton.addEventListener('click', AppActions.handleEditDeviceSubmit); saveButton.parentNode.replaceChild(newSaveButton, saveButton);
        this.openDialog('edit-device-dialog');
    },

    openAddGlobalGeofenceDialog: function () {
        document.getElementById('geofence-dialog-title').textContent = 'Add Global Geofence'; document.getElementById('geofence-edit-id').value = ''; document.getElementById('geofence-name').value = ''; document.getElementById('geofence-radius').value = '100'; document.getElementById('geofence-lat').value = ''; document.getElementById('geofence-lng').value = ''; document.getElementById('geofence-picker-search-input').value = ''; document.getElementById('geofence-picker-search-error').style.display = 'none'; document.getElementById('geofence-picker-search-results').innerHTML = ''; document.getElementById('geofence-picker-search-results').classList.remove('show');
        const saveButton = document.getElementById('geofence-dialog-save-button'); const newSaveButton = saveButton.cloneNode(true); newSaveButton.addEventListener('click', AppActions.handleGeofenceDialogSubmit); saveButton.parentNode.replaceChild(newSaveButton, saveButton);
        this.openDialog('geofence-dialog');
    },

    openEditGlobalGeofenceDialog: function (geofenceId) {
        const geofence = AppState.globalGeofenceData.find(gf => gf.id === geofenceId); if (!geofence) { this.showErrorDialog("Error", "Geofence not found."); return; }
        document.getElementById('geofence-dialog-title').textContent = `Edit Geofence "${geofence.name}"`; document.getElementById('geofence-edit-id').value = geofence.id; document.getElementById('geofence-name').value = geofence.name; document.getElementById('geofence-radius').value = geofence.radius; document.getElementById('geofence-lat').value = geofence.lat.toFixed(5); document.getElementById('geofence-lng').value = geofence.lng.toFixed(5); document.getElementById('geofence-picker-search-input').value = ''; document.getElementById('geofence-picker-search-error').style.display = 'none'; document.getElementById('geofence-picker-search-results').innerHTML = ''; document.getElementById('geofence-picker-search-results').classList.remove('show');
        const saveButton = document.getElementById('geofence-dialog-save-button'); const newSaveButton = saveButton.cloneNode(true); newSaveButton.addEventListener('click', AppActions.handleGeofenceDialogSubmit); saveButton.parentNode.replaceChild(newSaveButton, saveButton);
        this.openDialog('geofence-dialog');
    },

    // --- Map View Toggles ---
    toggleShowAllDevices: function () {
        AppState.isShowingAllDevices = !AppState.isShowingAllDevices; console.log("[UI] Toggled Show All:", AppState.isShowingAllDevices);
        if (AppState.isShowingAllDevices) { AppState.currentViewedDeviceId = null; AppMap.clearSearchMarker(); const searchInput = document.getElementById('location-search-input'); if (searchInput) searchInput.value = ''; }
        this.updateShowAllButtonState(); AppMap.updateMapView(); AppState.saveMapToggles();
    },

    toggleShowHistory: function () {
        AppState.showDeviceHistory = !AppState.showDeviceHistory; console.log("[UI] Toggled Show History:", AppState.showDeviceHistory);
        this.updateShowHistoryButtonState(); AppMap.updateHistoryLayersVisibility(); AppState.saveMapToggles();
    },

    // --- Dialog Search Setup ---
    setupDialogSearch: function (dialogId) {
        let searchInputId, resultsContainerId;
        if (dialogId === 'add-place-dialog') {
            searchInputId = 'place-picker-search-input';
            resultsContainerId = 'place-picker-search-results';
        } else if (dialogId === 'geofence-dialog') {
            searchInputId = 'geofence-picker-search-input';
            resultsContainerId = 'geofence-picker-search-results';
        } else {
            console.error(`[UI] Cannot setup dialog search for unknown dialog ID: ${dialogId}`); return;
        }
        console.log(`[UI] Setting up dialog search for ${dialogId}: Input='${searchInputId}', Results='${resultsContainerId}'`);
        const searchInput = document.getElementById(searchInputId); const resultsContainer = document.getElementById(resultsContainerId);
        if (!searchInput) { console.error(`[UI] Search input #${searchInputId} not found for dialog ${dialogId}`); return; }
        if (!resultsContainer) { console.error(`[UI] Search results container #${resultsContainerId} not found for dialog ${dialogId}`); return; }
        if (!searchInput._debouncedSearchHandler) { searchInput._debouncedSearchHandler = AppUtils.debounce((query, containerId) => this.performDialogSearch(query, containerId), 350); }
        searchInput._handleInput = (event) => this.handleDialogSearchInput(event, resultsContainerId);
        searchInput._handleFocus = (event) => this.handleDialogSearchInput(event, resultsContainerId); // Also search on focus if input has value
        searchInput._handleBlur = (event) => this.handleDialogSearchBlur(event, resultsContainerId);
        searchInput._handleKeypress = (event) => this.handleDialogSearchKeypress(event, resultsContainerId);
        searchInput.addEventListener('input', searchInput._handleInput);
        searchInput.addEventListener('focus', searchInput._handleFocus);
        searchInput.addEventListener('blur', searchInput._handleBlur);
        searchInput.addEventListener('keypress', searchInput._handleKeypress); // Add keypress for Enter
        console.log(`[UI] Dialog search listeners setup for ${searchInputId}`);
    },

    cleanupDialogSearch: function (dialogId) {
        let searchInputId;
        if (dialogId === 'add-place-dialog') { searchInputId = 'place-picker-search-input'; }
        else if (dialogId === 'geofence-dialog') { searchInputId = 'geofence-picker-search-input'; }
        else { console.warn(`[UI] Cannot cleanup dialog search for unknown dialog ID: ${dialogId}`); return; }
        const searchInput = document.getElementById(searchInputId); if (!searchInput) return;
        console.log(`[UI] Cleaning up dialog search listeners for ${searchInputId}`); // Added log
        if (searchInput._handleInput) searchInput.removeEventListener('input', searchInput._handleInput);
        if (searchInput._handleFocus) searchInput.removeEventListener('focus', searchInput._handleFocus);
        if (searchInput._handleBlur) searchInput.removeEventListener('blur', searchInput._handleBlur);
        if (searchInput._handleKeypress) searchInput.removeEventListener('keypress', searchInput._handleKeypress);
        delete searchInput._handleInput; delete searchInput._handleFocus; delete searchInput._handleBlur; delete searchInput._handleKeypress; delete searchInput._debouncedSearchHandler;
    },

    handleDialogSearchInput: function (event, resultsContainerId) {
        const query = event.target.value.trim();
        if (query.length < 2) { AppUI.hideSearchResults(resultsContainerId); }
        else { if (event.target._debouncedSearchHandler) { event.target._debouncedSearchHandler(query, resultsContainerId); } }
    },

    handleDialogSearchKeypress: function (event, resultsContainerId) {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission if any
            const resultsContainer = document.getElementById(resultsContainerId);
            const firstResult = resultsContainer?.querySelector('.search-result-item:not(.no-results)');
            if (firstResult) { firstResult.click(); } // Simulate click on the first result
        }
    },

    handleDialogSearchBlur: function (event, resultsContainerId) {
        setTimeout(() => {
            const focusedElement = document.activeElement; const searchInput = event.target; const resultsContainer = document.getElementById(resultsContainerId); const dialog = searchInput.closest('.dialog');
            if (!dialog || !dialog.contains(focusedElement) || !focusedElement?.closest('.dialog-search-results, .dialog-search-bar')) { AppUI.hideSearchResults(resultsContainerId); }
        }, 200);
    },

    performDialogSearch: async function (query, resultsContainerId) {
        const resultsContainer = document.getElementById(resultsContainerId);
        if (!resultsContainer || query.length < 2) { this.hideSearchResults(resultsContainerId); return; }
        console.log(`[UI] Dialog search for '${query}' in ${resultsContainerId}`);
        resultsContainer.innerHTML = '<div class="search-result-item"><div class="spinner" style="width:18px; height:18px; border-width:2px; margin-right:8px;"></div>Searching...</div>';
        this.showSearchResults(resultsContainerId);
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=5`;
            const response = await fetch(url, { headers: { 'User-Agent': `FindMyWebApp/${AppConfig.APP_VERSION}` } });
            if (!response.ok) { throw new Error(`Nominatim search failed: ${response.status}`); }
            const nominatimData = await response.json();
            const results = nominatimData.map(loc => ({ type: 'location', query: loc.display_name, name: loc.display_name.split(',')[0], description: loc.display_name, icon: 'travel_explore', lat: parseFloat(loc.lat), lng: parseFloat(loc.lon) }));
            this.renderSearchResults(results, resultsContainerId);
        } catch (error) { console.error(`[UI] Dialog search error for '${query}':`, error); resultsContainer.innerHTML = `<div class="search-result-item no-results">Search failed: ${error.message}</div>`; }
    },

    // --- Import/Export UI Handlers (Modified) ---
    // This function now *only* updates the UI with the file name.
    // The processing logic is moved to AppActions.handleImportFileSelected.
    handleImportFileSelection: function (event) {
        console.log("[UI] Handling import file selection change (UI update only).");
        const fileInput = event.target;
        const selectedFileList = document.getElementById('selected-import-file-list');
        const confirmButton = document.getElementById('confirm-import-button');
        const partsSelection = document.getElementById('import-parts-selection');
        const statusMessage = document.getElementById('import-status-message');

        // Reset UI elements first
        if (selectedFileList) selectedFileList.textContent = '';
        if (partsSelection) partsSelection.style.display = 'none';
        if (confirmButton) confirmButton.style.display = 'none';
        if (statusMessage) statusMessage.textContent = '';

        if (fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            if (selectedFileList) selectedFileList.textContent = `Selected: ${file.name}`;
            // --- The actual processing is now triggered by the event listener in setupSettingsPage ---
            // --- which calls AppActions.handleImportFileSelected(file) ---
        } else {
            console.log("[UI] No file selected, resetting import dialog UI.");
            this.resetImportDialog(); // Reset fully if selection is cleared
        }
    },


    resetImportDialog: function () {
        console.log("[UI] Resetting import dialog.");
        // Target DIALOG elements
        const fileInput = document.getElementById('dialog-import-config-file-input');
        const selectedFileList = document.getElementById('dialog-selected-import-file-list');
        const confirmButton = document.getElementById('dialog-confirm-import-button');
        const partsSelection = document.getElementById('dialog-import-parts-selection');
        const statusMessage = document.getElementById('dialog-import-status-message');

        AppState.clearImportData(); // Clear stored data

        if (fileInput) fileInput.value = ''; // Clear file input
        if (selectedFileList) selectedFileList.textContent = '';
        if (statusMessage) statusMessage.textContent = '';
        if (partsSelection) {
            partsSelection.innerHTML = '<h4 class="settings-section-title">Select Parts to Import</h4>'; // Reset content
            partsSelection.style.display = 'none';
        }
        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.style.display = 'none'; // Hide confirm button initially
            confirmButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">save</span> Import Selected`; // Reset text
        }
    },

    handleDialogImportFileSelection: function (event) {
        console.log("[UI] Handling DIALOG import file selection change.");
        const fileInput = event.target; // Should be dialog-import-config-file-input
        const selectedFileList = document.getElementById('dialog-selected-import-file-list');
        // Reset other parts of dialog UI here if needed

        if (selectedFileList) selectedFileList.textContent = ''; // Clear previous selection display

        if (fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            if (selectedFileList) selectedFileList.textContent = `Selected: ${file.name}`;
            // Trigger the ACTION to process the file (this now happens in AppActions)
            AppActions.handleImportFileSelected(file); // Call ACTION function
        } else {
            console.log("[UI] No file selected in dialog, resetting dialog UI.");
            this.resetImportDialog(); // Reset fully if selection is cleared
        }
    },
};