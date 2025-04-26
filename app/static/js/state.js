// app/static/js/state.js

// Simple state management object attached to window for now
window.AppState = {
    map: null,
    locationMarker: null,
    deviceMarkers: {},
    deviceHistoryLayers: {},
    geofenceLayerGroup: null,
    savedPlaceMarkers: [],
    searchMarker: null,
    placePickerDialog: { map: null, marker: null },
    geofenceDialog: { map: null, marker: null, circle: null },
    lastDeviceUpdateTime: null,
    currentDeviceData: [],
    globalGeofenceData: [],
    locationHistoryEnabled: true,
    locationHistory: [],
    savedPlaces: [],
    currentTheme: 'system',
    userColor: '#4285F4', // Default color
    currentViewedDeviceId: null,
    isShowingAllDevices: false,
    showDeviceHistory: false,
    historyTimeFilterHours: 24 * 7,
    deviceVisibility: {},
    swRegistration: null,
    currentPushSubscription: null,
    importData: null,
    mapReady: false,
    lastActivePageId: 'index',
    userActiveShares: [],
    currentAccuracyCircle: null,
    userAccuracyCircle: null,
    isInitialLoad: true,

    // --- Initialization ---
    loadInitialState: function () {
        this.mapReady = false;
        this.isInitialLoad = true;
        this.isShowingAllDevices = localStorage.getItem('isShowingAllDevices') === 'true';
        this.showDeviceHistory = localStorage.getItem('showDeviceHistory') === 'true';

        const storedHours = localStorage.getItem('historyTimeFilterHours');
        const defaultHours = 24 * 7; // 168
        if (storedHours !== null) {
            const parsedHours = parseInt(storedHours, 10);
            if (!isNaN(parsedHours) && parsedHours >= 1 && parsedHours <= 168) { // Validate range
                this.historyTimeFilterHours = parsedHours;
                console.log(`[State Init] Loaded historyTimeFilterHours from localStorage: ${this.historyTimeFilterHours}`);
            } else {
                console.warn(`[State Init] Invalid historyTimeFilterHours '${storedHours}' in localStorage. Using default: ${defaultHours}`);
                this.historyTimeFilterHours = defaultHours;
                localStorage.setItem('historyTimeFilterHours', this.historyTimeFilterHours); // Save corrected default
            }
        } else {
            console.log(`[State Init] historyTimeFilterHours not found in localStorage. Using default: ${defaultHours}`);
            this.historyTimeFilterHours = defaultHours;
        }


        // --- FIX: Load and Clean lastActivePageId ---
        let storedPageId = localStorage.getItem('lastActivePageId'); // Get raw value
        if (storedPageId === null || storedPageId === undefined) {
            this.lastActivePageId = 'index'; // Default if not found
        } else {
            // Attempt to remove quotes if present (handles old bad data)
            if (storedPageId.length > 1 && storedPageId.startsWith('"') && storedPageId.endsWith('"')) {
                console.warn("[State] Found quoted lastActivePageId in storage, cleaning it up.");
                storedPageId = storedPageId.substring(1, storedPageId.length - 1);
                // Optional: Save cleaned value back immediately
                // localStorage.setItem('lastActivePageId', storedPageId);
            }
            // Now assign the potentially cleaned value
            this.lastActivePageId = storedPageId;
        }
        // --- End Fix ---

        this.userAccuracyCircle = null; // Ensure reset on load
        console.log("Initial state loaded. Last Active Page:", this.lastActivePageId);
    },
    // NEW function to set preferences fetched from API
    setCurrentUserPreferences: function (prefs) {
        this.currentTheme = prefs?.theme_mode || 'system';
        this.userColor = prefs?.theme_color || (window.AppTheme ? AppTheme.DEFAULT_SOURCE_COLOR : '#4285F4');
        console.log(`Preferences set from API: Mode=${this.currentTheme}, Color=${this.userColor}`);
    },



    // --- Getters / Setters ---
    getMap: function () { return this.map; },
    setMap: function (mapInstance) { this.map = mapInstance; },

    getCurrentDeviceData: function () { return this.currentDeviceData; },
    setCurrentDeviceData: function (data) {
        if (Array.isArray(data)) {
            this.currentDeviceData = data.map(device => ({...device, reports: Array.isArray(device.reports) ? device.reports : [] }));
            this.lastDeviceUpdateTime = new Date(); // Update timestamp
            // DO NOT set isInitialLoad to false here, let _updateDeviceUI handle it after first SUCCESSFUL update
        } else { console.error("Invalid device data format:", data); }
    },

    getGlobalGeofences: function () { return this.globalGeofenceData; },
    setGlobalGeofences: function (data) {
        if (Array.isArray(data)) {
            this.globalGeofenceData = data;
        } else {
            console.error("Invalid geofence data format:", data);
        }
    },

    getDeviceVisibility: function (deviceId) {
        // Make sure to check the stored state after loading initial state
        const storedVisibility = this.deviceVisibility[deviceId];
        return storedVisibility !== false; // Default to true if undefined or explicitly true
    },
    setDeviceVisibility: function (deviceId, isVisible) {
        this.deviceVisibility[deviceId] = !!isVisible;
        // Debounced save moved to ui.js
    },

    getDeviceDisplayInfo: function (deviceId) {
        const deviceApiData = this.currentDeviceData.find(d => d.id === deviceId);
        const defaultColor = AppUtils.getDefaultColorForId(deviceId);

        // Ensure visibility state is initialized if missing
        if (!(deviceId in this.deviceVisibility)) {
            this.deviceVisibility[deviceId] = true; // Default to visible
        }
        const isVisible = this.getDeviceVisibility(deviceId);

        if (!deviceApiData) {
            console.warn(`Device data for ${deviceId} not found in current API data.`);
            // Generate fallback SVG here if data is missing
            const fallbackSvg = AppUtils.generateDeviceIconSVG('❓', defaultColor);
            return {
                id: deviceId, name: deviceId, label: '❓', color: defaultColor,
                svg_icon: fallbackSvg, // Use generated fallback
                geofences: [], isVisible: isVisible, lat: null, lng: null,
                rawLocation: null,
                reports: [], // Ensure reports exists
                model: 'Unknown', status: 'Unknown',
                batteryLevel: null, batteryStatus: 'Unknown', locationTimestamp: null, address: 'Unknown'
            };
        }

        const color = deviceApiData.color || defaultColor;
        // Use svg_icon from API data, generate fallback if missing
        const svg_icon = deviceApiData.svg_icon || AppUtils.generateDeviceIconSVG(deviceApiData.label || '❓', color);

        return {
            id: deviceId,
            name: deviceApiData.name || deviceId,
            label: deviceApiData.label || '❓',
            color: color,
            svg_icon: svg_icon,
            geofences: Array.isArray(deviceApiData.geofences) ? deviceApiData.geofences : [], // Ensure geofences is an array
            isVisible: isVisible,
            lat: deviceApiData.lat,
            lng: deviceApiData.lng,
            rawLocation: deviceApiData.rawLocation,
            reports: Array.isArray(deviceApiData.reports) ? deviceApiData.reports : [], // Ensure reports is an array
            status: deviceApiData.status || 'Unknown',
            model: deviceApiData.model || 'Unknown',
            batteryLevel: deviceApiData.batteryLevel,
            batteryStatus: deviceApiData.batteryStatus || 'Unknown',
            locationTimestamp: deviceApiData.locationTimestamp,
            address: deviceApiData.address || 'Unknown'
        };
    },

    // --- START: New Share Methods ---
    /**
     * Sets the user's active shares in the state.
     * @param {Array<object>} shares - Array of share objects from the API.
     */
    setUserActiveShares: function (shares) {
        if (Array.isArray(shares)) {
            this.userActiveShares = shares;
            console.log(`[State] Set ${shares.length} active shares.`);
        } else {
            console.error("[State] Invalid data provided to setUserActiveShares, expected array.");
            this.userActiveShares = [];
        }
    },

    /**
     * Gets the currently stored active shares.
     * @returns {Array<object>}
     */
    getUserActiveShares: function () {
        return this.userActiveShares;
    },


    getLastActivePageId: function () {
        return this.lastActivePageId;
    },



    // --- Persistence Helpers ---
    _saveToLocalStorage: function (key, data) {
        try {
            // --- FIX: Store strings directly, stringify others ---
            const valueToStore = (typeof data === 'string') ? data : JSON.stringify(data);
            localStorage.setItem(key, valueToStore);
            // --- End Fix ---
        } catch (e) {
            console.error(`Failed to save '${key}' to localStorage:`, e);
        }
    },

    saveLastActivePageId: function (pageId) {
        if (pageId && typeof pageId === 'string') {
            this.lastActivePageId = pageId;
            // Use the corrected _saveToLocalStorage
            this._saveToLocalStorage('lastActivePageId', pageId);
            console.log(`[State] Saved last active page: ${pageId}`);
        } else {
            console.warn(`[State] Attempted to save invalid pageId: ${pageId}`);
        }
    },

    saveDeviceVisibilityState: function () {
        this._saveToLocalStorage('deviceVisibility', this.deviceVisibility);
    },

    saveLocationHistory: function () {
        this._saveToLocalStorage('locationHistory', this.locationHistory);
    },
    saveSavedPlaces: function () {
        this._saveToLocalStorage('savedPlaces', this.savedPlaces);
    },
    saveTheme: function () {
        localStorage.setItem('theme', this.currentTheme);
    },
    saveMapToggles: function () {
        localStorage.setItem('isShowingAllDevices', this.isShowingAllDevices);
        localStorage.setItem('showDeviceHistory', this.showDeviceHistory);
        localStorage.setItem('historyTimeFilterHours', this.historyTimeFilterHours);
    },
    saveLocationHistoryEnabled: function () {
        localStorage.setItem('locationHistoryEnabled', this.locationHistoryEnabled);
    },

    // --- History Management ---
    addToLocationHistory: function (locationItem) {
        if (!this.locationHistoryEnabled) return;
        console.log("Adding to history:", locationItem.location);

        // Ensure timestampISO exists
        if (!locationItem.timestampISO) {
            locationItem.timestampISO = (locationItem.time instanceof Date)
                ? locationItem.time.toISOString() // If time is Date object
                : new Date().toISOString();    // Otherwise use current time
        }

        if (this.locationHistory.length > 0) {
            const last = this.locationHistory[0];
            const similar = last.location === locationItem.location &&
                Math.abs((last.lat || 0) - (locationItem.lat || 1)) < 0.0005 &&
                Math.abs((last.lng || 0) - (locationItem.lng || 1)) < 0.0005;
            if (similar) {
                console.log("Skipping similar history entry.");
                return;
            }
        }

        this.locationHistory.unshift(locationItem);
        if (this.locationHistory.length > AppConfig.MAX_HISTORY_POINTS) {
            this.locationHistory.pop();
        }
        this.saveLocationHistory();
    },


    clearLocationHistory: function () {
        this.locationHistory = [];
        this.saveLocationHistory();
        console.log("Location history cleared.");
    },

    // --- Import/Export State ---
    setImportData: function (data) {
        console.log("Setting import data:", data);
        this.importData = data;
    },
    getImportData: function () {
        return this.importData;
    },
    clearImportData: function () {
        console.log("Clearing import data.");
        this.importData = null;
    },
};