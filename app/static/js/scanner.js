// app/static/js/scanner.js

window.Scanner = {
    // --- State (keep as before) ---
    isScanning: false,
    bluetoothSupported: false,
    permissionGranted: null,
    expectedKeys: new Map(),
    potentialMacs: new Map(),
    scanInstance: null,
    allDetectedDevices: new Map(),
    scanTimer: null,
    SCAN_DURATION_MS: 5 * 60 * 1000,
    expandedDetails: new Set(),

    // --- UI Elements ---
    elements: {},

    // --- Appearance Mapping ---
    appearanceMap: {
        0x0C41: "Tag",
    },

    // --- Initialization ---
    initScannerPage: function () {
        console.log("[Scanner] Initializing Scanner Page...");
        this.cacheElements();
        this.checkSupport();
        this.attachListeners();
        // --- Call resetUIForNewScan on initial page load ---
        this.resetUIForNewScan();
        // --- ------------------------------------------- ---
    },

    cacheElements: function () { /* ... keep existing ... */
        this.elements.status = document.getElementById('scanner-status');
        this.elements.startButton = document.getElementById('start-scan-button');
        this.elements.stopButton = document.getElementById('stop-scan-button');
        this.elements.resultsList = document.getElementById('scanner-results-list');
        this.elements.noSupportMessage = document.getElementById('scanner-no-support');
    },

    checkSupport: function () {
        if ('bluetooth' in navigator && typeof navigator.bluetooth.requestLEScan === 'function') {
            this.bluetoothSupported = true;
            console.log("[Scanner] Web Bluetooth Scanning API is supported.");
            if (this.elements.noSupportMessage) this.elements.noSupportMessage.style.display = 'none';
        } else {
            this.bluetoothSupported = false;
            console.warn("[Scanner] Web Bluetooth Scanning API NOT supported or not available in this context (HTTPS?).");
            if (this.elements.status) this.elements.status.textContent = 'Web Bluetooth Scanning Not Supported by this Browser/Platform (Requires Chrome/Edge on Android/Desktop, and HTTPS).';
            if (this.elements.startButton) this.elements.startButton.disabled = true;
            if (this.elements.noSupportMessage) this.elements.noSupportMessage.style.display = 'block';
        }
    },
    attachListeners: function () {
        const startButton = this.elements.startButton;
        const stopButton = this.elements.stopButton;
        const resultsList = this.elements.resultsList;

        // Ensure listeners are attached only once
        if (startButton && !startButton._scannerClickListener) {
            startButton._scannerClickListener = this.startScan.bind(this);
            startButton.addEventListener('click', startButton._scannerClickListener);
            console.log("[Scanner] Added start button listener.");
        }
        if (stopButton && !stopButton._scannerClickListener) {
            stopButton._scannerClickListener = this.stopScan.bind(this);
            stopButton.addEventListener('click', stopButton._scannerClickListener);
            console.log("[Scanner] Added stop button listener.");
        }
        if (resultsList && !resultsList._scannerClickListener) {
            resultsList._scannerClickListener = this.handleResultItemClick.bind(this);
            resultsList.addEventListener('click', resultsList._scannerClickListener);
            resultsList.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const toggle = e.target.closest('.scanner-details-toggle');
                    if (toggle) { e.preventDefault(); this.toggleDetails(toggle); }
                }
            });
            console.log("[Scanner] Added results list click/keypress listener for details toggle.");
        }
    },


    // --- RENAMED resetUI to resetUIForNewScan ---
    resetUIForNewScan: function () {
        // This function resets the UI for a *new* scan and clears data
        if (this.elements.status) this.elements.status.textContent = 'Idle. Press "Start Scan" to search for nearby Apple Find My signals.';
        if (this.elements.startButton) {
            this.elements.startButton.disabled = !this.bluetoothSupported;
            this.elements.startButton.style.display = 'inline-flex';
            this.elements.startButton.innerHTML = this.elements.startButton.dataset.originalHtml || `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">bluetooth_searching</span> Start Scan`;
        }
        if (this.elements.stopButton) this.elements.stopButton.style.display = 'none';

        // Clear data storage for the new scan
        this.allDetectedDevices.clear();
        this.expandedDetails.clear();

        // --- *** REMOVE this line that clears the display *** ---
        // if (this.elements.resultsList) {
        //     this.elements.resultsList.innerHTML = '<p class="no-devices-message">Scan results will appear here.</p>';
        // }
        // --- *********************************************** ---
        // renderScanResults will handle showing the initial empty message when called by startScan

        console.log("[Scanner] UI reset and detected devices CLEARED for new scan.");
    },
    // --- END RENAMED ---

    // --- NEW Helper: Reset only buttons and status ---
    _resetButtonsAndStatusOnly: function (statusMessage = "Idle.") {
        if (this.elements.status) this.elements.status.textContent = statusMessage;
        if (this.elements.startButton) {
            this.elements.startButton.disabled = !this.bluetoothSupported;
            this.elements.startButton.style.display = 'inline-flex';
            // Restore original button text if stored
            this.elements.startButton.innerHTML = this.elements.startButton.dataset.originalHtml || `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">bluetooth_searching</span> Start Scan`;
        }
        if (this.elements.stopButton) this.elements.stopButton.style.display = 'none';
        console.log("[Scanner] Buttons and status reset only.");
    },
    // --- END NEW Helper ---

    // --- Helper Functions (Keep _bufferToHex, _decodeMapOrSet, _interpretStatusByte) ---
    // --- Helper Functions ---
    _bufferToHex: function (buffer) {
        if (!buffer) return 'N/A';
        if (buffer instanceof DataView) { buffer = buffer.buffer; }
        else if (buffer instanceof Uint8Array) { buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); }
        if (!(buffer instanceof ArrayBuffer)) { console.warn("Invalid buffer type passed to _bufferToHex:", typeof buffer); return 'Invalid Buffer'; }
        return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
    },
    _decodeMapOrSet: function (mapOrSet) {
        if (!mapOrSet) return {};
        if (typeof mapOrSet !== 'object' || typeof mapOrSet.forEach !== 'function') {
            console.warn("[Scanner Decode] Input is not a valid Map or Set:", mapOrSet);
            if (typeof mapOrSet === 'object' && mapOrSet !== null) {
                const simpleDecoded = {};
                try {
                    for (const key in mapOrSet) {
                        if (Object.hasOwnProperty.call(mapOrSet, key)) {
                            const value = mapOrSet[key];
                            simpleDecoded[key] = value instanceof ArrayBuffer || value instanceof DataView || value instanceof Uint8Array
                                ? this._bufferToHex(value)
                                : (typeof value === 'object' ? JSON.stringify(value) : value);
                        }
                    }
                    console.warn("[Scanner Decode] Attempted simple object decode.");
                    return simpleDecoded;
                } catch (objError) { console.error("[Scanner Decode] Error during simple object decode fallback:", objError, mapOrSet); return {}; }
            }
            return {};
        }
        const decoded = {};
        try {
            mapOrSet.forEach((value, key) => {
                let decodedKey = key;
                if (typeof key === 'string' && key.length === 36 && key.includes('-')) { decodedKey = `UUID(${key})`; }
                else if (typeof key === 'string' && key.startsWith('0x')) { decodedKey = key; }
                else if (typeof key === 'number') { decodedKey = `0x${key.toString(16).padStart(4, '0')}`; }
                else if (key instanceof ArrayBuffer) { decodedKey = this._bufferToHex(key); }
                else if (key && key.uuid) { decodedKey = key.uuid; }
                let decodedValue = value;
                try {
                    if (value instanceof ArrayBuffer || value instanceof DataView || value instanceof Uint8Array) {
                        try { decodedValue = this._bufferToHex(value); }
                        catch (hexError) { console.error(`[Scanner Decode FOR_EACH] _bufferToHex FAILED for key ${decodedKey}:`, hexError, value); decodedValue = "[Hex Conversion Error]"; }
                    } else { decodedValue = value; }
                } catch (valueProcessingError) { console.error(`[Scanner Decode FOR_EACH] Error processing value for key ${decodedKey}:`, valueProcessingError, value); decodedValue = "[Value Processing Error]"; }
                decoded[decodedKey] = decodedValue;
            });
        } catch (e) { console.error("Error during _decodeMapOrSet forEach iteration:", e, mapOrSet); return {}; }
        return decoded;
    },
    _interpretStatusByte: function (statusByte) {
        if (statusByte === null || statusByte === undefined) return "N/A";
        const batteryBits = (statusByte >> 6) & 0b11;
        let batteryStatus = "Unknown";
        switch (batteryBits) {
            case 0b00: batteryStatus = "Full"; break;
            case 0b01: batteryStatus = "Medium"; break;
            case 0b10: batteryStatus = "Low"; break;
            case 0b11: batteryStatus = "Very Low"; break;
        }
        return `${batteryStatus} (Raw: 0x${statusByte.toString(16).padStart(2, '0')})`;
    },

    // --- Scanning Logic ---
    startScan: async function () {
        if (!this.bluetoothSupported || this.isScanning) return;
        console.log("[Scanner] Starting scan process (Iterative MAC Check)...");
        this.isScanning = true;

        // --- Call the FULL reset function when starting ---
        this.resetUIForNewScan();
        // --- ------------------------------------------ ---

        if (this.elements.startButton) {
            this.elements.startButton.disabled = true;
            if (!this.elements.startButton.dataset.originalHtml) { this.elements.startButton.dataset.originalHtml = this.elements.startButton.innerHTML; }
            this.elements.startButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 5px;"></div> Starting...`;
        }
        if (this.elements.stopButton) this.elements.stopButton.style.display = 'none';
        this.updateStatus('Fetching expected keys and potential MACs...');

        try {
            const data = await AppApi._fetch('/api/user/current_advertisement_keys');
            if (!data || !Array.isArray(data.keys_and_macs)) { throw new Error("Invalid key/MAC data received from server."); }
            const keysAndMacs = data.keys_and_macs;
            this.expectedKeys.clear(); this.potentialMacs.clear();
            keysAndMacs.forEach(item => {
                this.expectedKeys.set(item.adv_key_b64, { deviceId: item.device_id, name: item.name, keyType: item.key_type });
                if (item.potential_mac) {
                    if (!this.potentialMacs.has(item.potential_mac)) { this.potentialMacs.set(item.potential_mac, []); }
                    this.potentialMacs.get(item.potential_mac).push({ adv_key_b64: item.adv_key_b64, deviceId: item.device_id, name: item.name, keyType: item.key_type });
                }
            });
            console.log(`[Scanner] Fetched ${this.expectedKeys.size} potential keys and ${this.potentialMacs.size} potential MACs.`);
            if (this.expectedKeys.size === 0 && this.potentialMacs.size === 0) { this.updateStatus("No device keys/MACs found. Ensure devices are configured.", true); this.isScanning = false; this.resetUIForNewScan(); return; }

            this.updateStatus("Requesting Bluetooth scan permissions...");
            const options = { acceptAllAdvertisements: true };
            console.log("[Scanner] Requesting LE Scan with options:", JSON.stringify(options));
            this.scanInstance = await navigator.bluetooth.requestLEScan(options);
            console.log("[Scanner] LE Scan started successfully.");
            this.permissionGranted = true;
            this.updateStatus(`Scanning ALL Bluetooth devices for ${this.SCAN_DURATION_MS / 1000}s... Found OF Packets: 0 | Matched: 0`);
            if (this.elements.startButton) this.elements.startButton.style.display = 'none';
            if (this.elements.stopButton) this.elements.stopButton.style.display = 'inline-flex';
            navigator.bluetooth.removeEventListener('advertisementreceived', this.handleAdvertisement.bind(this));
            navigator.bluetooth.addEventListener('advertisementreceived', this.handleAdvertisement.bind(this));
            if (this.scanTimer) clearTimeout(this.scanTimer);
            this.scanTimer = setTimeout(() => { this.stopScan("Scan finished."); }, this.SCAN_DURATION_MS);

        } catch (error) {
            console.error("[Scanner] Error starting scan or fetching keys:", error);
            this.isScanning = false;
            this.permissionGranted = (error.name === 'NotFoundError' || error.name === 'NotAllowedError') ? 'denied' : null;
            let message = `Error: ${error.message}`;
            if (error.name === 'NotFoundError') message = "Bluetooth permission denied or no devices found. Ensure Bluetooth is ON.";
            if (error.name === 'NotAllowedError') message = "Bluetooth scanning permission denied by user.";
            if (error instanceof DOMException && error.message.includes("Bluetooth adapter not available")) message = "Bluetooth adapter not found or is turned off.";
            this.updateStatus(message, true);
            // --- Call full reset on start error ---
            this.resetUIForNewScan();
            // --- -------------------------------- ---
        }
    },

    // --- REVISED stopScan ---
    // --- REVISED stopScan with MORE LOGGING ---
    stopScan: function (completionMessage = "Scan stopped.") {
        console.log(`%c[Scanner] Entering stopScan. Message: "${completionMessage}"`, "color: orange; font-weight: bold;");
        console.log("[Scanner Stop] Current allDetectedDevices size:", this.allDetectedDevices.size);

        if (this.scanTimer) clearTimeout(this.scanTimer); this.scanTimer = null;

        navigator.bluetooth.removeEventListener('advertisementreceived', this.handleAdvertisement.bind(this));

        if (this.scanInstance && typeof this.scanInstance.stop === 'function') {
            try {
                this.scanInstance.stop();
                console.log("[Scanner Stop] Scan instance stop() method called.");
            }
            catch (e) { console.warn("[Scanner Stop] Error stopping scan instance:", e); }
        }
        this.scanInstance = null;
        this.isScanning = false;

        let matchedCount = 0; this.allDetectedDevices.forEach(d => { if (d.isMatched) matchedCount++; });
        const finalStatusMessage = completionMessage + ` Displaying ${this.allDetectedDevices.size} total Apple FindMy packets (${matchedCount} matched).`;

        console.log("[Scanner Stop] Calling _resetButtonsAndStatusOnly...");
        this._resetButtonsAndStatusOnly(finalStatusMessage); // Resets buttons/status BUT NOT list content

        console.log(`%c[Scanner Stop] BEFORE renderScanResults. List content:`, "color: yellow;", this.elements.resultsList.innerHTML.substring(0, 100) + "...");
        console.log("[Scanner Stop] Data to render:", this.allDetectedDevices);

        this.renderScanResults(); // Re-renders based on data *still in* allDetectedDevices

        console.log(`%c[Scanner Stop] AFTER renderScanResults. List content:`, "color: yellow;", this.elements.resultsList.innerHTML.substring(0, 100) + "...");
        console.log("[Scanner Stop] Exiting stopScan.");
    },

    // --- End REVISED stopScan ---

    updateStatus: function (message, isError = false) {
        if (this.elements.status) {
            this.elements.status.textContent = message;
            this.elements.status.style.color = isError ? 'var(--m3-sys-color-error)' : 'inherit';
        }
    },

    handleAdvertisement: function (event) {
        if (!this.isScanning || !event.device?.id) return;

        const browserDeviceId = event.device.id;
        const rssi = event.rssi ?? null;
        const timestamp = new Date();
        const appleData = event.manufacturerData?.get(0x004C);

        // Prepare data object
        const detectedDeviceData = {
            eventData: {
                deviceId: browserDeviceId, name: event.device?.name || null, rssi: rssi,
                txPower: event.txPower ?? null, appearance: event.appearance ?? null, uuids: event.uuids || [],
            },
            rawAppleDataHex: null, rawServiceDataHexMap: {}, ofPayloadHex: null,
            statusByte: null, statusInterpreted: null, appearanceInterpreted: null,
            reconstructedKeyB64: null, isMatched: false, matchedInfo: null, lastSeen: timestamp,
        };
        if (event.appearance !== null) {
            detectedDeviceData.appearanceInterpreted = this.appearanceMap[event.appearance] || `Unknown (0x${event.appearance.toString(16)})`;
        }
        // Safely attempt to decode serviceData
        try { detectedDeviceData.rawServiceDataHexMap = this._decodeMapOrSet(event.serviceData || new Map()); }
        catch (decodeError) { console.error(`[Scanner] Error decoding service data for ${browserDeviceId}:`, decodeError); }

        // Process Apple Manufacturer Data if present
        if (appleData && appleData.byteLength >= 2) {
            detectedDeviceData.rawAppleDataHex = this._bufferToHex(appleData);
            const dataView = new DataView(appleData.buffer);
            const type = dataView.getUint8(0);
            const length = dataView.getUint8(1);

            // Only process potential OF Separated packets
            if (type === 0x12 && length === 0x19 && appleData.byteLength >= 2 + 25) {
                const ofPayloadBytes = new Uint8Array(appleData.buffer, appleData.byteOffset + 2, 25);
                detectedDeviceData.statusByte = ofPayloadBytes[0];
                detectedDeviceData.ofPayloadHex = this._bufferToHex(ofPayloadBytes);
                detectedDeviceData.statusInterpreted = this._interpretStatusByte(detectedDeviceData.statusByte);

                console.log(`[Scanner Ad Process - OF Packet] BrowserID: ${browserDeviceId}, Status: ${detectedDeviceData.statusByte}, Payload(Hex): ${detectedDeviceData.ofPayloadHex}`);

                let matchFound = false;
                detectedDeviceData.isMatched = false; // Reset for this packet

                // --- Iterative MAC Reconstruction Attempt ---
                try {
                    if (this.potentialMacs.size > 0) {
                        console.log(`[Scanner Reconstruct Attempt] BrowserID: ${browserDeviceId} - Trying ${this.potentialMacs.size} potential MACs...`);
                        for (const [potentialMac, associatedKeys] of this.potentialMacs.entries()) {
                            if (matchFound) break;

                            const potentialMacBytes = potentialMac.split(':').map(hex => parseInt(hex, 16));
                            if (potentialMacBytes.length !== 6) continue;

                            const reconstructedKeyBytes = new Uint8Array(28);
                            const prefixByte = ofPayloadBytes[23];
                            reconstructedKeyBytes[0] = (prefixByte << 6) | (potentialMacBytes[0] & 0x3F);
                            for (let i = 0; i < 5; i++) reconstructedKeyBytes[i + 1] = potentialMacBytes[i + 1];
                            for (let i = 0; i < 22; i++) reconstructedKeyBytes[i + 6] = ofPayloadBytes[i + 1];

                            const binaryString = Array.from(reconstructedKeyBytes).map(byte => String.fromCharCode(byte)).join('');
                            const reconstructedKeyB64 = btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                            // console.log(`[Scanner Reconstruct Attempt] ---- MAC ${potentialMac} -> Key ${reconstructedKeyB64}`);

                            if (this.expectedKeys.has(reconstructedKeyB64)) {
                                const matchedDeviceDetails = this.expectedKeys.get(reconstructedKeyB64);
                                console.log(`%c[Scanner Reconstruct Attempt] +++ MATCH FOUND! +++\n  - Browser ID: ${browserDeviceId}\n  - Used Potential MAC: ${potentialMac}\n  - Reconstructed Key: ${reconstructedKeyB64}\n  - Matched Device: ${matchedDeviceDetails.deviceId} (${matchedDeviceDetails.name})`, "color: limegreen; font-weight: bold;");
                                detectedDeviceData.isMatched = true;
                                detectedDeviceData.matchedInfo = matchedDeviceDetails;
                                detectedDeviceData.reconstructedKeyB64 = reconstructedKeyB64;
                                matchFound = true;
                                break; // Found match for this packet
                            }
                        } // End MAC loop
                        if (!matchFound) {
                            console.log(`[Scanner Reconstruct Attempt] BrowserID: ${browserDeviceId} - No match found after trying all potential MACs.`);
                        }
                    } else {
                        console.log("[Scanner Reconstruct Attempt] No potential MACs loaded.");
                    }
                } catch (e) { console.error("[Scanner] Error during iterative reconstruction:", e, event); }
                // --- End Iterative Reconstruction ---

                // Store or update the entry for this OF packet
                this.allDetectedDevices.set(browserDeviceId, detectedDeviceData);
                this.renderScanResults(); // Update UI

                // Update status counter
                let totalMatched = 0; this.allDetectedDevices.forEach(d => { if (d.isMatched) totalMatched++; });
                this.updateStatus(`Scanning... Found OF Packets: ${this.allDetectedDevices.size} | Matched: ${totalMatched}`);
            }
        }
    }, // end handleAdvertisement

    // --- REVISED renderScanResults to show more details ---
    renderScanResults: function () {
        if (!this.elements.resultsList) {
            console.error("[Render] Results list element not found!");
            return;
        }
        console.log(`[Render] Rendering ${this.allDetectedDevices.size} devices. Expanded state:`, this.expandedDetails); // Log size and expansion state

        const listContainer = this.elements.resultsList;
        const resultsArray = Array.from(this.allDetectedDevices.entries());
        resultsArray.sort(([, a], [, b]) => b.lastSeen.getTime() - a.lastSeen.getTime());

        // --- Only clear if the list should genuinely be empty ---
        if (resultsArray.length === 0) {
            console.log("[Render] No devices to render, setting empty message.");
            listContainer.innerHTML = `<p class="no-devices-message">${this.isScanning ? 'Scanning for Apple Find My signals...' : 'No Find My packets detected during last scan.'}</p>`;
            return; // Exit early
        }
        // --- ---------------------------------------------------- ---

        const existingItems = new Map();
        listContainer.querySelectorAll('.scanner-result-item[data-browser-id]').forEach(el => {
            existingItems.set(el.dataset.browserId, el);
        });
        const currentRenderedIds = new Set();

        // If the container *looks* empty but shouldn't be, force clear (defensive)
        if (listContainer.children.length === 1 && listContainer.firstElementChild.classList.contains('no-devices-message')) {
            console.warn("[Render] List contained only 'no devices' message but data exists. Clearing before rendering.");
            listContainer.innerHTML = '';
        }

        resultsArray.forEach(([browserDeviceId, data]) => {
            currentRenderedIds.add(browserDeviceId);
            let item = existingItems.get(browserDeviceId);

            // Determine name, icon, RSSI etc. (as before)
            let displayName = data.matchedInfo?.name || data.eventData?.name || `Device (${browserDeviceId.substring(0, 8)}...)`;
            let iconHtml;
            if (data.isMatched && data.matchedInfo) {
                const displayInfo = AppState.getDeviceDisplayInfo(data.matchedInfo.deviceId);
                iconHtml = displayInfo.svg_icon || AppUtils.generateDeviceIconSVG(displayInfo.label, displayInfo.color);
                displayName = displayInfo.name;
            } else { iconHtml = `<span class="material-icons" style="font-size: 36px; color: var(--m3-sys-color-outline);">bluetooth</span>`; }
            const timeAgo = AppUtils.formatTimeRelative(data.lastSeen);
            const rssi = data.eventData?.rssi;
            let distanceIndicator = 'Unknown Range'; let rssiColor = 'var(--m3-sys-color-outline)';
            if (rssi !== null) {
                if (rssi > -65) { distanceIndicator = 'Very Near'; rssiColor = 'var(--m3-sys-color-primary)'; }
                else if (rssi > -75) { distanceIndicator = 'Near'; rssiColor = 'var(--m3-sys-color-secondary)'; }
                else if (rssi > -85) { distanceIndicator = 'Mid Range'; rssiColor = 'var(--m3-sys-color-tertiary)'; }
                else { distanceIndicator = 'Far'; rssiColor = 'var(--m3-sys-color-outline)'; }
            }
            const rssiText = rssi !== null ? `${rssi} dBm` : 'N/A';
            const isExpanded = this.expandedDetails.has(browserDeviceId);
            const serviceDataString = JSON.stringify(data.rawServiceDataHexMap || {}, null, 1).replace(/[{}" ]/g, '').replace(/,/g, '\n');

            // Build Details HTML
            const detailsHtml = `
                <div class="scanner-result-extra-details" style="display: ${isExpanded ? 'block' : 'none'};">
                    <hr style="margin: 8px 0;">
                    <div class="detail-row"><strong>Browser ID:</strong> ${browserDeviceId}</div>
                    <div class="detail-row"><strong>Adv Name:</strong> ${AppUtils.escapeHtml(data.eventData?.name) || 'N/A'}</div>
                    <div class="detail-row"><strong>Appearance:</strong> ${data.appearanceInterpreted || (data.eventData?.appearance ?? 'N/A')}</div>
                    <div class="detail-row"><strong>TX Power:</strong> ${data.eventData?.txPower ?? 'N/A'} dBm</div>
                    <div class="detail-row"><strong>UUIDs:</strong> ${data.eventData?.uuids.join(', ') || 'None'}</div>
                    <div class="detail-row"><strong>Apple Mfg Data (Hex):</strong> ${data.rawAppleDataHex || 'N/A'}</div>
                    <div class="detail-row"><strong>OF Payload (Hex):</strong> ${data.ofPayloadHex || 'N/A'}</div>
                    <div class="detail-row"><strong>Status Byte (Parsed):</strong> ${data.statusInterpreted || 'N/A'}</div>
                    <div class="detail-row"><strong>Reconstructed Key:</strong> ${data.reconstructedKeyB64 || 'N/A (Failed/Unavailable)'}</div>
                     ${data.isMatched ? `<div class="detail-row matched"><strong>Matched Device:</strong> ${AppUtils.escapeHtml(data.matchedInfo.name)} (${data.matchedInfo.deviceId}) - ${data.matchedInfo.keyType}</div>` : ''}
                     <div class="detail-row"><strong>Service Data (Hex):</strong> <pre>${serviceDataString || 'None'}</pre></div>
                </div>
            `;

            // --- Create or Update Element ---
            if (item) {
                // Update existing item content carefully
                item.classList.toggle('matched-device', data.isMatched);
                item.querySelector('.device-icon').innerHTML = iconHtml;
                item.querySelector('.scanner-result-name').innerHTML = `${AppUtils.escapeHtml(displayName)} ${data.isMatched ? '<span class="material-icons" style="font-size: 1em; color: var(--m3-sys-color-primary); vertical-align: middle;" title="Matched Owned Device">check_circle</span>' : ''}`;
                const timeSpan = item.querySelector('.scanner-result-details.device-status span.relative-time');
                if (timeSpan) { timeSpan.textContent = timeAgo; timeSpan.dataset.timestamp = data.lastSeen.toISOString(); }
                const statusTextElement = item.querySelector('.scanner-result-details.device-status');
                if (statusTextElement) statusTextElement.childNodes[0].nodeValue = `Status: ${data.statusByte ?? 'N/A'} | Seen: `; // Update status part
                const rssiElement = item.querySelector('.scanner-rssi');
                if (rssiElement) { rssiElement.style.color = rssiColor; rssiElement.title = `Signal Strength: ${rssiText}`; rssiElement.innerHTML = `${rssiText}<div style="font-size: 0.8em; opacity: 0.7;">${distanceIndicator}</div>`; }
                const detailsDiv = item.querySelector('.scanner-result-extra-details');
                if (detailsDiv) detailsDiv.innerHTML = detailsHtml.substring(detailsHtml.indexOf('<hr'), detailsHtml.lastIndexOf('</div>') + 6); // Update content inside
                const toggleButton = item.querySelector('.scanner-details-toggle');
                if (toggleButton) {
                    toggleButton.querySelector('.material-icons').textContent = isExpanded ? 'expand_less' : 'expand_more';
                    toggleButton.setAttribute('aria-expanded', isExpanded);
                    toggleButton.title = isExpanded ? 'Hide Details' : 'Show Details';
                }
                if (detailsDiv) detailsDiv.style.display = isExpanded ? 'block' : 'none';

            } else {
                // Create New Item
                item = document.createElement('div');
                item.className = 'scanner-result-item shared-device';
                item.classList.toggle('matched-device', data.isMatched);
                item.dataset.browserId = browserDeviceId;

                item.innerHTML = `
                    <div class="device-icon">${iconHtml}</div>
                    <div class="scanner-result-info device-info" title="Click row or arrow to toggle details">
                        <div class="scanner-result-name device-name">${AppUtils.escapeHtml(displayName)} ${data.isMatched ? '<span class="material-icons" style="font-size: 1em; color: var(--m3-sys-color-primary); vertical-align: middle;" title="Matched Owned Device">check_circle</span>' : ''}</div>
                        <div class="scanner-result-details device-status">
                            Status: ${data.statusByte ?? 'N/A'} | Seen: <span class="relative-time" data-timestamp="${data.lastSeen.toISOString()}">${timeAgo}</span>
                        </div>
                         <div class="scanner-result-details device-status" style="font-size: 0.75em; opacity: 0.6;" title="${browserDeviceId}">
                           Browser ID: ${browserDeviceId.substring(0, 8)}...
                        </div>
                    </div>
                    <div class="scanner-rssi" style="color: ${rssiColor}" title="Signal Strength: ${rssiText}">
                        ${rssiText}
                        <div style="font-size: 0.8em; opacity: 0.7;">${distanceIndicator}</div>
                    </div>
                    <button class="scanner-details-toggle text-button" title="${isExpanded ? 'Hide Details' : 'Show Details'}" aria-expanded="${isExpanded}">
                        <span class="material-icons">${isExpanded ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    ${detailsHtml}
                `;
                listContainer.appendChild(item);
            }
        });

        // Remove stale items (keep existing logic)
        existingItems.forEach((element, id) => {
            if (!currentRenderedIds.has(id)) { element.remove(); this.expandedDetails.delete(id); }
        });

        // Log after attempting render
        console.log(`[Render] Finished rendering. List children count: ${listContainer.children.length}`);

    }, // --- End Revised renderScanResults ---

    // --- Handle click on result item or toggle button ---
    handleResultItemClick: function (event) {
        const toggleButton = event.target.closest('.scanner-details-toggle');
        const itemElement = event.target.closest('.scanner-result-item');

        if (toggleButton) {
            event.stopPropagation();
            this.toggleDetails(toggleButton);
        } else if (itemElement) {
            // Allow clicking anywhere on the item to toggle details
            const buttonInside = itemElement.querySelector('.scanner-details-toggle');
            if (buttonInside) {
                this.toggleDetails(buttonInside);
            }
        }
    },
    toggleDetails: function (button) {
        const item = button.closest('.scanner-result-item');
        const details = item?.querySelector('.scanner-result-extra-details');
        const icon = button.querySelector('.material-icons');
        const browserId = item?.dataset.browserId;

        if (!details || !icon || !browserId) return;

        const isVisible = details.style.display === 'block';
        const newStateIsVisible = !isVisible;

        details.style.display = newStateIsVisible ? 'block' : 'none';
        icon.textContent = newStateIsVisible ? 'expand_less' : 'expand_more';
        button.setAttribute('aria-expanded', newStateIsVisible);
        button.title = newStateIsVisible ? 'Hide Details' : 'Show Details';

        // Update stored expansion state
        if (newStateIsVisible) { this.expandedDetails.add(browserId); }
        else { this.expandedDetails.delete(browserId); }
        console.log("[Scanner] Toggled details for", browserId, "Expanded:", this.expandedDetails);
    }
};

window.Scanner = Scanner; // Ensure it's globally accessible