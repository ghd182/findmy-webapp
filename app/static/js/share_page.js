// app/static/js/share_page.js

window.SharePage = {
    map: null,
    marker: null,
    shareId: null,
    fetchInterval: null,
    lastTimestamp: null,
    pollIntervalMs: 30 * 1000, // Poll every 30 seconds
    isInitialLoad: true,

    // --- UI Sub-object ---
    UI: {
        elements: {},
        cacheElements: function () {
            this.elements.overlay = document.getElementById('loading-overlay');
            this.elements.message = document.getElementById('loading-message');
            this.elements.spinner = this.elements.overlay?.querySelector('.spinner');
            this.elements.errorIcon = this.elements.overlay?.querySelector('.material-symbols-outlined'); // Cache error icon
            this.elements.title = document.getElementById('share-title');
            this.elements.infoCard = document.getElementById('info-card');
            this.elements.infoTitle = document.getElementById('info-card-title');
            this.elements.infoIcon = document.getElementById('info-card-icon');
            this.elements.infoTime = document.getElementById('info-card-time');
            this.elements.infoBattery = document.getElementById('info-card-battery');
            this.elements.infoBatteryIcon = document.getElementById('info-card-battery-icon');
            this.elements.infoNoteContainer = document.getElementById('info-card-note-container');
            this.elements.infoNote = document.getElementById('info-card-note');
            this.elements.zoomInBtn = document.getElementById('zoom-in'); // Cache new zoom buttons
            this.elements.zoomOutBtn = document.getElementById('zoom-out');
        },
        displayMessage: function (message, isError = false, showSpinner = !isError, iconName = 'cloud_off') {
            if (!this.elements.overlay || !this.elements.message) this.cacheElements();
            if (!this.elements.overlay || !this.elements.message) return;

            this.elements.overlay.classList.remove('hidden');
            this.elements.overlay.classList.toggle('error', isError); // Add error class to overlay
            if (this.elements.spinner) this.elements.spinner.style.display = showSpinner ? 'block' : 'none';
            if (this.elements.errorIcon) {
                this.elements.errorIcon.style.display = isError ? 'inline-block' : 'none';
                this.elements.errorIcon.textContent = iconName; // Set the icon
            }
            this.elements.message.innerHTML = message;
            this.elements.message.className = isError ? 'error-message' : '';
        },
        hideOverlay: function () {
            if (!this.elements.overlay) this.cacheElements();
            if (this.elements.overlay) this.elements.overlay.classList.add('hidden');
        },
        showInfoCard: function () {
            if (!this.elements.infoCard) this.cacheElements();
            if (this.elements.infoCard) this.elements.infoCard.classList.add('visible');
        },
        updateInfoCard: function (data) {
            if (!this.elements.infoCard) this.cacheElements();
            if (!this.elements.infoCard) return;

            const deviceName = data.device_name || "Shared Device";
            this.elements.title.textContent = `Location: ${deviceName}`;
            this.elements.infoTitle.textContent = deviceName;
            this.elements.infoIcon.textContent = 'devices'; // Or derive from data if possible

            let relativeTime = "Unknown time";
            if (data.timestamp) { try { relativeTime = SharePage.formatTimeRelative(new Date(data.timestamp)); } catch (e) { } }
            this.elements.infoTime.textContent = relativeTime;

            let batteryText = "Unknown"; let batteryIcon = 'battery_unknown';
            if (data.battery_level !== null) {
                batteryText = `${data.battery_level.toFixed(0)}%`; const level = data.battery_level;
                if (level > 95) batteryIcon = 'battery_full'; else if (level > 80) batteryIcon = 'battery_6_bar'; else if (level > 60) batteryIcon = 'battery_5_bar'; else if (level > 40) batteryIcon = 'battery_4_bar'; else if (level > 25) batteryIcon = 'battery_3_bar'; else if (level >= 15) batteryIcon = 'battery_alert'; else batteryIcon = 'battery_0_bar';
            } else if (data.battery_status && data.battery_status !== 'Unknown') { batteryText = data.battery_status; if (data.battery_status === 'Low' || data.battery_status === 'Very Low') batteryIcon = 'battery_alert'; }
            this.elements.infoBattery.textContent = batteryText;
            this.elements.infoBatteryIcon.textContent = batteryIcon;

            if (data.share_note && this.elements.infoNoteContainer && this.elements.infoNote) { this.elements.infoNote.textContent = `Note: ${data.share_note}`; this.elements.infoNoteContainer.style.display = 'block'; }
            else if (this.elements.infoNoteContainer) { this.elements.infoNoteContainer.style.display = 'none'; }
        },
        // Update Zoom Button Disabled State
        updateZoomButtons: function () {
            if (!SharePage.map || !this.elements.zoomInBtn || !this.elements.zoomOutBtn) return;
            this.elements.zoomInBtn.disabled = SharePage.map.getZoom() >= SharePage.map.getMaxZoom();
            this.elements.zoomOutBtn.disabled = SharePage.map.getZoom() <= SharePage.map.getMinZoom();
            this.elements.zoomInBtn.classList.toggle('disabled', this.elements.zoomInBtn.disabled);
            this.elements.zoomOutBtn.classList.toggle('disabled', this.elements.zoomOutBtn.disabled);
        }
    },

    // Helper to format relative time (copied from utils.js for isolation)
    formatTimeRelative: function (date) {
        // ... (keep the implementation from previous step) ...
        if (!date || !(date instanceof Date) || isNaN(date)) return "Unknown time";
        const now = new Date(); const deltaSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
        if (deltaSeconds < 0) return "Just now"; if (deltaSeconds < 5) return "Just now"; if (deltaSeconds < 60) return `${deltaSeconds} sec ago`;
        const deltaMinutes = Math.round(deltaSeconds / 60); if (deltaMinutes < 60) return `${deltaMinutes} min ago`;
        const deltaHours = Math.round(deltaMinutes / 60); if (deltaHours < 24) return `${deltaHours} hr ago`;
        const deltaDays = Math.round(deltaHours / 24); if (deltaDays === 1) return "Yesterday"; if (deltaDays < 7) return `${deltaDays} days ago`;
        try { return new Intl.DateTimeFormat(navigator.language || 'en-US', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
        catch (e) { return date.toLocaleDateString(); }
    },


    // --- START: Add escapeHtml and generateDeviceIconSVG helpers ---
    // Basic HTML escaping
    escapeHtml: function (unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, '"').replace(/'/g, "'");
    },

    // Generate SVG (copied and adapted from main app's utils.js)
    generateDeviceIconSVG: function (label, color, size = 36) {
        const sanitizedLabel = (label || '?'); let displayLabel = '?';
        try { const graphemes = [...sanitizedLabel]; displayLabel = graphemes.slice(0, 2).join("").toUpperCase(); }
        catch (e) {
            if (sanitizedLabel.length > 0) { if (sanitizedLabel.length >= 2 && 0xD800 <= sanitizedLabel.charCodeAt(0) && sanitizedLabel.charCodeAt(0) <= 0xDBFF) { displayLabel = sanitizedLabel.substring(0, 2).toUpperCase(); } else { displayLabel = sanitizedLabel.substring(0, 1).toUpperCase(); } }
        }
        // Basic color validation or use default grey
        const sanitizedColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#70757a';
        const border_width = Math.max(1, Math.round(size * 0.1));
        const inner_radius = Math.max(1, Math.round(size / 2) - border_width);
        const text_size = size * (displayLabel.length === 1 ? 0.50 : 0.40);
        let text_color = '#FFFFFF';
        try { const r = parseInt(sanitizedColor.substring(1, 3), 16); const g = parseInt(sanitizedColor.substring(3, 5), 16); const b = parseInt(sanitizedColor.substring(5, 7), 16); const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; if (lum > 0.55) { text_color = '#333333'; } }
        catch (e) { }
        const label_safe = this.escapeHtml(displayLabel);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${sanitizedColor}" /><circle cx="${size / 2}" cy="${size / 2}" r="${inner_radius}" fill="#FFFFFF" /><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="${text_size}px" font-weight="bold" fill="${text_color}">${label_safe}</text></svg>`;
    },
    // --- END: Add escapeHtml and generateDeviceIconSVG helpers ---


    // --- Modified createDeviceIcon ---
    createDeviceIcon: function (label, color) {
        const size = 36; // Match main app marker size
        // Generate the SVG using the helper
        const svgHtml = this.generateDeviceIconSVG(label, color, size);
        return L.divIcon({
            className: 'custom-marker-share', // Add specific class if needed
            html: svgHtml, // Use generated SVG
            iconSize: [size, size],
            iconAnchor: [size / 2, size], // Anchor bottom-center
            popupAnchor: [0, -size] // Popup above marker
        });
    },
    // --- End Modified createDeviceIcon ---





    // Fetch and update location data
    fetchAndUpdateLocation: async function () {
        if (!this.shareId) return;
        console.log(`[SharePage] Fetching location for share: ${this.shareId}`);
        if (!this.isInitialLoad) { this.UI.displayMessage("Updating location...", false, true); }

        try {
            // --- CHANGE API URL Here ---
            const apiUrl = `/public/api/shared/${this.shareId}`;
            // *** ------------------------ ***
            const response = await fetch(apiUrl);
            if (!response.ok) {
                let errorMsg = `Error ${response.status}`;
                let errorIcon = 'cloud_off'; // Default error icon
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.description || errorData.error || `${errorMsg}: ${response.statusText}`;
                    if (response.status === 404 || response.status === 410) errorIcon = 'link_off'; // Specific icon for invalid link
                } catch (e) { errorMsg = `${errorMsg}: ${response.statusText}`; }
                // Throw error with icon info if possible
                const error = new Error(errorMsg);
                error.icon = errorIcon; // Attach icon name to error
                error.status = response.status; // Attach status code
                throw error;
            }

            const data = await response.json();
            console.log("[SharePage] Received data:", data);

            if (!this.isInitialLoad && data.last_updated && this.lastTimestamp && data.last_updated <= this.lastTimestamp) { console.log("[SharePage] Data timestamp not newer."); this.UI.hideOverlay(); return; }
            this.lastTimestamp = data.last_updated;

            if (data.lat === null || data.lng === null) { this.UI.displayMessage("Device location is currently unavailable.", true, false, 'location_off'); if (this.UI.elements.infoCard) this.UI.elements.infoCard.classList.remove('visible'); return; }

            this.UI.updateInfoCard(data); this.UI.showInfoCard();

            const latLng = L.latLng(data.lat, data.lng);
            const deviceName = data.device_name || "Shared Device";
            const deviceLabel = data.device_label || "?";
            const deviceColor = data.device_color || "#70757a";

            // --- Updated Popup Content ---
            let popupContent = `<b><span class="marker-icon-popup">${this.generateDeviceIconSVG(deviceLabel, deviceColor, 20)}</span>${this.escapeHtml(deviceName)}</b><br>`;
            let timestampRelative = "Unknown time";
            if (data.timestamp) { try { timestampRelative = this.formatTimeRelative(new Date(data.timestamp)); popupContent += `<div><span class="material-symbols-outlined">schedule</span> ${timestampRelative}</div>`; } catch (e) { popupContent += `<div><span class="material-symbols-outlined">schedule</span> Invalid Time</div>`; } }
            // Add battery info
            if (data.battery_level !== null) { popupContent += `<div><span class="material-symbols-outlined">battery_std</span> ${data.battery_level.toFixed(0)}%${data.battery_status && data.battery_status !== 'Unknown' ? ` (${data.battery_status})` : ''}</div>`; }
            else if (data.battery_status && data.battery_status !== 'Unknown') { popupContent += `<div><span class="material-symbols-outlined">battery_unknown</span> ${data.battery_status}</div>`; }
            // Add coordinates and Google Maps link
            popupContent += `<div><span class="material-symbols-outlined">pin_drop</span> ${data.lat.toFixed(5)}°, ${data.lng.toFixed(5)}°</div>`;
            popupContent += `<div><span class="material-symbols-outlined">map</span> <a href="https://www.google.com/maps?q=${data.lat},${data.lng}" target="_blank" rel="noopener noreferrer">View on Google Maps</a></div>`;
            // Add note
            if (data.share_note) { popupContent += `<hr><small><span class="material-symbols-outlined">info</span><i>Notes: ${this.escapeHtml(data.share_note)}</i></small>`; }
            // --- End Updated Popup Content ---


            const newIcon = this.createDeviceIcon(deviceLabel, deviceColor);

            if (!this.marker) {
                this.marker = L.marker(latLng, { icon: newIcon }).addTo(this.map);
                this.marker.bindPopup(popupContent);
                this.map.setView(latLng, 16);
                console.log("[SharePage] Marker created and map centered.");
            } else {
                this.marker.setLatLng(latLng); this.marker.setIcon(newIcon); this.marker.setPopupContent(popupContent);
                if (this.isInitialLoad) { this.map.setView(latLng, 16); console.log("[SharePage] Marker updated and map centered (initial)."); }
                else if (!this.map.getBounds().contains(latLng)) { this.map.panTo(latLng); console.log("[SharePage] Marker updated and map panned."); }
                else { console.log("[SharePage] Marker updated (no pan needed)."); }
            }

            this.UI.hideOverlay(); this.isInitialLoad = false;

        } catch (error) {
            console.error("[SharePage] Error fetching shared location:", error);
            let displayError = `Could not load location: ${error.message}`;
            let errorIcon = error.icon || 'cloud_off'; // Get icon from error or use default
            if (error.status === 404 || error.status === 410) { displayError = "Link invalid, expired, or revoked."; this.stopPolling(); errorIcon = 'link_off'; }
            else if (error.status === 503) { displayError = "Location data temporarily unavailable."; errorIcon = 'sync_problem'; }
            else if (error.status === 500) { displayError = "Server error retrieving location."; errorIcon = 'dns'; } // Generic server error

            this.UI.displayMessage(displayError, true, false, errorIcon); // Show error, no spinner, pass icon
            if (this.UI.elements.infoCard) this.UI.elements.infoCard.classList.remove('visible');
        }
    },

    // Start polling for updates
    startPolling: function () {
        // ... (keep existing startPolling logic) ...
        if (this.fetchInterval) { console.log("[SharePage] Polling already active."); return; }
        if (!this.shareId) { console.error("[SharePage] Cannot start polling without shareId."); return; }
        console.log(`[SharePage] Starting polling every ${this.pollIntervalMs / 1000} seconds.`);
        this.fetchAndUpdateLocation(); // Fetch immediately first time
        this.fetchInterval = setInterval(() => { this.fetchAndUpdateLocation(); }, this.pollIntervalMs);
    },

    // Stop polling
    stopPolling: function () {
        // ... (keep existing stopPolling logic) ...
        if (this.fetchInterval) { console.log("[SharePage] Stopping polling."); clearInterval(this.fetchInterval); this.fetchInterval = null; }
    },

    // Initialize the map and start fetching
    initialize: function (shareId) {
        console.log("[SharePage] Initializing...");
        this.shareId = shareId;
        this.UI.cacheElements();

        if (!this.shareId) { this.UI.displayMessage("Invalid share link provided.", true, false, 'error'); return; }

        this.UI.displayMessage("Loading shared location...", false, true);

        try {
            this.map = L.map('share-map', {
                zoomControl: false, // Disable default
                attributionControl: true
            }).setView([0, 0], 3);

            // Add App-Style Zoom Controls Listeners
            const zoomInButton = document.getElementById('zoom-in');
            const zoomOutButton = document.getElementById('zoom-out');
            if (zoomInButton) zoomInButton.addEventListener('click', () => { this.map?.zoomIn(); });
            if (zoomOutButton) zoomOutButton.addEventListener('click', () => { this.map?.zoomOut(); });
            this.map.on('zoomend', () => this.UI.updateZoomButtons()); // Update state on zoom change

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>', maxZoom: 19,
            }).addTo(this.map);

            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                const tilePane = this.map.getPane('tilePane');
                if (tilePane) { tilePane.style.filter = 'invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)'; }
            }

            this.startPolling();
            this.UI.updateZoomButtons(); // Set initial button state

        } catch (error) {
            console.error("[SharePage] Map initialization error:", error);
            this.UI.displayMessage(`Map initialization failed: ${error.message}`, true, false, 'map');
        }
    }
};