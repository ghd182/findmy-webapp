// app/static/js/map.js
// FULL window.AppMap DEFINITION

window.AppMap = {
    // --- Leaflet Icon Definitions (Keep as before) ---
    userLocationIcon: L.divIcon({ className: 'current-location-marker', iconSize: [14, 14], iconAnchor: [7, 7] }),
    savedPlaceIcon: L.divIcon({ className: 'custom-marker saved-place-marker', html: '<span class="material-icons">star</span>', iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] }),
    searchIcon: L.divIcon({ className: 'custom-marker search-location-marker', html: '<span class="material-icons">search</span>', iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] }),
    geofenceCenterIcon: L.divIcon({ className: 'custom-marker search-location-marker', html: '<span class="material-icons">location_searching</span>', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18] }),
    placePickerIcon: L.divIcon({ className: 'custom-marker search-location-marker', html: '<span class="material-icons">add_location</span>', iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] }),

    getDeviceLeafletIcon: function (label, color, svg_icon_html) {
        const size = 36;
        if (svg_icon_html) {
            return L.divIcon({
                className: 'custom-marker shared-device-marker',
                html: svg_icon_html,
                iconSize: [size, size],
                iconAnchor: [size / 2, size],
                popupAnchor: [0, -size]
            });
        } else {
            const fallbackSvg = window.AppUtils
                ? AppUtils.generateDeviceIconSVG(label, color, size)
                : `<div style="width:${size}px; height:${size}px; border-radius:50%; background-color:${color || '#ccc'}; display:flex; align-items:center; justify-content:center; color:white; font-size:18px; font-weight:bold;">${(label || '?').substring(0, 1)}</div>`;
            console.warn(`SVG icon missing or AppUtils unavailable for device label ${label}, using JS fallback.`);
            return L.divIcon({
                className: 'custom-marker shared-device-marker fallback-icon',
                html: fallbackSvg,
                iconSize: [size, size],
                iconAnchor: [size / 2, size],
                popupAnchor: [0, -size]
            });
        }
    },

    getHistoryPointOptions: function (color, opacity = 0.5, radius = 5) {
        const defaultColor = window.AppUtils ? AppUtils.getDefaultColorForId("history") : '#888888';
        return {
            radius: radius, fillColor: color || defaultColor, color: "#FFFFFF",
            weight: 1, opacity: opacity, fillOpacity: opacity * 0.8,
            pane: AppConfig.LEAFLET_PANES.HISTORY_POINT.name
        };
    },

    getHistoryLineOptions: function (color, opacity = 0.3, weight = 1.5) {
        const defaultColor = window.AppUtils ? AppUtils.getDefaultColorForId("history_line") : '#aaaaaa';
        return {
            color: color || defaultColor, weight: weight, opacity: opacity,
            pane: AppConfig.LEAFLET_PANES.HISTORY_LINE.name
        };
    },

    // --- NEW/Updated Placeholder Helpers ---
    showMapPlaceholder: function (message = "Loading map...") {
        const placeholder = document.getElementById('map-placeholder');
        if (placeholder) {
            placeholder.innerHTML = `<div class="spinner"></div><p>${message}</p>`;
            placeholder.style.display = 'flex'; // Ensure it's displayed before adding class
            // Use a tiny delay before adding 'visible' to ensure the transition plays
            requestAnimationFrame(() => {
                requestAnimationFrame(() => { // Double RAF for belt-and-suspenders
                    placeholder.classList.add('visible');
                });
            });
        }
        console.log("[Map Placeholder] SHOW:", message);
    },

    hideMapPlaceholder: function () {
        const placeholder = document.getElementById('map-placeholder');
        if (placeholder) {
            placeholder.classList.remove('visible');
            // Optional: Set display: none after transition ends for performance,
            // but visibility:hidden usually suffices.
            // placeholder.addEventListener('transitionend', () => {
            //    if (!placeholder.classList.contains('visible')) {
            //        placeholder.style.display = 'none';
            //    }
            // }, { once: true });
        }
        console.log("[Map Placeholder] HIDE");
    },

    showMapErrorPlaceholder: function (message = "Could not load map.") {
        const placeholder = document.getElementById('map-placeholder');
        if (placeholder) {
            placeholder.innerHTML = `<span class="material-icons error">error_outline</span><p>${message}</p>`;
            placeholder.style.display = 'flex'; // Ensure display before class
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    placeholder.classList.add('visible');
                });
            });
        }
        console.error("[Map Placeholder] ERROR:", message);
    },
    // --- END: Placeholder Helpers ---


    // --- Initialization (Incorporating Fixes) ---
    initMap: function () {
        // --- *** ADD INITIALIZATION GUARD *** ---
        if (AppState.getMap()) {
            console.warn("Map already initialized (AppState.map exists). Skipping re-initialization.");
            return; // Exit if map object already exists in state
        }
        // --- ****************************** ---

        console.log("Initializing map...");
        const mapElement = document.getElementById('map');
        if (!mapElement) { this.showMapErrorPlaceholder("Map container element not found!"); return; }
        this.showMapPlaceholder("Initializing map...");
        AppState.mapReady = false;

        try {
            const mapInstance = L.map('map', { zoomControl: false, attributionControl: false }).setView([20, 0], 3);
            AppState.setMap(mapInstance);
            let initialLoadComplete = false;
            let loadTimeoutHandle = null;

            const onMapAndDataReady = () => {
                console.log("[Map Init] Map ready, data fetched. Updating view and hiding placeholder.");
                if (window.AppUI) AppUI.updateHistorySliderLabel();
                if (window.AppUI) AppUI.updateShowHistoryButtonState();
                if (window.AppUI) AppUI.updateShowAllButtonState();
                this.updateMapView();
                this.hideMapPlaceholder();
            };

            const setupMapElements = () => {
                if (loadTimeoutHandle) clearTimeout(loadTimeoutHandle);
                if (initialLoadComplete) return;
                initialLoadComplete = true;
                console.log("Map visually ready (load/timeout). Setting up layers & fetching data.");

                // --- Setup Panes ---
                Object.values(AppConfig.LEAFLET_PANES).forEach(paneConfig => {
                    // Skip default panes managed by Leaflet unless we need to override their zIndex explicitly
                    if (paneConfig.name !== 'mapPane' && // Default base map pane
                        paneConfig.name !== 'tilePane' && // Default tile pane
                        paneConfig.name !== 'overlayPane' && // Default overlay pane
                        paneConfig.name !== 'shadowPane' && // Default shadow pane
                        paneConfig.name !== 'markerPane' && // Default marker pane
                        paneConfig.name !== 'tooltipPane' && // Default tooltip pane
                        paneConfig.name !== 'popupPane') {

                        mapInstance.createPane(paneConfig.name);
                        const paneElement = mapInstance.getPane(paneConfig.name);
                        if (paneElement) {
                            paneElement.style.zIndex = paneConfig.zIndex;
                            // Make geofence and *both* accuracy panes non-interactive
                            if (paneConfig.name === AppConfig.LEAFLET_PANES.GEOFENCE.name ||
                                paneConfig.name === AppConfig.LEAFLET_PANES.HISTORY_ACCURACY.name || // Added
                                paneConfig.name === AppConfig.LEAFLET_PANES.USER_ACCURACY.name) {    // Added
                                paneElement.style.pointerEvents = 'none';
                            }
                        } else {
                            console.error(`Failed to create/get pane: ${paneConfig.name}`);
                        }
                    } else {
                        // Optionally ensure default panes have correct z-index if needed
                        const paneElement = mapInstance.getPane(paneConfig.name);
                        if (paneElement) paneElement.style.zIndex = paneConfig.zIndex;
                    }
                });
                console.log("Map panes created/configured.");
                // --- End Setup Panes Modification ---

                // --- SET MAP READY FLAG ---
                AppState.mapReady = true;
                console.log("AppState.mapReady set to true.");

                // --- Tile Layer, Controls, Layer Groups, Theme, Listeners ---
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance);
                L.control.attribution({ prefix: '...' }).addTo(mapInstance);
                AppState.geofenceLayerGroup = L.layerGroup([], { pane: AppConfig.LEAFLET_PANES.GEOFENCE.name }).addTo(mapInstance);
                this.updateMapThemeStyle(AppState.currentTheme === 'dark' || (AppState.currentTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
                document.getElementById('history-slider')?.addEventListener('input', this.handleHistorySliderChange.bind(this));

                // --- Attempt to add user marker NOW that map is ready ---
                if (AppState.locationMarker && this.shouldShowUserLocation()) {
                    console.log("User location marker exists, attempting addLayer immediately after map setup.");
                    if (!mapInstance.hasLayer(AppState.locationMarker)) {
                        try {
                            mapInstance.addLayer(AppState.locationMarker);
                            console.log("Added initial user location marker immediately after map setup.");
                        } catch (addLayerError) {
                            console.error("Error adding pre-existing user location marker immediately:", addLayerError);
                        }
                    }
                }

                // --- Render static markers ---
                this.renderSavedPlaceMarkers();

                // --- Fetch initial data, THEN update view and hide placeholder ---
                // Use AppActions if available, otherwise log error
                if (window.AppActions && typeof AppActions.fetchInitialData === 'function') {
                    AppActions.fetchInitialData().then(() => {
                        console.log("[Map Init] Initial data fetched (inside setupMapElements).");
                        onMapAndDataReady(); // Call final handler
                    }).catch(err => {
                        console.error("Error fetching initial data after map load:", err);
                        this.showMapErrorPlaceholder(`Data load failed: ${err.message}`);
                    });
                } else {
                    console.error("AppActions not available to fetch initial data!");
                    this.showMapErrorPlaceholder("Application Error: Cannot fetch data.");
                }
            }; // End setupMapElements

            mapInstance.once('load', () => {
                console.log("Map initial 'load' event fired.");
                setupMapElements();
            });

            loadTimeoutHandle = setTimeout(() => {
                if (!initialLoadComplete) {
                    console.warn("Map 'load' event timeout reached. Assuming map is ready enough.");
                    setupMapElements();
                }
            }, 8000);

            this.locateMeInitial();
            console.log("Map object created. Waiting for visual readiness...");

        } catch (error) {
            console.error("Error initializing map:", error);
            this.showMapErrorPlaceholder(`Map initialization failed: ${error.message}`);
            AppState.mapReady = false; // Ensure flag is false on error
            if (AppState.getMap()) { // Attempt cleanup if map object was partially created
                try { AppState.getMap().remove(); AppState.setMap(null); } catch (e) { }
            }
        }
    }, // End initMap

    updateMapThemeStyle: function (isDark) {
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;
        let tileLayer = null;
        mapInstance.eachLayer(layer => {
            if (layer instanceof L.TileLayer && layer._url && layer._url.includes('openstreetmap')) {
                tileLayer = layer;
            }
        });
        if (tileLayer && tileLayer.getContainer) {
            const container = tileLayer.getContainer();
            if (container) {
                container.style.filter = isDark ? 'invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)' : '';
            }
        } else {
            console.warn("Could not find OSM tile layer to apply theme filter.");
        }
    },

    invalidateMapSize: function () {
        const mapInstance = AppState.getMap();
        if (mapInstance) {
            console.log("[Map Resize] Invalidating map size...");
            // --- Show placeholder BEFORE invalidating ---
            this.showMapPlaceholder("Adjusting map layout...");

            // Use requestAnimationFrame for smoother integration with browser rendering
            requestAnimationFrame(() => {
                try {
                    mapInstance.invalidateSize({ animate: false }); // Invalidate immediately
                    console.log("[Map Resize] invalidateSize() called.");

                    // --- Hide placeholder AFTER a short delay ---
                    // This allows the browser time to reflow and render the resized map tiles
                    setTimeout(() => {
                        this.hideMapPlaceholder();
                        console.log("[Map Resize] Placeholder hidden after delay.");
                    }, 150); // Adjust delay as needed (e.g., 100-200ms)

                } catch (e) {
                    console.error("[Map Resize] Error during invalidateSize:", e);
                    // Ensure placeholder hides even if invalidateSize fails
                    this.hideMapPlaceholder();
                }
            });
        }
    },

    // --- Geolocation & User Location ---
    locateMeInitial: function (callback) {
        console.log("Attempting initial location...");
        if (!navigator.geolocation) {
            if (window.AppUI) AppUI.showErrorDialog("Geolocation Unavailable", "Your browser does not support geolocation.");
            else console.error("Geolocation Unavailable");
            if (callback) callback();
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this.initialPositionSuccess(pos); // Pass position object
                if (callback) callback();
            },
            (err) => {
                this.handleLocationError(err, "Initial location check failed.");
                if (callback) callback();
            },
            { timeout: 8000, enableHighAccuracy: false } // Options
        );
    },

    initialPositionSuccess: function (position) {
        console.log("Initial location success:", position.coords);
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy; // <<< Get accuracy
        this.updateUserLocationMarker(lat, lng, accuracy); // <<< Pass accuracy
        this.updateLocationInfo(lat, lng);
        this.reverseGeocode(lat, lng);
        // Don't call updateMapView here, let initMap handle it when ready
    },

    locateMe: function () {
        console.log("Attempting location update...");
        document.getElementById('location-address-text').textContent = "Fetching address...";
        document.getElementById('location-coordinates-text').textContent = "Fetching coordinates...";
        document.getElementById('last-updated-text').textContent = "Updating...";
        if (!navigator.geolocation) {
            if (window.AppUI) AppUI.showErrorDialog("Geolocation Unavailable");
            else console.error("Geolocation Unavailable");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            this.showPosition.bind(this), // Pass method reference
            (err) => this.handleLocationError(err, "Could not update location."), // Pass error handler
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // Options
        );
    },

    showPosition: function (position) {
        console.log("Location update success:", position.coords);
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy; // <<< Get accuracy
        this.updateUserLocationMarker(lat, lng, accuracy); // <<< Pass accuracy
        this.updateLocationInfo(lat, lng);
        this.reverseGeocode(lat, lng);
        this.updateMapView(); // Update map view after getting position
    },

    updateUserLocationMarker: function (lat, lng, accuracy) {
        const latLng = L.latLng(lat, lng);
        if (!AppState.locationMarker) {
            console.log("Creating user location marker object.");
            AppState.locationMarker = L.marker(latLng, {
                icon: this.userLocationIcon, zIndexOffset: 1000,
                pane: AppConfig.LEAFLET_PANES.USER.name
            });
        } else {
            AppState.locationMarker.setLatLng(latLng);
        }
        this.updateUserAccuracyCircle(latLng, accuracy); // Update the PERMANENT user circle
    },

    updateUserAccuracyCircle: function (latLng, accuracy) {
        const mapInstance = AppState.getMap();
        // Don't add/remove layer here, just manage the object
        // if (!mapInstance || !AppState.mapReady) return; // Keep guard

        // Hide/Remove if accuracy is invalid
        if (!accuracy || accuracy <= 0) {
            if (AppState.userAccuracyCircle && mapInstance?.hasLayer(AppState.userAccuracyCircle)) {
                mapInstance.removeLayer(AppState.userAccuracyCircle);
                console.log("[Map Accuracy] Removed USER accuracy circle (invalid accuracy).");
            }
            // Set to null so updateMapView knows it shouldn't be added
            AppState.userAccuracyCircle = null;
            return;
        }

        // Valid accuracy, create or update the object
        const circleOptions = {
            radius: accuracy,
            color: 'var(--m3-sys-color-primary)', weight: 1, opacity: 0.3,
            fillColor: 'var(--m3-sys-color-primary)', fillOpacity: 0.1,
            interactive: false, // Non-interactive
            pane: AppConfig.LEAFLET_PANES.USER_ACCURACY.name // Use dedicated non-interactive pane
        };

        if (!AppState.userAccuracyCircle) {
            console.log("[Map Accuracy] Creating USER accuracy circle object.");
            AppState.userAccuracyCircle = L.circle(latLng, circleOptions);
            // Store accuracy in options for potential future use
            AppState.userAccuracyCircle.options.accuracy = accuracy;
        } else {
            // console.log("[Map Accuracy] Updating existing USER accuracy circle object."); // Can be noisy
            AppState.userAccuracyCircle.setLatLng(latLng);
            AppState.userAccuracyCircle.setRadius(accuracy);
            AppState.userAccuracyCircle.setStyle(circleOptions); // Apply style updates
            AppState.userAccuracyCircle.options.accuracy = accuracy; // Update stored accuracy
        }
        // *** DO NOT ADD TO MAP HERE - updateMapView handles visibility ***
    },




    updateLocationInfo: function (lat, lng) {
        document.getElementById('location-coordinates-text').textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
        AppState.lastUpdateTime = new Date();
        document.getElementById('last-updated-text').textContent = `Last updated: ${window.AppUtils ? AppUtils.formatTimeRelative(AppState.lastUpdateTime) : 'just now'}`;
    },

    reverseGeocode: function (latitude, longitude) {
        const apiUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`;
        console.log("Fetching address for:", latitude.toFixed(5), longitude.toFixed(5));
        // Use AppConfig if available, otherwise default
        const appVersion = window.AppConfig?.APP_VERSION || '?.?.?';
        fetch(apiUrl, { headers: { 'User-Agent': `FindMyWebApp/${appVersion}` } })
            .then(res => {
                if (!res.ok) return res.text().then(text => { throw new Error(`Nominatim error! status: ${res.status}, response: ${text}`) });
                return res.json();
            })
            .then(data => {
                let addr = data?.display_name || "Address not found";
                document.getElementById('location-address-text').textContent = addr;
                // --- PASS ISO TIMESTAMP ---
                const now = AppState.lastUpdateTime || new Date();
                AppState.addToLocationHistory({
                    time: window.AppUtils ? AppUtils.formatTime(now) : now.toLocaleTimeString(),
                    timestampISO: now.toISOString(), // Add ISO string
                    location: "My Location",
                    address: addr,
                    lat: latitude,
                    lng: longitude
                });
                // --- -------------------- ---
            })
            .catch(err => {
                console.error("Reverse geocoding error:", err);
                document.getElementById('location-address-text').textContent = "Error fetching address";
                const now = AppState.lastUpdateTime || new Date();
                AppState.addToLocationHistory({
                    time: window.AppUtils ? AppUtils.formatTime(now) : now.toLocaleTimeString(),
                    timestampISO: now.toISOString(), // Add ISO string
                    location: "My Location",
                    address: "Error fetching address",
                    lat: latitude,
                    lng: longitude
                });
            });
    },

    handleLocationError: function (error, contextMessage = "Unable to retrieve your location.") {
        console.error("Geolocation Error:", error.code, error.message);
        let userMessage = contextMessage;
        switch (error.code) {
            case error.PERMISSION_DENIED: userMessage = "Location access denied by browser."; break;
            case error.POSITION_UNAVAILABLE: userMessage = "Location information is unavailable."; break;
            case error.TIMEOUT: userMessage = "Location request timed out."; break;
            default: userMessage = "An unknown error occurred getting location."; break;
        }
        if (window.AppUI) AppUI.showErrorDialog("Location Error", userMessage);
        else console.error("Location Error:", userMessage);

        document.getElementById('location-coordinates-text').textContent = "Location unavailable";
        document.getElementById('location-address-text').textContent = "Could not determine location";
        const lastUpdatedEl = document.getElementById('last-updated-text');
        if (lastUpdatedEl?.textContent.includes("Updating")) {
            lastUpdatedEl.textContent = "Update failed";
        }
    },

    shouldShowUserLocation: function () {
        // Show user location if not viewing a specific device AND no search result is active
        return !AppState.currentViewedDeviceId && !AppState.searchMarker;
    },

    // --- Map Markers & History ---
    updateDeviceMarker: function (deviceId) {

        const displayInfo = AppState.getDeviceDisplayInfo(deviceId);
        const latestReport = displayInfo.rawLocation;
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;

        if (!latestReport || latestReport.lat == null || latestReport.lon == null) {
            // If no location, remove marker
            if (AppState.deviceMarkers[deviceId]) {
                if (mapInstance.hasLayer(AppState.deviceMarkers[deviceId])) {
                    mapInstance.removeLayer(AppState.deviceMarkers[deviceId]);
                }
                // Ensure popup accuracy circle is also removed if this was the active one
                if (AppState.currentAccuracyCircle && AppState.currentAccuracyCircle._sourceMarkerId === deviceId) {
                    this._hidePopupAccuracyCircle();
                    // We don't store the accuracy circle on the marker anymore
                }
                delete AppState.deviceMarkers[deviceId];
            }
            return;
        }

        const markerLatLng = [latestReport.lat, latestReport.lon];
        const markerIcon = this.getDeviceLeafletIcon(displayInfo.label, displayInfo.color, displayInfo.svg_icon);
        const popupContent = this.generateHistoryPopupContent(latestReport, displayInfo);

        const markerOptions = {
            icon: markerIcon,
            zIndexOffset: 600,
            pane: AppConfig.LEAFLET_PANES.MARKERS.name,
            reportData: latestReport, // Store data for popup event
            deviceColor: displayInfo.color // Store color
        };

        if (AppState.deviceMarkers[deviceId]) {
            const existingMarker = AppState.deviceMarkers[deviceId];
            existingMarker.setLatLng(markerLatLng).setIcon(markerIcon).setPopupContent(popupContent);
            // Manually update data in options
            existingMarker.options.reportData = latestReport;
            existingMarker.options.deviceColor = displayInfo.color;

            // Re-attach listeners
            existingMarker.off('popupopen').off('popupclose');
            existingMarker.on('popupopen', (e) => { this._showPopupAccuracyCircle(e.target); });
            existingMarker.on('popupclose', (e) => { this._hidePopupAccuracyCircle(); });

        } else {
            AppState.deviceMarkers[deviceId] = L.marker(markerLatLng, markerOptions).bindPopup(popupContent);
            // Add event listeners to new marker
            AppState.deviceMarkers[deviceId].on('popupopen', (e) => { this._showPopupAccuracyCircle(e.target); });
            AppState.deviceMarkers[deviceId].on('popupclose', (e) => { this._hidePopupAccuracyCircle(); });

            if (mapInstance) { // Add immediately if map exists
                try { AppState.deviceMarkers[deviceId].addTo(mapInstance); }
                catch (e) { console.error(`Error adding NEW marker ${deviceId} to map:`, e); }
            }
        }
    },

    // --- History Trail Functions ---
    createOrUpdateDeviceHistoryLayer: function (deviceId) {
        const displayInfo = AppState.getDeviceDisplayInfo(deviceId);
        const reports = displayInfo.reports;
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;

        if (!reports || reports.length < 1) {
            this.clearDeviceHistoryLayer(deviceId);
            return;
        }

        if (!AppState.deviceHistoryLayers[deviceId]) {
            AppState.deviceHistoryLayers[deviceId] = L.layerGroup([]);
        } else {
            AppState.deviceHistoryLayers[deviceId].clearLayers();
        }

        const historyPointsLatLngs = [];
        const historyPoints = [];
        const now = Date.now();
        const filterCutoff = now - (AppState.historyTimeFilterHours * 60 * 60 * 1000);

        reports.forEach((report) => {
            if (report.lat != null && report.lon != null && report.timestamp) {
                try {
                    const reportTime = new Date(report.timestamp).getTime();
                    if (!isNaN(reportTime) && reportTime >= filterCutoff) {
                        const latLng = L.latLng(report.lat, report.lon);
                        historyPointsLatLngs.push(latLng);
                        const ageRatio = Math.max(0, (reportTime - filterCutoff)) / (now - filterCutoff || 1);
                        const opacity = 0.3 + ageRatio * 0.5;
                        const radius = this.getHistoryPointOptions().radius;

                        const pointMarker = L.circleMarker(latLng, {
                            ...this.getHistoryPointOptions(displayInfo.color, opacity, radius),
                            pane: AppConfig.LEAFLET_PANES.HISTORY_POINT.name,
                            reportData: report, // Store report data
                            deviceColor: displayInfo.color // Store device color
                        }).bindPopup(this.generateHistoryPopupContent(report, displayInfo));

                        // --- RE-ADD EVENT LISTENERS ---
                        pointMarker.on('popupopen', (e) => {
                            this._showPopupAccuracyCircle(e.target); // Use renamed function
                        });
                        pointMarker.on('popupclose', (e) => {
                            this._hidePopupAccuracyCircle(); // Use renamed function
                        });
                        // --- ------------------------ ---

                        historyPoints.push(pointMarker);
                    }
                } catch (e) {
                    console.warn(`Error processing report timestamp for history: ${report.timestamp}`, e);
                }
            }
        });

        // Add polyline
        if (historyPointsLatLngs.length > 1) {
            const line = L.polyline(historyPointsLatLngs, {
                ...this.getHistoryLineOptions(displayInfo.color),
                pane: AppConfig.LEAFLET_PANES.HISTORY_LINE.name
            });
            AppState.deviceHistoryLayers[deviceId].addLayer(line);
        }

        // Add point markers
        historyPoints.forEach(marker => AppState.deviceHistoryLayers[deviceId].addLayer(marker));
    },

    // --- Add NEW functions ---

    /**
     * Shows or updates the accuracy circle for a clicked history point.
     * @param {L.CircleMarker} marker - The history point marker that was clicked.
     */
    _showPopupAccuracyCircle: function (marker) {
        const reportData = marker.options.reportData;
        const deviceColor = marker.options.deviceColor;
        const accuracy = reportData?.horizontalAccuracy;
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;

        this._hidePopupAccuracyCircle(); // Hide previous one

        if (accuracy != null && accuracy > 0 && reportData.lat != null && reportData.lon != null) {
            const latLng = L.latLng(reportData.lat, reportData.lon);
            const circleOptions = {
                radius: accuracy, color: deviceColor || '#777', weight: 1, opacity: 0.5,
                fillColor: deviceColor || '#777', fillOpacity: 0.3,
                interactive: false,
                pane: AppConfig.LEAFLET_PANES.HISTORY_ACCURACY.name // Use this pane
            };

            // Create or update the *single* currentAccuracyCircle
            if (!AppState.currentAccuracyCircle) {
                console.log("[Map Accuracy] Creating new POPUP accuracy circle.");
                AppState.currentAccuracyCircle = L.circle(latLng, circleOptions);
            } else {
                console.log("[Map Accuracy] Updating existing POPUP accuracy circle.");
                AppState.currentAccuracyCircle.setLatLng(latLng);
                AppState.currentAccuracyCircle.setRadius(accuracy);
                AppState.currentAccuracyCircle.setStyle({ color: circleOptions.color, fillColor: circleOptions.fillColor });
            }

            if (!mapInstance.hasLayer(AppState.currentAccuracyCircle)) {
                AppState.currentAccuracyCircle.addTo(mapInstance);
                console.log("[Map Accuracy] Added POPUP circle to map.");
            }
        } else {
            console.log("[Map Accuracy] No valid accuracy data for this point.");
        }
    },

    /**
     * Hides the currently displayed accuracy circle.
     */
    _hidePopupAccuracyCircle: function () {
        const mapInstance = AppState.getMap();
        if (AppState.currentAccuracyCircle && mapInstance) {
            if (mapInstance.hasLayer(AppState.currentAccuracyCircle)) {
                mapInstance.removeLayer(AppState.currentAccuracyCircle);
                console.log("[Map Accuracy] Removed POPUP accuracy circle from map.");
            }
        }
    },

    rebuildAllHistoryLayers: function () {
        // console.log("Rebuilding all history layers..."); // Can be noisy
        AppState.getCurrentDeviceData().forEach(device => this.createOrUpdateDeviceHistoryLayer(device.id));
        this.updateHistoryLayersVisibility(); // Update visibility after rebuilding
    },

    updateSingleHistoryLayerVisibility: function (deviceId) {
        const layer = AppState.deviceHistoryLayers[deviceId];
        const mapInstance = AppState.getMap();
        if (!layer || !mapInstance) return;

        const displayInfo = AppState.getDeviceDisplayInfo(deviceId);
        // Determine if history for this specific device should be shown
        const shouldShowHistory = AppState.showDeviceHistory && // Global toggle must be on
            displayInfo.isVisible && // Device must be visible
            (AppState.isShowingAllDevices || AppState.currentViewedDeviceId === deviceId); // AND (showing all OR viewing this specific device)

        if (shouldShowHistory) {
            if (!mapInstance.hasLayer(layer)) {
                layer.addTo(mapInstance); // Add layer group to map
            }
        } else {
            if (mapInstance.hasLayer(layer)) {
                mapInstance.removeLayer(layer); // Remove layer group from map
            }
        }
    },

    updateHistoryLayersVisibility: function () {
        // console.log("Updating visibility for all history layers..."); // Can be noisy
        // Iterate through all devices that might have a history layer
        Object.keys(AppState.deviceHistoryLayers).forEach(deviceId => this.updateSingleHistoryLayerVisibility(deviceId));
    },

    clearDeviceHistoryLayer: function (deviceId) {
        const mapInstance = AppState.getMap();
        if (AppState.deviceHistoryLayers[deviceId]) {
            if (mapInstance && mapInstance.hasLayer(AppState.deviceHistoryLayers[deviceId])) {
                mapInstance.removeLayer(AppState.deviceHistoryLayers[deviceId]);
            }
            delete AppState.deviceHistoryLayers[deviceId]; // Remove from state
        }
    },

    clearAllDeviceHistoryLayers: function () {
        Object.keys(AppState.deviceHistoryLayers).forEach(id => this.clearDeviceHistoryLayer(id));
        console.log("Cleared all device history layers.");
    },

    handleHistorySliderChange: function (event) { // Event listener callback
        const hours = parseInt(event.target.value, 10);
        if (isNaN(hours)) return;
        AppState.historyTimeFilterHours = hours; // Update state
        if (window.AppUI) AppUI.updateHistorySliderLabel(); // Update UI label
        AppState.saveMapToggles(); // Save the setting to localStorage

        if (AppState.showDeviceHistory) { // Only rebuild if history is currently visible
            console.log("History slider changed, rebuilding visible history layers...");
            this.rebuildAllHistoryLayers(); // Rebuild layers based on new time filter
        }
    },
    // --- End History Trail Functions ---

    updateAllDeviceMarkers: function () {
        // console.log("Updating all device markers..."); // Can be noisy
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;
        const currentDeviceData = AppState.getCurrentDeviceData(); // Get fresh data

        // Update or create markers for current devices
        currentDeviceData.forEach(device => this.updateDeviceMarker(device.id));

        // Remove markers for devices that are no longer in the current data
        Object.keys(AppState.deviceMarkers).forEach(existingMarkerId => {
            if (!currentDeviceData.some(d => d.id === existingMarkerId)) {
                if (mapInstance.hasLayer(AppState.deviceMarkers[existingMarkerId])) {
                    mapInstance.removeLayer(AppState.deviceMarkers[existingMarkerId]);
                }
                delete AppState.deviceMarkers[existingMarkerId]; // Remove from state
                console.log(`Removed stale marker for ${existingMarkerId}`);
            }
        });
        // Visibility of markers is handled by updateMapView
    },

    generateHistoryPopupContent: function (report, displayInfo) {
        if (!report) return "No data available for this point.";

        // --- Get Date objects ---
        const markerTime = report.timestamp ? new Date(report.timestamp.replace("Z", "+00:00")) : null;
        const publishedTime = report.published_at ? new Date(report.published_at.replace("Z", "+00:00")) : null;

        // --- Get ISO strings (for title attribute) ---
        const markerTimestampISO = markerTime && !isNaN(markerTime) ? markerTime.toISOString() : '';
        const publishedTimestampISO = publishedTime && !isNaN(publishedTime) ? publishedTime.toISOString() : '';

        // --- Calculate BOTH Absolute and Relative times using AppUtils ---
        let markerTimeAbsolute = "N/A";
        let markerTimeRelative = "N/A";
        if (markerTime && !isNaN(markerTime)) {
            markerTimeAbsolute = AppUtils.formatTime(markerTime); // e.g., "12/04/2025 16:38"
            markerTimeRelative = AppUtils.formatTimeRelative(markerTime); // e.g., "5 min ago"
        }

        let publishedTimeAbsolute = "N/A";
        let publishedTimeRelative = "N/A";
        if (publishedTime && !isNaN(publishedTime)) {
            publishedTimeAbsolute = AppUtils.formatTime(publishedTime);
            publishedTimeRelative = AppUtils.formatTimeRelative(publishedTime);
        }
        // --- END Time Calculation ---

        const lat = report.lat; const lon = report.lon;
        const googleMapsLink = (lat != null && lon != null) ? `https://www.google.com/maps?q=${lat},${lon}` : '#';

        // Use the utility function for battery parsing
        const [mappedBattPercent, batteryStatusStr] = AppUtils._parseBatteryInfo(
            report.battery,
            report.status,
            AppConfig.LOW_BATTERY_THRESHOLD
        );

        let batteryPercentStr = 'N/A';
        if (mappedBattPercent !== null) { batteryPercentStr = `${mappedBattPercent.toFixed(0)}%`; }
        else if (batteryStatusStr !== 'Unknown') { batteryPercentStr = batteryStatusStr; }

        const icon = (name) => `<span class="material-symbols-outlined">${name}</span>`;
        const smallSvgIconHtml = AppUtils.generateDeviceIconSVG(displayInfo.label, displayInfo.color, 20);
        const labelHtml = `<span style="display:inline-block; width:20px; height:20px; vertical-align:middle; margin-right: 5px;">${smallSvgIconHtml}</span>`;

        let content = `<div style="font-size: var(--body-small-size); max-width: 280px;"><table class="history-popup-table">`;
        content += `<tr><td>${icon('sell')}</td><td colspan="2" style="font-weight: bold;">${labelHtml}${displayInfo.name}</td></tr>`;
        
        content += `<tr><td>${icon('schedule')}</td><td>Located:</td><td><span class="relative-time" data-timestamp="${markerTimestampISO}" title="${markerTimestampISO}">${markerTimeAbsolute} (${markerTimeRelative})</span></td></tr>`;
        // Show 'Reported' only if different from 'Located' time
        if (publishedTime && markerTime && Math.abs(publishedTime.getTime() - markerTime.getTime()) > 1000) { // Check if more than 1s difference
            content += `<tr><td>${icon('publish')}</td><td>Reported:</td><td><span class="relative-time" data-timestamp="${publishedTimestampISO}" title="${publishedTimestampISO}">${publishedTimeAbsolute} (${publishedTimeRelative})</span></td></tr>`;
        }

        content += `<tr><td>${icon('location_on')}</td><td>Coords:</td><td><a href="${googleMapsLink}" target="_blank">${lat != null ? `${lat.toFixed(5)}°, ${lon.toFixed(5)}°` : 'N/A'}</a></td></tr>`;
        content += `<tr><td>${icon('battery_std')}</td><td>Battery:</td><td>${batteryPercentStr}${report.status !== null ? ` <small>(S:${report.status})</small>` : ''}</td></tr>`;
        content += `<tr><td>${icon('my_location')}</td><td>Accuracy:</td><td>${report.horizontalAccuracy != null ? `±${report.horizontalAccuracy.toFixed(0)}m` : 'N/A'}</td></tr>`;
        if (report.altitude != null) { content += `<tr><td>${icon('height')}</td><td>Altitude:</td><td>${report.altitude.toFixed(0)}m ${report.verticalAccuracy != null ? `(±${report.verticalAccuracy.toFixed(0)}m)` : ''}</td></tr>`; }
        if (report.description) { content += `<tr><td>${icon('info')}</td><td>Desc:</td><td>${AppUtils.escapeHtml(report.description)}</td></tr>`; } // Added escapeHtml
        if (report.confidence != null) { content += `<tr><td>${icon('verified')}</td><td>Confidence:</td><td>${report.confidence}</td></tr>`; }
        content += `</table></div>`;
        return content;
    },

    // --- Saved Places ---
    renderSavedPlaceMarkers: function () {
        // console.log("Rendering saved place markers..."); // Can be noisy
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;
        const savedPlaces = AppState.savedPlaces;

        // Remove markers that no longer exist in savedPlaces
        AppState.savedPlaceMarkers = AppState.savedPlaceMarkers.filter(marker => {
            const markerLL = marker.getLatLng();
            const stillExists = savedPlaces.some(p => p.lat === markerLL.lat && p.lng === markerLL.lng);
            if (!stillExists && mapInstance.hasLayer(marker)) {
                mapInstance.removeLayer(marker); // Remove from map if deleted
            }
            return stillExists; // Keep in the array only if it still exists
        });

        // Add markers for places that don't have one yet
        savedPlaces.forEach(p => {
            if (p.lat != null && p.lng != null) {
                // Check if a marker for this exact place already exists in our array
                const markerExists = AppState.savedPlaceMarkers.some(m => {
                    const ll = m.getLatLng();
                    return ll.lat === p.lat && ll.lng === p.lng;
                });

                if (!markerExists) {
                    const m = L.marker([p.lat, p.lng], {
                        icon: this.savedPlaceIcon,
                        zIndexOffset: 550, // z-index
                        pane: AppConfig.LEAFLET_PANES.SAVED_PLACES.name // Assign pane
                    }).bindPopup(`<b>${p.name}</b><br>${p.description || 'Saved Place'}`);
                    AppState.savedPlaceMarkers.push(m); // Add new marker to our array
                    // Adding to map is handled by updateMapView
                }
            }
        });
        // Visibility (adding/removing from map) is handled by updateMapView
    },

    clearSavedPlaceMarkersFromDisplay: function () {
        const mapInstance = AppState.getMap();
        if (!mapInstance) return;
        AppState.savedPlaceMarkers.forEach(m => {
            if (mapInstance.hasLayer(m)) mapInstance.removeLayer(m);
        });
        console.log("Cleared saved place markers from map display.");
        // Note: This only removes them from view, doesn't delete from AppState.savedPlaceMarkers array
    },

    // --- Search ---
    searchLocation: function () {
        console.warn("AppMap.searchLocation called, but global search should handle this now via AppActions.performSearch.");
        // This function can potentially be removed if not used elsewhere.
    },

    geocodeAddress: function (address, focusInput = true) {
        console.log(`Geocoding address: "${address}"`);
        AppState.currentViewedDeviceId = null; // Stop viewing specific device
        if (window.AppUI) AppUI.changePage('index'); // Switch to map page
        this.clearSearchMarker(); // Remove previous search marker

        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`;
        // Use AppConfig if available, otherwise default
        const appVersion = window.AppConfig?.APP_VERSION || '?.?.?';
        fetch(url, { headers: { 'User-Agent': `FindMyWebApp/${appVersion}` } })
            .then(res => {
                if (!res.ok) return res.text().then(text => { throw new Error(`Nominatim error ${res.status}: ${text}`) });
                return res.json();
            })
            .then(data => {
                if (data?.length > 0) {
                    const result = data[0];
                    const lat = parseFloat(result.lat);
                    const lng = parseFloat(result.lon);
                    console.log("Geocode result:", result.display_name, lat, lng);

                    // Update search bar text if requested
                    if (focusInput) {
                        const searchInput = document.getElementById('location-search-input');
                        if (searchInput) searchInput.value = result.display_name; // Display full result name
                    }

                    // Add marker and update map view
                    this.addSearchMarker(lat, lng, result.display_name);
                    this.updateMapView(); // Focus on the search result
                } else {
                    console.warn("Location not found:", address);
                    if (window.AppUI) AppUI.showErrorDialog("Search Result", `Could not find location for "${address}".`);
                }
            })
            .catch(err => {
                console.error("Geocoding error:", err);
                if (window.AppUI) AppUI.showErrorDialog("Search Error", "An error occurred while searching.");
            });
    },

    addSearchMarker: function (lat, lng, address) {
        // Create the marker object and store it in state
        AppState.searchMarker = L.marker([lat, lng], {
            icon: this.searchIcon,
            zIndexOffset: 900, // High z-index
            pane: AppConfig.LEAFLET_PANES.SEARCH.name // Assign search pane
        }).bindPopup(`<b>Search Result:</b><br>${address}`);
        // Visibility (adding/removing from map) is handled by updateMapView
    },

    clearSearchMarker: function () {
        if (AppState.searchMarker) {
            const mapInstance = AppState.getMap();
            if (mapInstance && mapInstance.hasLayer(AppState.searchMarker)) {
                mapInstance.removeLayer(AppState.searchMarker);
            }
            AppState.searchMarker = null; // Clear from state
        }
    },

    clearSearchMarkerAndFocus: function () {
        // Wrapper function for convenience, e.g., called when search bar is cleared
        if (AppState.searchMarker) {
            this.clearSearchMarker();
            this.updateMapView(); // Refocus map based on remaining elements
        }
    },

    // --- Map View Update ---
    updateMapView: function () {
        if (!AppState.mapReady) {
            console.warn("updateMapView called before map is ready. Skipping.");
            return;
        }
        const mapInstance = AppState.getMap();
        if (!mapInstance) { console.error("updateMapView called but map instance is null."); return; }

        let bounds = L.latLngBounds();
        let activeElements = [];

        // Updates (Markers, History Layers etc.)
        this.updateAllDeviceMarkers();
        this.renderSavedPlaceMarkers();
        this.rebuildAllHistoryLayers();
        this.redrawGeofenceLayer();

        // Add/Remove Layers
        const showUser = this.shouldShowUserLocation();

        // --- User Marker AND User Accuracy Circle Visibility ---
        if (showUser && AppState.locationMarker && (AppState.locationMarker.getLatLng().lat !== 0 || AppState.locationMarker.getLatLng().lng !== 0)) {
            // Add User Marker
            if (!mapInstance.hasLayer(AppState.locationMarker)) {
                mapInstance.addLayer(AppState.locationMarker);
            }
            bounds.extend(AppState.locationMarker.getLatLng());
            activeElements.push(AppState.locationMarker);

            // Add User Accuracy Circle (if it exists and has valid accuracy)
            if (AppState.userAccuracyCircle && AppState.userAccuracyCircle.options.accuracy > 0) {
                if (!mapInstance.hasLayer(AppState.userAccuracyCircle)) {
                    mapInstance.addLayer(AppState.userAccuracyCircle);
                    // console.log("[Map View] Added USER accuracy circle."); // Can be noisy
                }
                // Optionally extend bounds by accuracy? Might make zoom too wide.
                // bounds.extend(AppState.userAccuracyCircle.getBounds());
            } else {
                // Ensure circle is removed if accuracy became invalid but marker is still shown
                if (AppState.userAccuracyCircle && mapInstance.hasLayer(AppState.userAccuracyCircle)) {
                    mapInstance.removeLayer(AppState.userAccuracyCircle);
                    // console.log("[Map View] Removed USER accuracy circle (accuracy invalid)."); // Can be noisy
                }
            }
        } else {
            // Remove User Marker
            if (AppState.locationMarker && mapInstance.hasLayer(AppState.locationMarker)) {
                mapInstance.removeLayer(AppState.locationMarker);
            }
            // Remove User Accuracy Circle
            if (AppState.userAccuracyCircle && mapInstance.hasLayer(AppState.userAccuracyCircle)) {
                mapInstance.removeLayer(AppState.userAccuracyCircle);
                // console.log("[Map View] Removed USER accuracy circle (user hidden)."); // Can be noisy
            }
        }
        // --- End User Marker & Accuracy ---

        // Device Markers (No accuracy logic needed here anymore)
        Object.keys(AppState.deviceMarkers).forEach(deviceId => {
            const marker = AppState.deviceMarkers[deviceId];
            const displayInfo = AppState.getDeviceDisplayInfo(deviceId);
            const shouldShowDeviceMarker = displayInfo.isVisible && (AppState.isShowingAllDevices || AppState.currentViewedDeviceId === deviceId);
            if (marker) {
                if (shouldShowDeviceMarker) {
                    if (!mapInstance.hasLayer(marker)) mapInstance.addLayer(marker);
                    bounds.extend(marker.getLatLng());
                    activeElements.push(marker);
                } else {
                    if (mapInstance.hasLayer(marker)) mapInstance.removeLayer(marker);
                    // If marker is hidden, ensure its popup accuracy circle is also hidden
                    if (AppState.currentAccuracyCircle && AppState.currentAccuracyCircle._sourceMarkerId === deviceId) {
                        this._hidePopupAccuracyCircle();
                    }
                }
            }
        });

        // History Layer Visibility (handled by rebuildAllHistoryLayers -> updateHistoryLayersVisibility)

        // Saved Place Markers (Unchanged)
        AppState.savedPlaceMarkers.forEach(marker => {
            if (AppState.isShowingAllDevices) {
                if (!mapInstance.hasLayer(marker)) mapInstance.addLayer(marker);
                bounds.extend(marker.getLatLng());
                activeElements.push(marker);
            } else {
                if (mapInstance.hasLayer(marker)) mapInstance.removeLayer(marker);
            }
        });

        // Search Marker
        if (AppState.searchMarker) {
            const shouldShowSearch = !AppState.isShowingAllDevices && !AppState.currentViewedDeviceId;
            if (shouldShowSearch) {
                if (!mapInstance.hasLayer(AppState.searchMarker)) {
                    try { mapInstance.addLayer(AppState.searchMarker); }
                    catch (e) { console.error("Error adding search marker:", e); }
                }
                if (mapInstance.hasLayer(AppState.searchMarker)) {
                    bounds.extend(AppState.searchMarker.getLatLng());
                    activeElements.push(AppState.searchMarker);
                }
            } else {
                if (mapInstance.hasLayer(AppState.searchMarker)) mapInstance.removeLayer(AppState.searchMarker);
            }
        }

        // --- Fit Bounds or Set View (Keep existing logic) ---
        if (activeElements.length > 0 && bounds.isValid()) {
            if (activeElements.length === 1) {
                const singleElement = activeElements[0];
                let zoomLevel = 16;
                if (singleElement === AppState.searchMarker) zoomLevel = 15;
                else if (singleElement === AppState.locationMarker) { zoomLevel = Math.max(mapInstance.getZoom(), 15); }
                mapInstance.setView(singleElement.getLatLng(), zoomLevel);
            } else {
                mapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
            }
        } else if (showUser && AppState.locationMarker && mapInstance.hasLayer(AppState.locationMarker)) {
            mapInstance.setView(AppState.locationMarker.getLatLng(), Math.max(mapInstance.getZoom(), 15));
        } else if (activeElements.length === 0) {
            console.log("No active elements to focus on. Map view unchanged.");
        }

        // Update UI button states
        if (window.AppUI) AppUI.updateShowAllButtonState();
        if (window.AppUI) AppUI.updateShowHistoryButtonState();
    }, // End updateMapView


    // --- Map Interactions ---
    viewDeviceOnMap: function (deviceId) {
        const device = AppState.getDeviceDisplayInfo(deviceId);
        if (!device || device.lat == null || device.lng == null) {
            if (window.AppUI) AppUI.showErrorDialog("Location Unavailable", `No recent location found for "${device?.name || deviceId}".`);
            return;
        }
        console.log("Viewing device on map:", device.name);
        AppState.currentViewedDeviceId = deviceId; // Set the currently viewed device
        this.clearSearchMarker(); // Clear any active search
        if (window.AppUI) AppUI.changePage('index'); // Ensure map page is visible

        // Use setTimeout to ensure page change/render completes before map interaction
        setTimeout(() => {
            const mapInstance = AppState.getMap();
            if (!mapInstance) return;
            this.updateMapView(); // Update map to show only this device (and history if enabled)
            // Use another short delay before opening popup
            setTimeout(() => {
                const marker = AppState.deviceMarkers[deviceId];
                if (marker && mapInstance.hasLayer(marker)) { // Check if marker exists and is on map
                    try { marker.openPopup(); } // Attempt to open its popup
                    catch (e) { console.warn("Error opening popup for device:", deviceId, e); }
                }
            }, 200); // Delay for popup opening
        }, 50); // Delay after page change
    },

    viewPlaceOnMap: function (placeIndex) {
        const place = AppState.savedPlaces[placeIndex];
        if (!place || place.lat == null || place.lng == null) {
            if (window.AppUI) AppUI.showErrorDialog("Location Unavailable", "No coordinates saved for this place.");
            return;
        }
        console.log("Viewing place on map:", place.name);
        AppState.currentViewedDeviceId = null; // Not viewing a specific device
        this.clearSearchMarker(); // Clear any active search
        if (window.AppUI) AppUI.changePage('index'); // Ensure map page is visible

        setTimeout(() => {
            const mapInstance = AppState.getMap();
            if (!mapInstance) return;
            // Don't call updateMapView here, as it might zoom out if 'Show All' isn't active
            // Instead, manually center and zoom, and ensure the marker is visible
            let targetMarker = AppState.savedPlaceMarkers.find(m => {
                const ll = m.getLatLng();
                return ll.lat === place.lat && ll.lng === place.lng;
            });

            // Center map on the place
            mapInstance.setView([place.lat, place.lng], 16); // Set desired zoom level

            // Ensure the marker is added and open popup
            if (targetMarker) {
                if (!mapInstance.hasLayer(targetMarker)) {
                    mapInstance.addLayer(targetMarker); // Add if not already present
                }
                targetMarker.openPopup(); // Open popup
            } else {
                console.warn("Could not find marker for saved place index:", placeIndex);
            }
        }, 50); // Delay after page change
    },

    viewGeofenceOnMap: function (geofenceId) {
        const geofence = AppState.getGlobalGeofences().find(gf => gf.id === geofenceId);
        if (!geofence || geofence.lat == null || geofence.lng == null) {
            if (window.AppUI) AppUI.showErrorDialog("Geofence Error", `Could not find data or location for geofence ID "${geofenceId}".`);
            return;
        }
        console.log("Viewing geofence on map:", geofence.name);
        AppState.currentViewedDeviceId = null; // Not viewing specific device
        this.clearSearchMarker(); // Clear search
        if (window.AppUI) AppUI.changePage('index'); // Ensure map page

        setTimeout(() => {
            const mapInstance = AppState.getMap();
            if (!mapInstance) return;

            let targetLayer = null;
            // Find the circle layer associated with this geofence ID
            AppState.geofenceLayerGroup?.eachLayer(layer => {
                // Check if it's a circle and has the matching geofenceId option
                if (layer instanceof L.Circle && layer.options && layer.options.geofenceId === geofenceId) {
                    targetLayer = layer;
                }
            });

            // Fit map bounds to the geofence area
            // Calculate bounds slightly larger than the circle radius for padding
            mapInstance.fitBounds(L.latLng(geofence.lat, geofence.lng).toBounds(geofence.radius * 2.5), { maxZoom: 16 });

            // Open the tooltip associated with the geofence circle
            if (targetLayer && targetLayer.openTooltip) {
                targetLayer.openTooltip(); // Open the tooltip (usually name)
            } else {
                console.warn("Could not find layer or tooltip for geofence", geofenceId);
            }
        }, 50); // Delay after page change
    },


    // --- Dialog Maps ---
    initPlacePickerDialogMap: function () {
        const searchInput = document.getElementById('place-picker-search-input');
        const searchError = document.getElementById('place-picker-search-error');
        const mapId = 'place-picker-map';
        const mapState = AppState.placePickerDialog;

        if (mapState.map) {
            // If map exists, just reset and center it
            mapState.map.invalidateSize(); // Ensure size is correct
            searchInput.value = ''; // Clear search
            searchError.style.display = 'none'; // Hide error
            this.centerDialogMapOnUserLocation('place', true); // Attempt to center on user
            return; // Don't reinitialize
        }

        try {
            const mapEl = document.getElementById(mapId);
            if (!mapEl) { console.error("Place picker map element not found:", mapId); return; }

            mapState.map = L.map(mapId, { zoomControl: false, attributionControl: false }).setView([0, 0], 2); // Default view
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapState.map);

            // Create marker, make draggable
            mapState.marker = L.marker([0, 0], { // Initial position (will be updated)
                icon: this.placePickerIcon,
                draggable: true,
                zIndexOffset: 1000 // Ensure draggable marker is on top
            }).addTo(mapState.map);

            // Update coordinates on marker drag
            mapState.marker.on('dragend', e => {
                const p = e.target.getLatLng();
                document.getElementById('new-place-lat').value = p.lat.toFixed(5);
                document.getElementById('new-place-lng').value = p.lng.toFixed(5);
            });

            // Update marker position and coordinates on map click
            mapState.map.on('click', e => {
                mapState.marker.setLatLng(e.latlng);
                document.getElementById('new-place-lat').value = e.latlng.lat.toFixed(5);
                document.getElementById('new-place-lng').value = e.latlng.lng.toFixed(5);
            });

            this.centerDialogMapOnUserLocation('place', true); // Attempt to center on user initially
            // Invalidate size after dialog is fully visible
            setTimeout(() => { if (mapState.map) mapState.map.invalidateSize(); }, 200);
        } catch (error) {
            console.error("Error initializing place picker map:", error);
            if (window.AppUI) AppUI.showErrorDialog("Map Error", "Could not initialize map.");
            if (window.AppUI) AppUI.closeDialog('add-place-dialog'); // Close dialog on error
        }
    },

    destroyPlacePickerDialogMap: function () {
        const mapState = AppState.placePickerDialog;
        if (mapState.map) {
            console.log("Destroying place picker dialog map");
            // Remove event listeners before removing map
            mapState.marker?.off(); // Remove listeners from marker
            mapState.map.off(); // Remove listeners from map
            mapState.map.remove(); // Remove map instance
            mapState.map = null;
            mapState.marker = null;
        }
    },

    initGeofenceDialogMap: function (centerLatLng, zoom, initialRadius) {
        const searchInput = document.getElementById('geofence-picker-search-input');
        const searchError = document.getElementById('geofence-picker-search-error');
        const radiusInput = document.getElementById('geofence-radius');
        const mapId = 'geofence-picker-map';
        const mapState = AppState.geofenceDialog;

        // If map already exists, just update its state
        if (mapState.map) {
            mapState.map.setView(centerLatLng, zoom);
            if (mapState.marker) mapState.marker.setLatLng(centerLatLng);
            if (mapState.circle) {
                mapState.circle.setLatLng(centerLatLng);
                mapState.circle.setRadius(initialRadius);
            }
            // Invalidate size shortly after potential dialog resize/display change
            setTimeout(() => { if (mapState.map) mapState.map.invalidateSize(); }, 100);
            // Reset UI elements
            searchInput.value = '';
            searchError.style.display = 'none';
            radiusInput.value = initialRadius;
            return; // Don't reinitialize
        }

        // Initialize map if it doesn't exist
        try {
            const mapEl = document.getElementById(mapId);
            if (!mapEl) { console.error("Geofence picker map element not found:", mapId); return; }

            mapState.map = L.map(mapId, { zoomControl: false, attributionControl: false }).setView(centerLatLng, zoom);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapState.map);

            // Create draggable center marker
            mapState.marker = L.marker(centerLatLng, {
                icon: this.geofenceCenterIcon,
                draggable: true,
                zIndexOffset: 1000 // Keep marker on top
            }).addTo(mapState.map);

            // Create radius circle
            mapState.circle = L.circle(centerLatLng, {
                radius: initialRadius,
                color: 'var(--m3-sys-color-primary)', // Use CSS variable
                fillColor: 'var(--m3-sys-color-primary)',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(mapState.map);

            // Event listeners
            mapState.marker.on('drag', this.updateGeofenceFromMarker.bind(this));
            mapState.marker.on('dragend', this.updateGeofenceFromMarker.bind(this));
            mapState.map.on('click', (e) => {
                if (mapState.marker) mapState.marker.setLatLng(e.latlng);
                this.updateGeofenceFromMarker(); // Update inputs and circle
            });
            radiusInput.addEventListener('input', this.updateGeofenceCircleFromRadius.bind(this));
            radiusInput.addEventListener('change', this.updateGeofenceCircleFromRadius.bind(this)); // Also on change

            // Invalidate size after dialog is fully visible
            setTimeout(() => { if (mapState.map) mapState.map.invalidateSize(); }, 200);
        } catch (error) {
            console.error("Error initializing geofence picker map:", error);
            if (window.AppUI) AppUI.showErrorDialog("Map Error", "Could not initialize map.");
            if (window.AppUI) AppUI.closeDialog('geofence-dialog'); // Close dialog on error
        }
    },

    destroyGeofenceDialogMap: function () {
        const mapState = AppState.geofenceDialog;
        if (mapState.map) {
            console.log("Destroying geofence dialog map");
            const radiusInput = document.getElementById('geofence-radius');
            // Remove specific listeners added during init
            if (radiusInput) {
                radiusInput.removeEventListener('input', this.updateGeofenceCircleFromRadius);
                radiusInput.removeEventListener('change', this.updateGeofenceCircleFromRadius);
            }
            mapState.marker?.off(); // Remove listeners from marker
            mapState.map.off(); // Remove listeners from map
            mapState.map.remove(); // Remove map instance
            mapState.map = null;
            mapState.marker = null;
            mapState.circle = null;
        }
    },

    updateGeofenceFromMarker: function () {
        const mapState = AppState.geofenceDialog;
        if (!mapState.marker) return;

        const latLng = mapState.marker.getLatLng();
        // Update input fields
        document.getElementById('geofence-lat').value = latLng.lat.toFixed(5);
        document.getElementById('geofence-lng').value = latLng.lng.toFixed(5);
        // Update circle position
        if (mapState.circle) {
            mapState.circle.setLatLng(latLng);
        }
    },

    updateGeofenceCircleFromRadius: function () {
        const mapState = AppState.geofenceDialog;
        if (!mapState.circle) return;

        const radiusInput = document.getElementById('geofence-radius');
        const radius = parseFloat(radiusInput.value);
        // Update circle radius if valid
        if (!isNaN(radius) && radius > 0) {
            mapState.circle.setRadius(radius);
        }
    },

    centerDialogMapOnUserLocation: function (dialogType) {
        console.log(`Centering ${dialogType} dialog map on user location...`);
        if (!navigator.geolocation) {
            if (window.AppUI) AppUI.showErrorDialog("Geolocation Unavailable", "Cannot get your current location.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const latLng = L.latLng(lat, lng);
                console.log("User location for dialog:", lat, lng);

                let mapState, map, marker, circle, latInputId, lngInputId;

                if (dialogType === 'place') {
                    mapState = AppState.placePickerDialog;
                    latInputId = 'new-place-lat';
                    lngInputId = 'new-place-lng';
                } else if (dialogType === 'geofence') {
                    mapState = AppState.geofenceDialog;
                    latInputId = 'geofence-lat';
                    lngInputId = 'geofence-lng';
                } else {
                    console.error("Invalid dialog type for centering:", dialogType);
                    return;
                }

                map = mapState.map;
                marker = mapState.marker;
                circle = mapState.circle; // Will be null for 'place' dialog

                if (map) {
                    map.setView(latLng, 15); // Zoom in closer than default
                }
                if (marker) {
                    marker.setLatLng(latLng); // Move marker to user location
                }
                if (circle) { // Only update circle for geofence dialog
                    circle.setLatLng(latLng); // Move circle center
                }
                // Update coordinate input fields
                const latInput = document.getElementById(latInputId);
                const lngInput = document.getElementById(lngInputId);
                if (latInput) latInput.value = lat.toFixed(5);
                if (lngInput) lngInput.value = lng.toFixed(5);

            },
            (error) => {
                // Use the shared error handler
                this.handleLocationError(error, `Could not center ${dialogType} map on your location.`);
            },
            // Geolocation options
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 } // Allow cached position up to 1 min
        );
    },


    handleDialogSearch: function (mapStateObj, searchInputId, searchErrorId, latInputId, lngInputId, radiusInputId = null) {
        const searchInput = document.getElementById(searchInputId);
        const errorElement = document.getElementById(searchErrorId);
        const query = searchInput.value.trim();
        errorElement.textContent = '';
        errorElement.style.display = 'none';

        if (!query || !mapStateObj || !mapStateObj.map || !mapStateObj.marker) {
            console.warn("Dialog search prerequisites not met.");
            return; // Exit if essential elements are missing
        }

        console.log(`Dialog search started for '${query}'`);
        searchInput.disabled = true; // Disable input during search

        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=1`;
        // Use AppConfig if available, otherwise default
        const appVersion = window.AppConfig?.APP_VERSION || '?.?.?';
        fetch(url, { headers: { 'User-Agent': `FindMyWebApp/${appVersion}` } })
            .then(res => {
                if (!res.ok) return res.text().then(text => { throw new Error(`Nominatim error ${res.status}: ${text}`) });
                return res.json();
            })
            .then(data => {
                if (data?.length > 0) {
                    const result = data[0];
                    const lat = parseFloat(result.lat);
                    const lng = parseFloat(result.lon);
                    const latLng = L.latLng(lat, lng);

                    // Update map view, marker position, and coordinate inputs
                    mapStateObj.map.setView(latLng, 15); // Zoom in on result
                    mapStateObj.marker.setLatLng(latLng);
                    document.getElementById(latInputId).value = lat.toFixed(5);
                    document.getElementById(lngInputId).value = lng.toFixed(5);

                    // Update circle position if it's the geofence dialog
                    if (radiusInputId && mapStateObj.circle) {
                        mapStateObj.circle.setLatLng(latLng);
                    }
                    // Optionally update the search input with the full result name
                    // searchInput.value = result.display_name;
                } else {
                    // No results found
                    errorElement.textContent = `Could not find "${query}".`;
                    errorElement.style.display = 'block';
                }
            })
            .catch(err => {
                console.error("Dialog geocoding error:", err);
                errorElement.textContent = `Search error: ${err.message}.`;
                errorElement.style.display = 'block';
            })
            .finally(() => {
                searchInput.disabled = false; // Re-enable input
            });
    },

    // --- Geofence Layer ---
    redrawGeofenceLayer: function () {
        const mapInstance = AppState.getMap();
        const layerGroup = AppState.geofenceLayerGroup;
        const geofences = AppState.getGlobalGeofences(); // Get current global geofences

        if (!mapInstance || !layerGroup) return; // Ensure map and layer group exist

        // console.log("Redrawing geofence layer on main map..."); // Can be noisy
        layerGroup.clearLayers(); // Remove all existing geofence circles/tooltips

        geofences.forEach(gf => {
            // Create the circle for the geofence
            const circle = L.circle([gf.lat, gf.lng], {
                radius: gf.radius,
                className: 'geofence-circle', // CSS class for styling
                pane: AppConfig.LEAFLET_PANES.GEOFENCE.name, // Assign to non-interactive pane
                geofenceId: gf.id // Store ID for potential future identification
            });

            // Bind a tooltip (shows on hover) with the geofence name
            circle.bindTooltip(gf.name, {
                permanent: false, // Show only on hover/focus by default
                sticky: true, // Follow the mouse cursor
                direction: 'top', // Position above the cursor
                className: 'geofence-tooltip', // CSS class for styling
                // offset: L.point(0, -gf.radius) // Optional: Offset slightly above circle edge
            });

            // Add the styled circle with tooltip to the layer group
            layerGroup.addLayer(circle);
        });
        // console.log(`Added ${geofences.length} geofences to map layer.`); // Can be noisy
    },

}; // End of window.AppMap definition