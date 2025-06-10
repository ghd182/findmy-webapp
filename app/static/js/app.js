// app/static/js/app.js
// FULL FILE

// --- Helper Functions (Moved from index.html) ---

// Function to dynamically import local fallback module for ES Modules
async function loadLocalModuleFallback(localPath, checkObject) {
    // Give the CDN module a moment to potentially load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if the expected global object exists AND has expected functions
    let isUtilLoaded = window[checkObject] &&
        typeof window[checkObject].argbFromHex === 'function' &&
        typeof window[checkObject].themeFromSourceColor === 'function';

    if (!isUtilLoaded) {
        console.warn(`CDN module failed to define ${checkObject} correctly or is incomplete. Loading local fallback: ${localPath}`);
        try {
            const fallbackModule = await import(localPath);

            // Re-assign functions to the global object
            if (fallbackModule && typeof fallbackModule.argbFromHex === 'function') {
                window[checkObject] = {
                    argbFromHex: fallbackModule.argbFromHex,
                    themeFromSourceColor: fallbackModule.themeFromSourceColor,
                    applyTheme: fallbackModule.applyTheme,
                    sourceColorFromImage: fallbackModule.sourceColorFromImage,
                    hexFromArgb: fallbackModule.hexFromArgb
                };
                console.log(`Successfully loaded and assigned local fallback module ${checkObject}`);
                isUtilLoaded = true; // Mark as loaded successfully
            } else {
                console.error(`Local fallback module ${localPath} loaded but had no valid exports.`);
                throw new Error(`Fallback module ${localPath} structure invalid.`);
            }

        } catch (error) {
            console.error(`Failed to load local fallback module ${checkObject} from ${localPath}:`, error);

            // --- START: Cloudflare Access CORS Error Detection ---
            const isCorsFetchError = error instanceof TypeError && error.message.includes('Failed to fetch');
            const isCloudflareAccessUrlInError = error.message.includes('cloudflareaccess.com');

            if (isCorsFetchError && isCloudflareAccessUrlInError) {
                console.warn("[Fallback Load] Detected potential Cloudflare Access CORS block for static asset.", error);
                // Call the UI prompt function
                if (window.AppUI && typeof window.AppUI.showCloudflareReauthPrompt === 'function') {
                    // Check if prompt is already shown
                    const existingPrompt = document.getElementById('confirmation-dialog-overlay');
                    if (!existingPrompt || !existingPrompt.classList.contains('show')) {
                        AppUI.showCloudflareReauthPrompt(localPath); // Show prompt
                    } else {
                        console.log("[Fallback Load] Cloudflare prompt already visible, skipping new one.");
                    }
                } else {
                    alert("Your security session may have expired blocking essential resources. Please reload the page to re-authenticate."); // Fallback alert
                }
                // Error handled by dialog, prevent further propagation
                return; // Stop further processing in this catch block
            }
            // --- END: Cloudflare Access CORS Error Detection ---

            // Handle other fallback loading errors
            console.error(`Generic error loading fallback ${checkObject}:`, error);
        }
    } else {
        console.log(`CDN module ${checkObject} loaded successfully.`);
    }
}

// Define AppActions object if it doesn't exist, including forceLogout
if (!window.AppActions) { window.AppActions = {}; }
window.AppActions.forceLogout = function () {
    console.log("Action: Force Logout triggered.");
    window.location.href = '/logout';
};

// --- AppTheme definition (Moved from index.html) ---
window.AppTheme = {
    DEFAULT_SOURCE_COLOR: '#4285F4', // Google Blue
    cssVariableMap: { // Ensure ALL roles, including surface containers, are listed here
        primary: '--m3-sys-color-primary', onPrimary: '--m3-sys-color-on-primary', primaryContainer: '--m3-sys-color-primary-container', onPrimaryContainer: '--m3-sys-color-on-primary-container',
        secondary: '--m3-sys-color-secondary', onSecondary: '--m3-sys-color-on-secondary', secondaryContainer: '--m3-sys-color-secondary-container', onSecondaryContainer: '--m3-sys-color-on-secondary-container',
        tertiary: '--m3-sys-color-tertiary', onTertiary: '--m3-sys-color-on-tertiary', tertiaryContainer: '--m3-sys-color-tertiary-container', onTertiaryContainer: '--m3-sys-color-on-tertiary-container',
        error: '--m3-sys-color-error', onError: '--m3-sys-color-on-error', errorContainer: '--m3-sys-color-error-container', onErrorContainer: '--m3-sys-color-on-error-container',
        background: '--m3-sys-color-background', onBackground: '--m3-sys-color-on-background',
        surface: '--m3-sys-color-surface', onSurface: '--m3-sys-color-on-surface', surfaceVariant: '--m3-sys-color-surface-variant', onSurfaceVariant: '--m3-sys-color-on-surface-variant',
        outline: '--m3-sys-color-outline', outlineVariant: '--m3-sys-color-outline-variant',
        shadow: '--m3-sys-color-shadow', scrim: '--m3-sys-color-scrim',
        inverseSurface: '--m3-sys-color-inverse-surface', inverseOnSurface: '--m3-sys-color-inverse-on-surface', inversePrimary: '--m3-sys-color-inverse-primary',
        surfaceDim: '--m3-sys-color-surface-dim',
        surfaceBright: '--m3-sys-color-surface-bright',
        surfaceContainerLowest: '--m3-sys-color-surface-container-lowest',
        surfaceContainerLow: '--m3-sys-color-surface-container-low',
        surfaceContainer: '--m3-sys-color-surface-container',
        surfaceContainerHigh: '--m3-sys-color-surface-container-high',
        surfaceContainerHighest: '--m3-sys-color-surface-container-highest',
    },

    _debounce: function (func, wait) {
        let timeout;
        return (...args) => {
            const context = this;
            const later = () => {
                timeout = null;
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    _debouncedSavePreferences: null, // Initialized in setupThemeControls

    generatePalettesFromSource(hexColor) {
        if (!window.M3ColorUtils) {
            console.error("M3ColorUtils not available for generatePalettesFromSource!");
            return null;
        }
        const { argbFromHex, themeFromSourceColor, hexFromArgb, TonalPalette } = window.M3ColorUtils;

        try {
            const sourceArgb = argbFromHex(hexColor);
            const theme = themeFromSourceColor(sourceArgb);

            const extractRolesAndTones = (scheme, palette, tones, mode) => {
                const hexPalette = {};
                console.log(`[Theme Gen - ${mode}] Extracting roles from scheme...`);
                for (const role in this.cssVariableMap) {
                    if (scheme[role] !== undefined && typeof scheme[role] === 'number') {
                        try { hexPalette[role] = hexFromArgb(scheme[role]); }
                        catch (e) { console.warn(`[Theme Gen - ${mode}] Failed to convert scheme role ${role}:`, e); }
                    }
                }
                console.log(`[Theme Gen - ${mode}] Extracting tones from neutral palette...`, tones);
                if (palette && typeof palette.tone === 'function') {
                    for (const role in tones) {
                        const toneValue = tones[role];
                        try {
                            const toneArgb = palette.tone(toneValue);
                            hexPalette[role] = hexFromArgb(toneArgb);
                        } catch (e) {
                            console.warn(`[Theme Gen - ${mode}] Failed to get tone ${toneValue} for role ${role}:`, e);
                        }
                    }
                } else {
                    console.warn(`[Theme Gen - ${mode}] Neutral palette or tone() method not available!`);
                }
                return hexPalette;
            };

            const lightTones = { surfaceDim: 87, surfaceBright: 98, surfaceContainerLowest: 100, surfaceContainerLow: 96, surfaceContainer: 94, surfaceContainerHigh: 92, surfaceContainerHighest: 90 };
            const darkTones = { surfaceDim: 6, surfaceBright: 24, surfaceContainerLowest: 4, surfaceContainerLow: 10, surfaceContainer: 12, surfaceContainerHigh: 17, surfaceContainerHighest: 22 };
            const neutralPalette = theme.palettes?.neutral;
            if (!neutralPalette) {
                console.error("[Theme Gen] Neutral palette is missing from the generated theme object!");
                const lightFallback = {}; const darkFallback = {};
                for (const role in this.cssVariableMap) { if (theme.schemes.light[role]) lightFallback[role] = hexFromArgb(theme.schemes.light[role]); if (theme.schemes.dark[role]) darkFallback[role] = hexFromArgb(theme.schemes.dark[role]); }
                return { light: lightFallback, dark: darkFallback };
            }

            const lightPaletteHex = extractRolesAndTones(theme.schemes.light, neutralPalette, lightTones, 'light');
            const darkPaletteHex = extractRolesAndTones(theme.schemes.dark, neutralPalette, darkTones, 'dark');

            console.log("[Theme Gen] Light Palette (Hex):", lightPaletteHex);
            console.log("[Theme Gen] Dark Palette (Hex):", darkPaletteHex);
            return { light: lightPaletteHex, dark: darkPaletteHex };
        } catch (error) {
            console.error(`Error generating M3 palettes from ${hexColor}:`, error);
            return null;
        }
    },

    applyPaletteToCSS(palette) {
        // 
        if (!palette) { console.error("Cannot apply null palette to CSS."); return; }
        const targetStyle = document.documentElement.style;
        let appliedCount = 0; let mappedCount = 0; const missingRoles = [];
        console.log("[Theme Debug] Generated Palette Keys:", Object.keys(palette));
        for (const role in this.cssVariableMap) {
            mappedCount++;
            const cssVarName = this.cssVariableMap[role];
            if (palette[role] !== undefined && palette[role] !== null) {
                let hexValue;
                if (typeof palette[role] === 'number' && window.M3ColorUtils?.hexFromArgb) {
                    try { hexValue = window.M3ColorUtils.hexFromArgb(palette[role]); }
                    catch (e) { console.warn(`[Theme] Failed to convert ARGB for role ${role}`, e); hexValue = null; }
                } else if (typeof palette[role] === 'string' && /^#[0-9a-fA-F]{6}$/.test(palette[role])) {
                    hexValue = palette[role];
                } else { console.warn(`[Theme] Invalid color value type for role ${role}:`, palette[role]); hexValue = null; }
                if (hexValue) { targetStyle.setProperty(cssVarName, hexValue); appliedCount++; }
                else { missingRoles.push(`${role} (invalid value)`); }
            } else { missingRoles.push(role); }
        }
        console.log(`[Theme] Applied ${appliedCount} / ${mappedCount} mapped CSS color variables to root style.`);
        if (missingRoles.length > 0) { console.warn(`[Theme] Roles missing from generated palette or had invalid value: ${missingRoles.join(', ')}`); }
    },

    isDarkModeActive(themePreference) {
        // 
        if (themePreference === 'dark') return true; if (themePreference === 'light') return false; return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    },

    applyTheme(sourceHexColor, themePreference) {
        // 
        console.log(`[Theme] Applying theme: Color=${sourceHexColor}, Mode=${themePreference}`);
        if (!window.M3ColorUtils || !window.M3ColorUtils.themeFromSourceColor) {
            console.error("[Theme Apply] M3ColorUtils not loaded. Cannot generate palette. Applying basic theme class.");
            const isDarkFallback = this.isDarkModeActive(themePreference);
            this._updateBodyAndMapTheme(isDarkFallback, null);
            return;
        }
        const palettes = this.generatePalettesFromSource(sourceHexColor);
        if (!palettes) {
            console.error("[Theme] Failed to generate palettes. Applying default fallback.");
            const defaultPalettes = this.generatePalettesFromSource(this.DEFAULT_SOURCE_COLOR);
            if (defaultPalettes) {
                const isDarkFallback = this.isDarkModeActive(themePreference);
                this.applyPaletteToCSS(isDarkFallback ? defaultPalettes.dark : defaultPalettes.light);
                this._updateBodyAndMapTheme(isDarkFallback, defaultPalettes[isDarkFallback ? 'dark' : 'light']);
            } else { console.error("[Theme] FATAL: Could not generate even default palettes."); }
            return;
        }
        const isDark = window.AppTheme.isDarkModeActive(themePreference);
        const activePalette = isDark ? palettes.dark : palettes.light;
        this.applyPaletteToCSS(activePalette);
        this._updateBodyAndMapTheme(isDark, activePalette);
        console.log(`[Theme] Applied ${isDark ? 'dark' : 'light'} mode with generated palette.`);
    },

    _updateBodyAndMapTheme(isDark, activePalette) {

        const targetElement = document.documentElement;
        targetElement.classList.remove('dark-theme', 'light-theme');
        targetElement.classList.add(isDark ? 'dark-theme' : 'light-theme');
        const metaThemeColor = document.getElementById('meta-theme-color');
        const metaColorValue = activePalette?.background || (isDark ? '#1C1B1F' : '#FFFBFE');
        if (metaThemeColor) { metaThemeColor.setAttribute('content', metaColorValue); }
        if (window.AppMap && typeof window.AppMap.updateMapThemeStyle === 'function') { window.AppMap.updateMapThemeStyle(isDark); }
    },

    setupThemeControls() {
        // Debounce setup
        if (!this._debouncedSavePreferences) {
            this._debouncedSavePreferences = this._debounce(async (mode, color) => {
                console.log(`[Theme Debounced] Saving Prefs - Mode: ${mode}, Color: ${color}`);
                try {
                    if (window.AppApi && typeof window.AppApi.updateUserPreferences === 'function') {
                        await AppApi.updateUserPreferences(mode, color);
                        console.log("[Theme Debounced] Preferences saved to backend.");

                        const isAndroidApp = window.Android && typeof window.Android.updateNativeThemeColor === 'function' && typeof window.Android.isRunningInAndroidApp === 'function' && window.Android.isRunningInAndroidApp();
                        const isLikelyLoggedIn = !!window.AppState.username; // Re-check just in case
                        if (isAndroidApp && isLikelyLoggedIn) {
                            console.log("[Theme Debounced] Logged in on Android, sending SAVED color to native:", color);
                            try {
                                window.Android.updateNativeThemeColor(color);
                            } catch (e) {
                                console.error("Error calling Android.updateNativeThemeColor on save:", e);
                            }
                        }

                    } else { console.error("[Theme Debounced] AppApi.updateUserPreferences not available!"); }
                } catch (error) { console.error("[Theme Debounced] Failed to save preferences to backend:", error); if (window.AppUI) AppUI.showErrorDialog("Save Error", "Could not save theme preference to server.", 3000); }
            }, 1000);
        }
        const colorPicker = document.getElementById('theme-color-picker');
        const themeRadios = document.querySelectorAll('input[name="theme"]');
        const resetColorButton = document.getElementById('reset-theme-color-button');
        const self = this;
        colorPicker?.addEventListener('input', (e) => { const newColor = e.target.value; AppState.userColor = newColor; self.applyTheme(newColor, AppState.currentTheme); self._debouncedSavePreferences(AppState.currentTheme, newColor); });
        themeRadios.forEach(radio => { radio.addEventListener('change', (e) => { if (e.target.checked) { const newMode = e.target.value; if (window.AppUI) AppUI.setTheme(newMode); self._debouncedSavePreferences(newMode, AppState.userColor); } }); });
        resetColorButton?.addEventListener('click', () => { console.log("Resetting theme color to default."); const defaultColor = self.DEFAULT_SOURCE_COLOR; AppState.userColor = defaultColor; if (colorPicker) colorPicker.value = defaultColor; self.applyTheme(defaultColor, AppState.currentTheme); self._debouncedSavePreferences(AppState.currentTheme, defaultColor); });
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (mediaQuery._themeChangeListener) { mediaQuery.removeEventListener('change', mediaQuery._themeChangeListener); }
        mediaQuery._themeChangeListener = (e) => { if (AppState.currentTheme === 'system') { self.applyTheme(AppState.userColor, 'system'); } }; mediaQuery.addEventListener('change', mediaQuery._themeChangeListener);
        console.log("[Theme] Theme controls setup complete.");
    },


    initializeTheme: function () {
        if (!window.AppState) { console.error("[Theme Init] AppState not available!"); return; }

        let sourceColorToUse = AppState.userColor || this.DEFAULT_SOURCE_COLOR;
        let themeModeToUse = AppState.currentTheme || 'system';

        const isAndroidApp = window.Android && typeof window.Android.getAppThemeColor === 'function' && typeof window.Android.isRunningInAndroidApp === 'function' && window.Android.isRunningInAndroidApp();
        const isLikelyLoggedIn = !!window.AppState.username; // Check login status

        console.log(`[Theme Init] isAndroidApp: ${isAndroidApp}, isLikelyLoggedIn: ${isLikelyLoggedIn}`);

        if (isAndroidApp && !isLikelyLoggedIn) {
            console.log("[Theme Init] Android App & Not Logged In: Attempting to use native theme color.");
            try {
                const nativeColor = window.Android.getAppThemeColor();
                if (nativeColor && /^#[0-9a-fA-F]{6}$/.test(nativeColor)) {
                    console.log("[Theme Init] Using native Android theme color:", nativeColor);
                    sourceColorToUse = nativeColor;
                    AppState.userColor = sourceColorToUse; // Update AppState
                    localStorage.setItem('userColor', sourceColorToUse); // Persist for web context
                } else {
                    console.warn("[Theme Init] Native Android theme color not available or invalid ('" + nativeColor + "'), using default/stored web color:", sourceColorToUse);
                }
            } catch (e) {
                console.error("[Theme Init] Error calling Android.getAppThemeColor:", e);
            }
        } else if (isLikelyLoggedIn) {
            sourceColorToUse = AppState.userColor; // Already loaded from backend prefs via AppState
            console.log(`[Theme Init] Logged In (Web or Android): Using stored user preference color: ${sourceColorToUse}`);
        } else {
            console.log(`[Theme Init] Browser (Not Android or Not Logged In): Using web color: ${sourceColorToUse}`);
        }
        
        // // --- Apply the determined theme ---
        // // Ensure M3ColorUtils is ready before applying full theme
        // if (!window.M3ColorUtils || !window.M3ColorUtils.themeFromSourceColor) {
        //     console.error("[Theme Init] M3ColorUtils not loaded. Applying basic theme class.");
        //     const isDarkFallback = this.isDarkModeActive(themeModeToUse);
        //     const targetElement = document.documentElement;
        //     targetElement.classList.remove('dark-theme', 'light-theme');
        //     targetElement.classList.add(isDarkFallback ? 'dark-theme' : 'light-theme');
        //     // Also update the color picker visually
        //     const colorPicker = document.getElementById('theme-color-picker');
        //     if (colorPicker) colorPicker.value = sourceColorToUse;
        //     document.querySelectorAll('input[name="theme"]').forEach(radio => { radio.checked = (radio.value === themeModeToUse); });
        //     this.setupThemeControls(); // Setup listeners AFTER initial apply attempt
        //     return; // Stop here if utils not ready
        // }

        // Update UI controls before applying
        const colorPicker = document.getElementById('theme-color-picker');
        if (colorPicker) colorPicker.value = sourceColorToUse;
        document.querySelectorAll('input[name="theme"]').forEach(radio => { radio.checked = (radio.value === themeModeToUse); });

        this.applyTheme(sourceColorToUse, themeModeToUse); // Apply to web UI first

        // If in Android App and logged in, tell native about the color being used.
        if (isAndroidApp && isLikelyLoggedIn) {
            console.log("[Theme Init] Logged in on Android, sending INITIAL effective color to native:", sourceColorToUse);
            try {
                window.Android.updateNativeThemeColor(sourceColorToUse);
            } catch (e) {
                console.error("Error calling Android.updateNativeThemeColor during init:", e);
            }
        }

        this.setupThemeControls();
    },

};


// --- AppActions ---
window.AppActions = {
    _refreshPollingInterval: null,
    _refreshPollingTimeout: null,
    _stopRefreshPolling: function () {
        if (this._refreshPollingInterval) { clearInterval(this._refreshPollingInterval); this._refreshPollingInterval = null; console.log("[Action Refresh Poll] Polling stopped."); }
        if (this._refreshPollingTimeout) { clearTimeout(this._refreshPollingTimeout); this._refreshPollingTimeout = null; }
        const button = document.getElementById('refresh-devices-button');
        if (button && button.disabled) { button.disabled = false; if (button.dataset.originalHtml) { button.innerHTML = button.dataset.originalHtml; } else { button.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">refresh</span> Update Status`; } console.log("[Action Refresh Poll] Button restored by _stopRefreshPolling."); }
    },
    _updateDeviceUI: function (data, lastUpdatedElement, listElement, noDevicesMessage, error = null) {
        const devicesPageVisible = document.getElementById('shared-page')?.style.display !== 'none'; const listContainer = document.getElementById('shared-devices-list'); try { const errorMessageElement = document.getElementById('devices-error-message'); if (error) { console.error("Updating device UI with error:", error); if (error.code !== 'NO_APPLE_CREDS' && error.status !== 401 && error.status !== 403 && !(error.message && error.message.includes("2FA Required"))) { if (window.AppUI) AppUI.showErrorDialog("Device Refresh Error", `Could not get device status.<br>Details: ${error.message} (${error.code || 'N/A'})`); } if (errorMessageElement) { errorMessageElement.textContent = `Error: ${error.message}`; errorMessageElement.style.display = 'block'; } if (lastUpdatedElement) { lastUpdatedElement.textContent = 'Update failed'; lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; } if (devicesPageVisible && listElement) AppUI.renderDevicesList([]); } else if (data) { const previousTimestamp = AppState.lastDeviceUpdateTime ? AppState.lastDeviceUpdateTime.toISOString() : null; const newTimestamp = data.last_updated || null; if (AppState.currentViewedDeviceId && !data.devices?.some(d => d.id === AppState.currentViewedDeviceId)) { AppState.currentViewedDeviceId = null; } AppState.setCurrentDeviceData(data.devices || []); if (devicesPageVisible && listElement) { AppUI.renderDevicesList(AppState.getCurrentDeviceData()); } let statusText = 'Last updated: Unknown'; if (data.code === 'NO_DEVICE_FILES') { statusText = 'No devices configured'; } else if (data.code === 'NO_APPLE_CREDS') { statusText = 'Credentials needed'; } else if (data.fetch_errors && data.fetch_errors.includes("2FA Required")) { statusText = `Update Failed: ${data.fetch_errors}`; } else if (data.code === 'CACHE_EMPTY' || data.code === 'CACHE_EMPTY_CONFIG_RETURNED') { statusText = `Waiting for first fetch... (${data.fetch_errors || 'No data yet'})`; } else if (data.last_updated) { try { const d = new Date(data.last_updated); const relativeTimeStr = AppUtils.formatTimeRelative(d); statusText = `Last updated: ${relativeTimeStr}`; if (lastUpdatedElement) { lastUpdatedElement.dataset.timestamp = data.last_updated; lastUpdatedElement.classList.add('relative-time'); } } catch (e) { statusText = `Last updated: ${data.last_updated}`; if (lastUpdatedElement) { lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; } } } else if (data.fetch_errors) { statusText = `Update Failed: ${data.fetch_errors}`; if (lastUpdatedElement) { lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; } } if (lastUpdatedElement) { lastUpdatedElement.textContent = statusText; } if (devicesPageVisible && noDevicesMessage) noDevicesMessage.style.display = (data.devices?.length === 0) ? 'block' : 'none'; if (errorMessageElement) errorMessageElement.style.display = 'none'; if (window.AppUI && typeof AppUI.updateRelativeTimes === 'function') { AppUI.updateRelativeTimes(); } const mapPageVisible = document.getElementById('index-page')?.style.display !== 'none'; const shouldUpdateMap = AppState.mapReady && (mapPageVisible || AppState.isInitialLoad) && (newTimestamp !== previousTimestamp || AppState.isInitialLoad); if (shouldUpdateMap) { console.log(`[UI Update] Triggering AppMap.updateMapView(). Map Visible: ${mapPageVisible}, Timestamp Changed: ${newTimestamp !== previousTimestamp}, Initial Load: ${AppState.isInitialLoad}`); if (window.AppMap && typeof AppMap.updateMapView === 'function') { AppMap.updateMapView(); } else { console.warn("[UI Update] AppMap.updateMapView function not found when trying to update map."); } } else { console.log(`[UI Update] Skipping map update. Map Visible: ${mapPageVisible}, Map Ready: ${AppState.mapReady}, Timestamp Changed: ${newTimestamp !== previousTimestamp}, Initial Load: ${AppState.isInitialLoad}`); } if (AppState.isInitialLoad && data && !error) { AppState.isInitialLoad = false; } } else { if (lastUpdatedElement) { lastUpdatedElement.textContent = 'No data received.'; lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; } if (devicesPageVisible && listElement) AppUI.renderDevicesList([]); } } catch (uiError) { console.error("Error updating device UI:", uiError); const errorMsgElem = document.getElementById('devices-error-message'); if (errorMsgElem) { errorMsgElem.textContent = `UI Error: ${uiError.message}`; errorMsgElem.style.display = 'block'; } } finally { if (devicesPageVisible) { const loadingIndicator = document.getElementById('devices-loading-indicator'); if (loadingIndicator) loadingIndicator.style.display = 'none'; if (listElement) { const noDevMsg = document.getElementById('no-devices-message'); listElement.style.display = (listElement.hasChildNodes() && (!noDevMsg || noDevMsg.style.display === 'none')) ? 'block' : 'none'; } } }
    },

    refreshDevices: async function (triggerBackgroundFetch = false) {

        console.log(`Action: Refresh Devices triggered. (Background Fetch: ${triggerBackgroundFetch})`); const button = document.getElementById('refresh-devices-button'); const listElement = document.getElementById('shared-devices-list'); const loadingIndicator = document.getElementById('devices-loading-indicator'); const lastUpdatedElement = document.getElementById('devices-last-updated'); const noDevicesMessage = document.getElementById('no-devices-message'); const devicesPageVisible = document.getElementById('shared-page')?.style.display !== 'none'; this._stopRefreshPolling(); if (devicesPageVisible) { if (button) { button.disabled = true; if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML; button.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Updating...`; } if (loadingIndicator) loadingIndicator.style.display = 'block'; if (lastUpdatedElement) lastUpdatedElement.textContent = 'Checking status...'; if (noDevicesMessage) noDevicesMessage.style.display = 'none'; if (listElement) listElement.style.display = 'none'; } let initialTimestamp = AppState.lastDeviceUpdateTime ? AppState.lastDeviceUpdateTime.toISOString() : null; try { if (triggerBackgroundFetch) { console.log("[Action Refresh] Manual trigger: Stored initial timestamp:", initialTimestamp); console.log("Triggering background refresh via API..."); try { await AppApi.triggerUserRefresh(); console.log("Background refresh trigger successful."); if (devicesPageVisible && lastUpdatedElement) lastUpdatedElement.textContent = 'Refresh initiated, polling for updates...'; const pollStartTime = Date.now(); const maxPollDuration = 90 * 1000; const pollInterval = 5 * 1000; this._refreshPollingInterval = setInterval(async () => { console.log("[Action Refresh Poll] Polling check..."); try { const pollData = await AppApi.fetchDevices(); const currentTimestamp = pollData?.last_updated || null; if (currentTimestamp && currentTimestamp !== initialTimestamp) { console.log("[Action Refresh Poll] New timestamp detected! Update complete."); this._stopRefreshPolling(); this._updateDeviceUI(pollData, lastUpdatedElement, listElement, noDevicesMessage); } else { console.log(`[Action Refresh Poll] Timestamp unchanged (${currentTimestamp} vs ${initialTimestamp}).`); } } catch (pollError) { console.error("[Action Refresh Poll] Error during poll fetch:", pollError); this._stopRefreshPolling(); this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, pollError); } }, pollInterval); this._refreshPollingTimeout = setTimeout(() => { if (this._refreshPollingInterval) { console.warn("[Action Refresh Poll] Polling timed out."); this._stopRefreshPolling(); if (devicesPageVisible && lastUpdatedElement) lastUpdatedElement.textContent = 'Refresh timed out. Displaying last known status.'; AppApi.fetchDevices().then(finalData => this._updateDeviceUI(finalData, lastUpdatedElement, listElement, noDevicesMessage)).catch(finalError => this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, finalError)); } }, maxPollDuration); return; } catch (triggerError) { console.error("Error triggering background refresh:", triggerError); if (devicesPageVisible && lastUpdatedElement) lastUpdatedElement.textContent = 'Refresh trigger failed.'; this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, triggerError); this._stopRefreshPolling(); return; } } else { console.log("Fetching current device status (interval)..."); const fetchStatusData = await AppApi.fetchDevices(); this._updateDeviceUI(fetchStatusData, lastUpdatedElement, listElement, noDevicesMessage); } } catch (error) { console.error("Error fetching device status (interval):", error); this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, error); } finally { if (devicesPageVisible) { if (loadingIndicator) { loadingIndicator.style.display = 'none'; console.log("[Action Refresh Finally] Hid loading indicator."); } if (!this._refreshPollingInterval && button && button.disabled) { console.log("[Action Refresh Finally] NOT Polling. Resetting button."); button.disabled = false; if (button.dataset.originalHtml) { button.innerHTML = button.dataset.originalHtml; } else { button.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">refresh</span> Update Status`; } } else if (this._refreshPollingInterval) { console.log("[Action Refresh Finally] Polling is active. Button state managed by polling."); } } }
    },
    // --- fetchInitialData (Modified for Theme Sync) ---
    fetchInitialData: async function () {
        console.log("Action: Fetching initial data (devices, geofences, shares, preferences)");
        const listElement = document.getElementById('shared-devices-list');
        const loadingIndicator = document.getElementById('devices-loading-indicator');
        const lastUpdatedElement = document.getElementById('devices-last-updated');
        const noDevicesMessage = document.getElementById('no-devices-message');
        const devicesPageVisible = document.getElementById('shared-page')?.style.display !== 'none';

        if (devicesPageVisible && loadingIndicator) loadingIndicator.style.display = 'block';
        if (devicesPageVisible && listElement) listElement.style.display = 'none';
        if (devicesPageVisible && noDevicesMessage) noDevicesMessage.style.display = 'none';

        try {
            const [geoData, devicesData, sharesData, prefsData] = await Promise.all([
                AppApi.fetchGlobalGeofences().catch(e => { console.error("Failed initial geofence fetch", e); return []; }),
                AppApi.fetchDevices().catch(e => { console.error("Failed initial device fetch", e); return null; }),
                AppApi.fetchUserShares().catch(e => { console.error("Failed initial shares fetch", e); return []; }),
                AppApi.fetchUserPreferences().catch(e => { console.error("Failed initial preferences fetch", e); return null; })
            ]);

            // --- Set preferences first & potentially update native theme ---
            if (prefsData) {
                AppState.setCurrentUserPreferences(prefsData); // Update AppState

                // --- START: Send color to Android if logged in ---
                const isAndroidApp = window.Android && typeof window.Android.updateNativeThemeColor === 'function' && typeof window.Android.isRunningInAndroidApp === 'function' && window.Android.isRunningInAndroidApp();
                // Check login status using AppState.username which should be set by Flask context processor
                const isLikelyLoggedIn = !!window.AppState.username;

                if (isAndroidApp && isLikelyLoggedIn && AppState.userColor) {
                    console.log("[InitData] Logged in on Android, sending user color to native:", AppState.userColor);
                    try {
                        window.Android.updateNativeThemeColor(AppState.userColor); // Call native interface
                    } catch (e) {
                        console.error("Error calling Android.updateNativeThemeColor:", e);
                    }
                } else {
                    console.log(`[InitData] Not sending user color to native: Android=${isAndroidApp}, LoggedIn=${isLikelyLoggedIn}, Color=${AppState.userColor}`);
                }
                // --- END: Send color to Android ---

                // Re-apply theme in case prefs changed from initial localStorage/native load
                if (window.AppTheme && typeof window.AppTheme.applyTheme === 'function') {
                    console.log("[InitData] Re-applying theme based on fetched preferences.");
                    AppTheme.applyTheme(AppState.userColor, AppState.currentTheme);
                }

            } else {
                console.warn("[InitData] Failed to get user preferences, theme relies on defaults/localStorage/native.")
                // Theme was already initialized using local/native color if available, so no extra action needed here.
            }
            // --- -------------------------------------------------------- ---

            AppState.setGlobalGeofences(geoData || []);
            AppState.setUserActiveShares(sharesData || []);
            const deviceFetchError = devicesData ? null : new Error("Failed to fetch device data");
            this._updateDeviceUI(devicesData, lastUpdatedElement, listElement, noDevicesMessage, deviceFetchError);
            AppUI.renderGlobalGeofences();
            AppUI.renderDeviceGeofenceLinks();
            AppUI.renderDevicePageSharesList();
            AppUI.renderActiveSharesList();
            if (window.AppMap && AppState.mapReady) { AppMap.redrawGeofenceLayer(); AppMap.updateMapView(); }

        } catch (error) {
            console.error("Initial data fetch sequence failed:", error);
            if (!devicesData) { this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, error); }
            if (error.code !== 'NO_DEVICE_FILES' && error.code !== 'NO_APPLE_CREDS' && error.status !== 401 && error.status !== 403 && !(error.message && error.message.includes("2FA Required"))) {
                if (window.AppUI) AppUI.showErrorDialog("Initial Load Failed", `Could not load initial data.<br>Details: ${error.message} (${error.code || 'N/A'})`);
            }
        } finally { if (devicesPageVisible && loadingIndicator) { loadingIndicator.style.display = 'none'; } }
    }, // --- End fetchInitialData ---


    refreshGeofencesAndDevices: async function () { console.log("Action: Refreshing Geofences and Devices"); const globalLoading = document.getElementById('global-geofences-loading'); const linksLoading = document.getElementById('device-links-loading'); if (globalLoading) globalLoading.style.display = 'block'; if (linksLoading) linksLoading.style.display = 'block'; try { const geoData = await AppApi.fetchGlobalGeofences(); AppState.setGlobalGeofences(geoData || []); AppUI.renderGlobalGeofences(); await AppActions.refreshDevices(); AppUI.renderDeviceGeofenceLinks(); if (window.AppMap) AppMap.redrawGeofenceLayer(); } catch (error) { console.error("Error refreshing geofences/devices:", error); if (error.code !== 'NO_DEVICE_FILES' && error.code !== 'NO_APPLE_CREDS') { if (window.AppUI) AppUI.showErrorDialog("Data Load Error", `Could not load geofence/device data.<br>Details: ${error.message} (${error.code || 'N/A'})`); } } finally { if (globalLoading) globalLoading.style.display = 'none'; if (linksLoading) linksLoading.style.display = 'none'; } },
    handleRemoveDevice: async function (deviceId) { const device = AppState.getDeviceDisplayInfo(deviceId); const deviceName = device?.name || deviceId; console.log(`[Action] Confirmed removal for device ${deviceId} (${deviceName})`); AppUI.showConfirmationDialog("Deleting...", `Removing device "${deviceName}" and its data...`, null, null); const progressDialog = document.getElementById('confirmation-dialog'); if (progressDialog) progressDialog.querySelector('.dialog-actions').style.display = 'none'; try { const result = await AppApi.deleteDevice(deviceId); console.log(`[Action] Device removal API result for ${deviceId}:`, result); AppUI.closeDialog('confirmation-dialog'); AppState.currentDeviceData = AppState.currentDeviceData.filter(d => d.id !== deviceId); if (AppState.deviceMarkers[deviceId]) { const map = AppState.getMap(); if (map && map.hasLayer(AppState.deviceMarkers[deviceId])) { map.removeLayer(AppState.deviceMarkers[deviceId]); } delete AppState.deviceMarkers[deviceId]; } AppMap.clearDeviceHistoryLayer(deviceId); if (deviceId in AppState.deviceVisibility) { delete AppState.deviceVisibility[deviceId]; AppState.saveDeviceVisibilityState(); } AppUI.showConfirmationDialog("Device Removed", result.message || `Device "${deviceName}" removed successfully.`); AppUI.renderDevicesList(AppState.getCurrentDeviceData()); if (document.getElementById('geofences-page')?.style.display === 'block') { AppUI.renderDeviceGeofenceLinks(); } if (document.getElementById('index-page')?.style.display !== 'none') { AppMap.updateMapView(); } } catch (error) { AppUI.closeDialog('confirmation-dialog'); console.error("Error removing device:", error); AppUI.showErrorDialog("Removal Failed", `Could not remove device "${deviceName}".<br>Details: ${error.message}`); } },
    handleEditDeviceSubmit: async function () { const id = document.getElementById('edit-device-id').value; const nameInput = document.getElementById('edit-device-name').value.trim(); const label = document.getElementById('edit-device-label').value.trim(); const color = document.getElementById('edit-device-color').value; if (!id) return; const name = nameInput || document.getElementById('edit-device-name').placeholder || id; const payload = { name: name, label: label || '❓', color: color }; const saveButton = document.getElementById('save-device-edit-button'); if (!saveButton) return; saveButton.disabled = true; saveButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>`; try { const updatedConfig = await AppApi.updateDeviceDisplay(id, payload); console.log("Save successful, updated display info:", updatedConfig); const dataIndex = AppState.currentDeviceData.findIndex(d => d.id === id); if (dataIndex > -1) { const existingGeofences = AppState.currentDeviceData[dataIndex].geofences || []; AppState.currentDeviceData[dataIndex] = { ...AppState.currentDeviceData[dataIndex], ...updatedConfig, geofences: updatedConfig.geofences || existingGeofences }; } else { console.warn("Edited device not found in local data cache after save."); await AppActions.refreshDevices(); } if (document.getElementById('shared-page')?.style.display !== 'none') { AppUI.renderDevicesList(AppState.getCurrentDeviceData()); } if (document.getElementById('geofences-page')?.style.display !== 'none') { AppUI.renderDeviceGeofenceLinks(); } if (document.getElementById('index-page')?.style.display !== 'none' && window.AppMap) { AppMap.updateMapView(); } AppUI.closeDialog('edit-device-dialog'); AppUI.showConfirmationDialog("Device Updated", `Display settings for "${updatedConfig.name}" saved.`); } catch (error) { console.error("Error saving device config:", error); if (window.AppUI) AppUI.showErrorDialog("Save Failed", `Could not save settings.<br>Details: ${error.message}`); } finally { if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = 'Save Display Info'; } } },
    handleGeofenceDialogSubmit: async function () { const editId = document.getElementById('geofence-edit-id').value; const isEditing = !!editId; const name = document.getElementById('geofence-name').value.trim(); const radius = parseFloat(document.getElementById('geofence-radius').value); const lat = parseFloat(document.getElementById('geofence-lat').value); const lng = parseFloat(document.getElementById('geofence-lng').value); if (!name) { if (window.AppUI) AppUI.showErrorDialog("Input Required", "Geofence name cannot be empty."); return; } if (isNaN(lat) || isNaN(lng)) { if (window.AppUI) AppUI.showErrorDialog("Input Required", "Please select a location on the map."); return; } if (isNaN(radius) || radius <= 0) { if (window.AppUI) AppUI.showErrorDialog("Input Required", "Please enter a valid positive radius."); return; } const geofenceData = { name, lat, lng, radius }; const saveButton = document.getElementById('geofence-dialog-save-button'); if (!saveButton) return; saveButton.disabled = true; saveButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>`; try { let savedGeofence; if (isEditing) { savedGeofence = await AppApi.updateGeofence(editId, geofenceData); const index = AppState.globalGeofenceData.findIndex(gf => gf.id === editId); if (index > -1) AppState.globalGeofenceData[index] = savedGeofence; else AppState.globalGeofenceData.push(savedGeofence); } else { savedGeofence = await AppApi.createGeofence(geofenceData); AppState.globalGeofenceData.push(savedGeofence); } AppState.globalGeofenceData.sort((a, b) => a.name.localeCompare(b.name)); console.log(`Global geofence ${isEditing ? 'updated' : 'created'} successfully.`); AppUI.renderGlobalGeofences(); AppUI.renderDeviceGeofenceLinks(); if (window.AppMap) AppMap.redrawGeofenceLayer(); AppUI.closeDialog('geofence-dialog'); AppUI.showConfirmationDialog(`Geofence ${isEditing ? 'Updated' : 'Created'}`, `Geofence "${savedGeofence.name}" saved.`); } catch (error) { console.error(`Error ${isEditing ? 'updating' : 'creating'} geofence:`, error); if (error.status === 409) { if (window.AppUI) AppUI.showErrorDialog("Name Conflict", error.message || "A geofence with this name already exists."); } else { if (window.AppUI) AppUI.showErrorDialog("Save Failed", `Could not save geofence.<br>Details: ${error.message}`); } } finally { if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = `Save Geofence`; } } },
    handleRemoveGlobalGeofence: async function (geofenceId) { const geofenceToRemove = AppState.globalGeofenceData.find(gf => gf.id === geofenceId); if (!geofenceToRemove) { if (window.AppUI) AppUI.showErrorDialog("Error", "Geofence not found in local data."); return; } console.log(`Confirmed removal for ${geofenceId}`); try { const result = await AppApi.deleteGeofence(geofenceId); AppState.globalGeofenceData = AppState.globalGeofenceData.filter(gf => gf.id !== geofenceId); console.log(`Global geofence "${geofenceToRemove.name}" removed successfully.`); if (window.AppUI) AppUI.showConfirmationDialog("Geofence Removed", result.message || `Geofence "${geofenceToRemove.name}" removed.`); AppUI.renderGlobalGeofences(); if (window.AppMap) AppMap.redrawGeofenceLayer(); AppActions.refreshDevices().then(() => { if (document.getElementById('geofences-page')?.style.display === 'block') { AppUI.renderDeviceGeofenceLinks(); } }); } catch (error) { console.error("Error removing global geofence:", error); if (window.AppUI) AppUI.showErrorDialog("Removal Failed", `Could not remove geofence.<br>Details: ${error.message}`); } },
    handleSaveDeviceGeofenceLinks: async function (deviceId, cardElement) { const saveButton = cardElement.querySelector('.save-links-button'); if (!saveButton) return; saveButton.disabled = true; saveButton.innerHTML = `<div class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin: 0 auto;"></div>`; const linkItems = cardElement.querySelectorAll('.geofence-link-item'); const updatedLinksPayload = Array.from(linkItems).map(item => { const gfId = item.dataset.geofenceId; const notifyEntryInput = item.querySelector('input[data-notify-type="entry"]'); const notifyExitInput = item.querySelector('input[data-notify-type="exit"]'); const entryValue = notifyEntryInput?.checked ?? false; const exitValue = notifyExitInput?.checked ?? false; return { id: gfId, notify_entry: entryValue, notify_exit: exitValue }; }); const deviceName = AppState.getDeviceDisplayInfo(deviceId).name; try { const responseData = await AppApi.updateDeviceGeofenceLinks(deviceId, updatedLinksPayload); const dataIndex = AppState.currentDeviceData.findIndex(d => d.id === deviceId); if (dataIndex > -1) { AppState.currentDeviceData[dataIndex].geofences = responseData.linked_geofences || []; console.log(`[UI Save Links - ${deviceId}] Updated local AppState geofences based on API response:`, AppState.currentDeviceData[dataIndex].geofences); } else { console.warn(`[UI Save Links] Device ${deviceId} not found in cache after saving links. Full refresh might be needed.`); } console.log("[UI Save Links] Device links saved successfully via API."); AppUI.showConfirmationDialog("Links Saved", `Geofence links and notifications for ${deviceName} saved.`); saveButton.style.display = 'none'; AppUI.renderAddGeofenceDropdown(cardElement, deviceId); } catch (error) { console.error("[UI Save Links] Error saving device links:", error); AppUI.showErrorDialog("Save Failed", `Could not save geofence links.<br>Details: ${error.message}`); } finally { if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">save</span> Save Changes`; } } },
    _debouncedSearchHandler: null,
    performSearch: async function (query) { if (query.length < 2) { AppUI.renderSearchResults([], 'search-results-container'); AppUI.hideSearchResults('search-results-container'); return; } console.log("Performing search for:", query); let results = []; const lowerQuery = query.toLowerCase(); const isAndroidApp = window.Android && typeof window.Android.isRunningInAndroidApp === 'function' && window.Android.isRunningInAndroidApp(); const appActions = [{ type: 'action', target: 'settings', name: 'Settings', keywords: ['settings', 'theme', 'history', 'map defaults', 'config'], icon: 'settings' }, { type: 'action', target: 'geofences', name: 'Geofences', keywords: ['geofence', 'fence', 'area', 'zone', 'boundary'], icon: 'location_searching' }, { type: 'action', target: 'shared', name: 'Devices', keywords: ['device', 'item', 'accessory', 'shared', 'list'], icon: 'devices' }, { type: 'action', target: 'notifications-history', name: 'Notification History', keywords: ['notification', 'alert', 'message'], icon: 'history_toggle_off' }, { type: 'action', target: 'dialog:help-dialog', name: 'Help & Feedback', keywords: ['help', 'info', 'guide', 'feedback'], icon: 'help_outline' }, { type: 'action', target: 'manage_apple_creds', name: 'Manage Apple Credentials', keywords: ['apple', 'credential', 'password', 'account', 'login'], icon: 'security' }, { type: 'action', target: 'settings', section: 'settings-upload-section', name: 'Upload Device Files', keywords: ['upload', 'file', 'key', 'plist', 'add device'], icon: 'upload_file' }, { type: 'action', target: 'settings', section: 'settings-import-export', name: 'Import/Export Config (Backup)', keywords: ['import', 'export', 'config', 'backup', 'restore', 'setting'], icon: 'import_export' }, { type: 'action', target: 'index', name: 'Map View', keywords: ['map', 'view', 'overview'], icon: 'map' }, { type: 'action', target: 'settings', section: 'settings-notifications', name: 'Notifications (Settings)', keywords: ['notifications'], icon: 'notifications' }, { type: 'action', target: 'settings', section: 'settings-account-management', name: 'Delete Account', keywords: ['delete', 'remove', 'account', 'danger'], icon: 'delete_forever' }, ...(isAndroidApp ? [] : [{ type: 'action', target: 'scanner', name: 'Web Scanner', keywords: ['scan', 'bluetooth', 'web', 'nearby'], icon: 'radar' }])]; appActions.forEach(action => { if (action.name.toLowerCase().includes(lowerQuery) || action.keywords.some(k => k.includes(lowerQuery))) { results.push({ ...action, description: action.description || `Go to ${action.name}` }); } }); AppState.getCurrentDeviceData().forEach(device => { const displayInfo = AppState.getDeviceDisplayInfo(device.id); if (displayInfo.name.toLowerCase().includes(lowerQuery) || device.id.toLowerCase().includes(lowerQuery)) { results.push({ type: 'device', id: device.id, name: displayInfo.name, description: displayInfo.status || 'Device', icon: 'devices', svg_icon: displayInfo.svg_icon }); } }); AppState.getGlobalGeofences().forEach(gf => { if (gf.name.toLowerCase().includes(lowerQuery)) { results.push({ type: 'geofence', id: gf.id, name: gf.name, description: `Radius: ${gf.radius}m`, icon: 'location_searching' }); } }); try { const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=4`; const appVersion = window.AppConfig?.APP_VERSION || '?.?.?'; const response = await fetch(url, { headers: { 'User-Agent': `FindMyWebApp/${appVersion}` } }); if (!response.ok) { console.error(`Nominatim search failed: ${response.status}`); } else { const nominatimData = await response.json(); nominatimData.forEach(loc => { results.push({ type: 'location', query: loc.display_name, name: loc.display_name.split(',')[0], description: loc.display_name, icon: 'travel_explore', lat: parseFloat(loc.lat), lng: parseFloat(loc.lon) }); }); } } catch (error) { console.error("Nominatim search error during global search:", error); } AppUI.renderSearchResults(results, 'search-results-container'); AppUI.showSearchResults('search-results-container'); },
    initDebouncedSearch: function () { if (window.AppUtils && typeof AppUtils.debounce === 'function') { this._debouncedSearchHandler = AppUtils.debounce(this.performSearch, 350); } else { console.error("AppUtils or AppUtils.debounce not found! Search debouncing will not work."); this._debouncedSearchHandler = this.performSearch; } },
    handleExportConfig: async function () {
        const checkboxes = document.querySelectorAll('#export-parts-selection input[name="export_part"]:checked');
        const selectedParts = Array.from(checkboxes).map(cb => cb.value);
        if (selectedParts.length === 0) { if (window.AppUI) AppUI.showErrorDialog("Export Error", "Please select at least one part to export."); return; }

        const exportData = {
            export_format: "findmyapp_combined_v1", // Keep format version
            app_version: window.AppConfig?.APP_VERSION || "?.?.?",
            timestamp: new Date().toISOString(),
            client: {},
            server: {}
        };
        const errors = [];

        if (window.AppUI) AppUI.showConfirmationDialog("Exporting...", "Gathering configuration data...", null, null);

        // Client-side data (remains the same)
        if (selectedParts.includes('clientSettings')) { exportData.client.clientSettings = { theme: AppState.currentTheme, userColor: AppState.userColor, isShowingAllDevices: AppState.isShowingAllDevices, showDeviceHistory: AppState.showDeviceHistory, historyTimeFilterHours: AppState.historyTimeFilterHours, locationHistoryEnabled: AppState.locationHistoryEnabled }; }
        if (selectedParts.includes('savedPlaces')) { exportData.client.savedPlaces = AppState.savedPlaces; }
        if (selectedParts.includes('locationHistory')) { exportData.client.locationHistory = AppState.locationHistory; }
        if (selectedParts.includes('deviceVisibility')) { exportData.client.deviceVisibility = AppState.deviceVisibility; }

        // Server-side data

        const serverPartsToFetch = selectedParts.filter(p => ['devices', 'geofences', 'shares'].includes(p));


        if (serverPartsToFetch.length > 0) {
            try {
                for (const part of serverPartsToFetch) {
                    console.log(`Fetching server part: ${part}`);

                    let partData;
                    if (part === 'shares') {
                        partData = await AppApi.fetchUserShares(); // Assuming fetchUserShares returns all necessary data for export
                    } else {
                        partData = await AppApi.getConfigPart(part);
                    }

                    exportData.server[part] = partData;
                }
            } catch (error) {
                console.error("Error fetching server config parts for export:", error);
                errors.push(`Failed to fetch server part (${error.message})`);
            }
        }

        if (window.AppUI) AppUI.closeDialog('confirmation-dialog');
        if (errors.length > 0) { if (window.AppUI) AppUI.showErrorDialog("Export Failed", `Could not gather all selected configuration parts.<br>Errors: ${errors.join(', ')}`); return; }
        if (Object.keys(exportData.client).length === 0 && Object.keys(exportData.server).length === 0) { if (window.AppUI) AppUI.showErrorDialog("Export Error", "No data was gathered for the selected parts."); return; }

        try {
            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const filename = `findmyapp_config_${timestamp}.json`;
            const link = document.createElement('a');
            link.href = window.URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(link.href);
            console.log(`Config exported successfully as ${filename}`);
        } catch (error) {
            console.error("Error triggering config download:", error);
            if (window.AppUI) AppUI.showErrorDialog("Download Failed", `Could not create download file.<br>Details: ${error.message}`);
        }
    },
    handleImportFileSelected: async function (file) {
        console.log("[Action] Processing selected import file (handleImportFileSelected)...");
        const statusMessage = document.getElementById('dialog-import-status-message');
        const partsSelectionDiv = document.getElementById('dialog-import-parts-selection');
        const confirmButton = document.getElementById('dialog-confirm-import-button');

        if (!statusMessage || !partsSelectionDiv || !confirmButton) { console.error("[Action Import] Dialog UI elements missing. Aborting file processing."); if (window.AppUI) AppUI.resetImportDialog(); return; }
        AppState.clearImportData(); partsSelectionDiv.style.display = 'none'; partsSelectionDiv.innerHTML = '<h4 class="settings-section-title">Select Parts to Import</h4>'; confirmButton.style.display = 'none'; confirmButton.disabled = true; statusMessage.textContent = 'Reading file...'; statusMessage.style.color = 'inherit';
        console.log(`[Action Import] Reading import file: ${file.name}`);
        try {
            const fileContent = await file.text(); console.log("[Action Import] Import file read.");
            const parsedData = JSON.parse(fileContent); AppState.setImportData(parsedData); console.log("[Action Import] Import file parsed:", parsedData);
            if (!parsedData.export_format || !parsedData.export_format.startsWith('findmyapp_combined_')) { throw new Error(`Unsupported format: ${parsedData.export_format || 'Unknown'}.`); }
            console.log(`[Action Import] Format validated: ${parsedData.export_format}`);
            const availableParts = {};

            const partDefinitions = {
                clientSettings: { name: 'UI/Map/Theme Settings', data: parsedData.client?.clientSettings },
                savedPlaces: { name: `Saved Places`, data: parsedData.client?.savedPlaces },
                locationHistory: { name: `Location History`, data: parsedData.client?.locationHistory },
                deviceVisibility: { name: `Device Visibility`, data: parsedData.client?.deviceVisibility },
                devices: { name: `Device Configs`, data: parsedData.server?.devices },
                geofences: { name: `Geofences`, data: parsedData.server?.geofences },
                shares: { name: `Shared Links`, data: parsedData.server?.shares } // New part
            };

            let hasParts = false;
            console.log("[Action Import] Checking available parts in JSON...");
            console.log("[Action Import] Parsed Client Data:", parsedData.client);
            console.log("[Action Import] Parsed Server Data:", parsedData.server);
            for (const partKey in partDefinitions) {
                const partInfo = partDefinitions[partKey];

                const dataToCheck = partKey.startsWith('client') ? parsedData.client?.[partKey] :
                    (partKey === 'shares' ? parsedData.server?.shares : parsedData.server?.[partKey]);

                let count = 0;
                if (dataToCheck !== null && dataToCheck !== undefined) {
                    if (Array.isArray(dataToCheck)) {
                        count = dataToCheck.length;
                    } else if (typeof dataToCheck === 'object' && Object.keys(dataToCheck).length > 0) {
                        count = Object.keys(dataToCheck).length;
                    } else if (typeof dataToCheck !== 'object' && !Array.isArray(dataToCheck)) {
                        count = 1;
                    } else if (typeof dataToCheck === 'object' && count === 0) {
                        count = 1; console.log(`[Action Debug] Part ${partKey} is an object, counting as 1.`);
                    }
                }
                console.log(`[Action Debug] Part: ${partKey}, Count: ${count}`);
                if (count > 0) {
                    availableParts[partKey] = `${partInfo.name}${(Array.isArray(dataToCheck) && partKey !== 'clientSettings' && partKey !== 'deviceVisibility') ? ` (${count})` : ''}`;
                    hasParts = true;
                }
            }
            console.log("[Action Import] Finished checking parts. Has parts:", hasParts, "Available:", availableParts);
            if (hasParts) {
                const fileInfoTime = parsedData.timestamp ? AppUtils.formatTimeRelative(new Date(parsedData.timestamp)) : 'N/A';
                statusMessage.textContent = `File Read. Format: ${parsedData.export_format}, Ver: ${parsedData.app_version || 'N/A'}, Created: ${fileInfoTime}`;
                partsSelectionDiv.innerHTML = '<h4 class="settings-section-title">Select Parts to Import</h4>';
                Object.keys(availableParts).forEach(partKey => {
                    const labelText = availableParts[partKey];
                    const label = document.createElement('label');
                    label.innerHTML = `<input type="checkbox" name="dialog_import_part" value="${partKey}" checked> ${labelText}`;
                    partsSelectionDiv.appendChild(label); console.log(`[Action UI] Added checkbox for: ${partKey}`);
                });
                partsSelectionDiv.style.display = 'block'; confirmButton.style.display = 'inline-flex'; confirmButton.disabled = false; console.log("[Action UI] Checkbox container and confirm button displayed.");
            } else {
                statusMessage.textContent = "No importable parts found in this file."; statusMessage.style.color = 'var(--m3-sys-color-error)'; console.warn("[Action] No importable parts identified in the file."); confirmButton.style.display = 'none'; confirmButton.disabled = true;
            }
        } catch (error) {
            console.error("[Action] Error reading or parsing import file:", error); statusMessage.textContent = `Error reading file: ${error.message}`; statusMessage.style.color = 'var(--m3-sys-color-error)'; AppState.clearImportData(); if (partsSelectionDiv) partsSelectionDiv.style.display = 'none'; if (confirmButton) { confirmButton.style.display = 'none'; confirmButton.disabled = true; }
        }
    },
    handleImportConfirm: async function () {
        console.log("[Action] Confirm Import button clicked.");
        const statusMessage = document.getElementById('dialog-import-status-message');
        const partsSelectionDiv = document.getElementById('dialog-import-parts-selection');
        const confirmButton = document.getElementById('dialog-confirm-import-button');

        if (!statusMessage || !partsSelectionDiv || !confirmButton) {
            console.error("[Action Import] Dialog confirm UI elements missing.");
            return;
        }

        const selectedParts = Array.from(partsSelectionDiv.querySelectorAll('input[name="dialog_import_part"]:checked')).map(cb => cb.value);
        const importedData = AppState.getImportData();

        if (selectedParts.length === 0) {
            statusMessage.textContent = "Please select at least one part to import.";
            statusMessage.style.color = 'var(--m3-sys-color-error)';
            return;
        }

        if (!importedData) {
            statusMessage.textContent = "Import data not found. Please select file again.";
            statusMessage.style.color = 'var(--m3-sys-color-error)';
            AppUI.resetImportDialog();
            return;
        }

        confirmButton.disabled = true;
        confirmButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Checking...`;
        statusMessage.textContent = `Checking for potential overwrites...`;
        statusMessage.style.color = 'inherit';

        let needsOverwriteConfirm = false;
        let overwriteItems = [];
        const getPartName = (partKey) => ({ devices: 'Device configurations', geofences: 'Geofences', savedPlaces: 'Saved Places', locationHistory: 'Location History', clientSettings: 'UI/Map/Theme settings', deviceVisibility: 'Device visibility' }[partKey] || partKey);
        const hasExisting = (partKey) => {
            switch (partKey) {
                case 'devices': return AppState.currentDeviceData.length > 0;
                case 'geofences': return AppState.globalGeofenceData.length > 0;
                case 'savedPlaces': return AppState.savedPlaces.length > 0;
                case 'locationHistory': return AppState.locationHistory.length > 0;
                case 'clientSettings': return true;
                case 'deviceVisibility': return Object.keys(AppState.deviceVisibility).length > 0;
                default: return false;
            }
        };

        selectedParts.forEach(partKey => {
            const dataToCheck = partKey.startsWith('client') ? importedData.client?.[partKey] : importedData.server?.[partKey];
            if (dataToCheck !== undefined && dataToCheck !== null && hasExisting(partKey)) {
                const partName = getPartName(partKey);
                if (!overwriteItems.includes(partName)) {
                    needsOverwriteConfirm = true;
                    overwriteItems.push(partName);
                }
            }
        });

        // --- Close the import dialog *BEFORE* showing the confirmation or proceeding ---
        console.log("[Action] Closing import dialog ('config-import-dialog') before further action.");
        AppUI.closeDialog('config-import-dialog'); // Close the import dialog unconditionally now

        if (needsOverwriteConfirm) {
            const confirmationMessage = `Importing selected parts (${overwriteItems.join(', ')}) will <strong>completely replace</strong> existing data for those parts. Continue?`;
            console.log("[Action] Showing overwrite confirmation.");
            AppUI.showConfirmationDialog("Confirm Overwrite", confirmationMessage, () => {
                console.log("[Action] Overwrite confirmed.");
                AppUI.showConfirmationDialog("Importing...", "Processing selected parts...", null, null); // Simple processing dialog
                setTimeout(() => AppActions._proceedWithImport(selectedParts, importedData), 50);
            }, () => {
                console.log("[Action] Overwrite cancelled by user.");
                // Import dialog is already closed. User can re-open from settings if they wish.
            });
        } else {
            console.log("[Action] No overwrite needed. Proceeding directly.");
            AppUI.showConfirmationDialog("Importing...", "Processing selected parts...", null, null); // Simple processing dialog
            setTimeout(() => AppActions._proceedWithImport(selectedParts, importedData), 50);
        }
    },
    _proceedWithImport: async function (selectedParts, importedData) {
        console.log("[Action] Proceeding with import processing for parts:", selectedParts);
        let clientImported = false;
        let serverImported = false;
        const serverPartsPayload = {};
        const clientErrors = [];
        const serverErrors = [];

        AppUI.closeDialog('confirmation-dialog'); // Close the 'processing' dialog

        console.log("[Action] Processing client parts FIRST (apply locally AND save)...");
        let themeUpdateSuccessful = false; // Track if theme part was successfully processed

        try {
            // --- Handle Client Settings Separately ---
            if (selectedParts.includes('clientSettings') && importedData.client?.clientSettings) {
                console.log("[Action] Processing client settings for import...");
                const settings = importedData.client.clientSettings;

                // --- Log Raw Imported Data ---
                console.log("[Action Import Debug] Raw imported settings object:", JSON.stringify(settings));

                console.log(`[Action Import Debug] Raw imported theme: '${settings?.theme}'`);
                console.log(`[Action Import Debug] Raw imported userColor: '${settings?.userColor}'`);

                // --- ----------------------- ---

                // --- Read imported values using CORRECT keys, apply defaults *only if missing/invalid* ---

                let importedThemeMode = settings?.theme;
                let importedUserColor = settings?.userColor;


                // Validate theme mode
                if (!importedThemeMode || !['system', 'light', 'dark'].includes(importedThemeMode)) {

                    console.warn(`[Action Import] Invalid/missing theme mode '${settings?.theme}'. Defaulting to 'system'.`);
                    importedThemeMode = 'system';
                }

                // Validate theme color
                if (!importedUserColor || !/^#[0-9a-fA-F]{6}$/.test(importedUserColor)) {
                    const defaultColor = window.AppTheme ? AppTheme.DEFAULT_SOURCE_COLOR : '#4285F4';

                    console.warn(`[Action Import] Invalid/missing userColor '${settings?.userColor}'. Defaulting to '${defaultColor}'.`);
                    importedUserColor = defaultColor;
                }
                // --- End Validation ---

                console.log(`[Action Import Debug] Effective themeMode: ${importedThemeMode}, Effective userColor: ${importedUserColor}`);

                // --- 1. SAVE Correct imported settings to backend FIRST ---
                console.log(`[Action] Saving IMPORTED theme preferences to backend: Mode=${importedThemeMode}, Color=${importedUserColor}`);
                try {
                    await AppApi.updateUserPreferences(importedThemeMode, importedUserColor);
                    console.log("[Action] Imported theme preferences saved successfully to backend.");
                    themeUpdateSuccessful = true;

                    // --- 2. UPDATE AppState with imported values AFTER successful save ---
                    AppState.currentTheme = importedThemeMode;
                    AppState.userColor = importedUserColor;
                    AppState.saveTheme(); // Save to localStorage

                    // --- 3. UPDATE UI CONTROLS *IMMEDIATELY* ---
                    console.log("[Action] Updating UI controls with imported theme values...");
                    const colorPicker = document.getElementById('theme-color-picker');
                    if (colorPicker) {
                        colorPicker.value = AppState.userColor;
                        console.log(`[Action UI Update] Set color picker value to: ${colorPicker.value}`);
                    } else { console.warn("[Action UI Update] Color picker not found."); }

                    document.querySelectorAll('input[name="theme"]').forEach(radio => {
                        radio.checked = (radio.value === AppState.currentTheme);
                        console.log(`[Action UI Update] Radio ${radio.value} checked: ${radio.checked}`);
                    });
                    if (document.getElementById('settings-page')?.style.display === 'block') {
                        document.querySelectorAll('input[name="theme-dialog"]').forEach(radio => {
                            radio.checked = (radio.value === AppState.currentTheme);
                        });
                    }

                    // --- 4. APPLY the imported theme visually ---
                    if (window.AppTheme && typeof window.AppTheme.applyTheme === 'function') {
                        AppTheme.applyTheme(AppState.userColor, AppState.currentTheme);
                        console.log("[Action] Applied imported theme visually.");
                    } else { console.warn("[Action] AppTheme.applyTheme not available."); }

                    clientImported = true; // Mark client part as processed

                } catch (e) {
                    const errorMsg = `Failed to save imported theme preferences to backend: ${e.message}`;
                    serverErrors.push(errorMsg);
                    console.error("[Action] Theme preferences save API error (backend):", e);
                    themeUpdateSuccessful = false;
                }
            } // End clientSettings processing

            // --- Apply other client settings locally (Keep as before) ---
            if (selectedParts.includes('savedPlaces') && importedData.client?.savedPlaces) { console.log("[Action] Importing saved places (local)..."); AppState.savedPlaces = importedData.client.savedPlaces; AppState.saveSavedPlaces(); clientImported = true; }
            if (selectedParts.includes('locationHistory') && importedData.client?.locationHistory) { console.log("[Action] Importing location history (local)..."); AppState.locationHistory = importedData.client.locationHistory; AppState.saveLocationHistory(); clientImported = true; }
            if (selectedParts.includes('deviceVisibility') && importedData.client?.deviceVisibility) { console.log("[Action] Importing device visibility (local)..."); AppState.deviceVisibility = importedData.client.deviceVisibility; AppState.saveDeviceVisibilityState(); clientImported = true; }

        } catch (e) {
            clientErrors.push(`Client settings import processing failed: ${e.message}`);
            console.error("[Action] Client import processing error:", e);
        }

        // --- Server Parts Processing (Keep as before) ---
        console.log("[Action] Preparing server parts for API call...");
        if (selectedParts.includes('devices') && importedData.server?.devices) serverPartsPayload.devices = importedData.server.devices;
        if (selectedParts.includes('geofences') && importedData.server?.geofences) serverPartsPayload.geofences = importedData.server.geofences;
        if (selectedParts.includes('shares') && Array.isArray(importedData.server?.shares)) {
            serverPartsPayload.shares = importedData.server.shares;
        }

        const hasServerParts = Object.keys(serverPartsPayload).length > 0;
        if (hasServerParts) {
            console.log("[Action] Sending server config parts to backend:", Object.keys(serverPartsPayload));
            serverImported = true;
            try {
                const serverResult = await AppApi.applyImportedConfig(serverPartsPayload);
                console.log("[Action] Server config import response:", serverResult);
                if (serverResult.details?.errors?.length > 0) serverErrors.push(...serverResult.details.errors);
            } catch (e) {
                serverErrors.push(`Server config import API call failed: ${e.message}`);
                console.error("[Action] Server config import API error:", e);
            }
        }

        // --- Final Reporting and UI Refresh (Keep as before) ---
        let finalMessage = "";
        let isSuccess = false;
        if (clientErrors.length === 0 && serverErrors.length === 0) {
            if (clientImported || serverImported) { finalMessage = "Import complete."; isSuccess = true; }
            else { finalMessage = "Import finished, but no changes were selected or applied."; isSuccess = true; }
        } else {
            finalMessage = "Import completed with errors: " + [...clientErrors, ...serverErrors].join('; '); isSuccess = false;
        }

        if (isSuccess) {
            AppUI.showConfirmationDialog("Import Result", finalMessage, () => {
                if (clientImported || serverImported) {
                    console.log("[Action] Refreshing UI and data after successful import confirmation...");
                    AppUI.setupSettingsPage();
                    AppActions.fetchInitialData();
                }
            });
        } else {
            AppUI.showErrorDialog("Import Failed", finalMessage);
        }
    },
    handleDeleteAccount: async function () {
        console.log("Account deletion confirmed by user. Calling API..."); AppUI.showConfirmationDialog("Deleting...", "Deleting your account and data...", null, null); const progressDialog = document.getElementById('confirmation-dialog'); if (progressDialog) progressDialog.querySelector('.dialog-actions').style.display = 'none'; try { const result = await AppApi.deleteAccount(); console.log("Account deletion successful on backend:", result); console.log("Account deleted. Logging out and redirecting..."); localStorage.removeItem('isShowingAllDevices'); localStorage.removeItem('showDeviceHistory'); localStorage.removeItem('historyTimeFilterHours'); localStorage.removeItem('deviceVisibility'); localStorage.removeItem('locationHistoryEnabled'); localStorage.removeItem('locationHistory'); localStorage.removeItem('savedPlaces'); localStorage.removeItem('theme'); localStorage.removeItem('userColor'); localStorage.removeItem('lastActivePageId'); console.log("Cleared user-specific localStorage items."); window.location.href = '/logout'; } catch (error) { console.error("Account deletion failed:", error); AppUI.closeDialog('confirmation-dialog'); AppUI.showErrorDialog("Deletion Failed", `Could not delete account: ${error.message}`); }
    },
};


async function initializeApp() {
    console.log(`FindMy App (${window.AppConfig?.APP_VERSION || '?.?.?'}) Initializing...`);
    function addLoadingClass() { if (document.body) { document.body.classList.add('app-loading'); } else { requestAnimationFrame(addLoadingClass); } } addLoadingClass();
    const m3UtilsLocalPath = '/static/libs/material-color/material-color-utilities.esm.js';
    try { await loadLocalModuleFallback(m3UtilsLocalPath, 'M3ColorUtils'); } catch (err) { console.error("Critical error loading Material Color Utilities.", err); }

    AppState.loadInitialState(); // Load theme prefs, toggles etc first

    // Fetch user prefs early for themeing
    try {
        // --- Use window.username injected from Flask ---
        const flaskUsername = '{{ username }}'; // Get username directly
        console.log("[Init] Username from Flask:", flaskUsername ? `<set: ${flaskUsername}>` : '<not set>');
        window.AppState.username = flaskUsername || null; // Store in AppState
        // --- -------------------------------------- ---

        const prefs = await AppApi.fetchUserPreferences(); // Await prefs
        AppState.setCurrentUserPreferences(prefs);
    } catch (error) {
        console.error("Failed to fetch user preferences:", error);
        window.AppState.username = null; // Ensure username is null on error
        // Use defaults already set in AppState
    }

    // Initialize theme *after* loading preferences
    if (window.AppTheme && typeof window.AppTheme.initializeTheme === 'function') {
        AppTheme.initializeTheme();
    } else {
        console.error("AppTheme init error.");
        const isDarkFallback = AppTheme.isDarkModeActive(AppState.currentTheme);
        document.documentElement.classList.add(isDarkFallback ? 'dark-theme' : 'light-theme');
    }

    // --- Setup UI AFTER theme initialization ---
    AppUI.setupNavigation();
    AppUI.setupSettingsPage();
    AppActions.initDebouncedSearch();
    // --- --------------------------------- ---

    try {
        console.log("[Init] Starting fetchInitialData...");
        await AppActions.fetchInitialData();
        console.log("[Init] fetchInitialData COMPLETED.");
    } catch (err) {
        console.error("[Init] Initial data fetch failed:", err);
    }
    const initialPageId = AppState.getLastActivePageId();
    if (initialPageId === 'index') {
        if (window.AppMap && typeof window.AppMap.initMap === 'function') {
            AppMap.initMap();
        } else {
            console.error("AppMap or AppMap.initMap not found!");
            if (window.AppUI) AppUI.showErrorDialog("Map Error", "Could not load map component.");
        }
    } else {
        console.log("Skipping initial map load as not starting on map page.");
    }
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const pageParam = urlParams.get('page');
        if (pageParam) {
            const validPages = ['index', 'shared', /*'scanner',*/ 'geofences', 'settings', 'notifications-history']; // Remove 'scanner' temporarily if broken
            if (validPages.includes(pageParam)) { AppUI.changePage(pageParam); }
            else { console.warn(`[Init] Invalid page parameter '${pageParam}'. Navigating to default.`); AppUI.navigateToInitialPage(); }
        } else { AppUI.navigateToInitialPage(); }
    } catch (e) { console.error("[Init] Error handling initial page navigation:", e); AppUI.navigateToInitialPage(); }
    if (window.AppNotifications) {
        AppNotifications.registerServiceWorker().then(() => console.log("SW reg sequence complete.")).catch(error => console.error("SW reg failed:", error));
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                console.log('[App] Received message from SW:', event.data);
                if (event.data && event.data.type === 'CLOUDFLARE_AUTH_REQUIRED') { console.warn('[App] Received Cloudflare Auth required message from SW.'); const existingPrompt = document.getElementById('confirmation-dialog-overlay'); if (!existingPrompt || !existingPrompt.classList.contains('show')) { if (window.AppUI && typeof window.AppUI.showCloudflareReauthPrompt === 'function') { AppUI.showCloudflareReauthPrompt(event.data.url || 'a required resource'); } else { console.error("[App] AppUI or showCloudflareReauthPrompt not available when needed!"); alert("Your security session may have expired. Please reload the page to re-authenticate."); } } else { console.log("[App] Cloudflare prompt already visible, ignoring duplicate message."); } }
                else if (event.data && event.data.type === 'SW_UPDATE') { console.log('[Client] SW Update Available message received.'); if (window.AppUI && typeof window.AppUI.showUpdateAvailablePrompt === 'function') { AppUI.showUpdateAvailablePrompt(event.source); } else { if (confirm("A new version is available. Refresh now?")) { window.location.reload(); } } }
                else if (event.data?.type === 'focusDevice' && event.data.deviceId) { console.log(`[Client] Received focus message for device ${event.data.deviceId}`); if (window.AppMap && AppState.mapReady) { AppMap.viewDeviceOnMap(event.data.deviceId); } else { console.warn("[Client] Map not ready, cannot focus device from SW message immediately."); } }
            });
            console.log("[App] Service Worker message listener attached.");
        }
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { console.log('[Client] Controller changed. New SW activated.'); if (refreshing) return; refreshing = true; console.log('[Client] Reloading page to use new Service Worker.'); window.location.reload(); });
    } else { console.error("AppNotifications not found!"); }
    if (document.body) {
        document.body.classList.remove('app-loading');
        document.body.classList.add('app-loaded');
        console.log("App marked as loaded.");

        const splashScreen = document.getElementById('splash-screen');
        if (splashScreen) {
            // Wait a very brief moment for initial paint, then hide splash
            setTimeout(() => {
                splashScreen.classList.add('hidden');
                console.log("Splash screen hidden.");
                // Optional: remove from DOM after transition for cleanliness
                // splashScreen.addEventListener('transitionend', () => splashScreen.remove(), { once: true });
            }, 100); // Short delay, adjust if needed
        } else {
            console.warn("Splash screen element not found, cannot hide.");
        }
    } else {
        window.addEventListener('load', () => {
            if (document.body) {
                document.body.classList.remove('app-loading');
                document.body.classList.add('app-loaded');
                const splashScreen = document.getElementById('splash-screen');
                if (splashScreen) {
                    setTimeout(() => {
                        splashScreen.classList.add('hidden');
                        // splashScreen.addEventListener('transitionend', () => splashScreen.remove(), { once: true });
                    }, 20);
                }
            }
        });
    }
    const refreshButton = document.getElementById('refresh-devices-button');
    if (refreshButton && !refreshButton._clickListenerAttached) { refreshButton.addEventListener('click', () => AppActions.refreshDevices(true)); refreshButton._clickListenerAttached = true; } else if (!refreshButton) { console.warn("Refresh button not found during init."); }
    if (window.AppUI && typeof AppUI.updateRelativeTimes === 'function') { if (window._relativeTimeUpdaterInterval) clearInterval(window._relativeTimeUpdaterInterval); window._relativeTimeUpdaterInterval = setInterval(AppUI.updateRelativeTimes, 60 * 1000); console.log("Relative time updater started."); }
    if (window._deviceRefreshInterval) clearInterval(window._deviceRefreshInterval); window._deviceRefreshInterval = setInterval(() => AppActions.refreshDevices(false), AppConfig.FETCH_DEVICES_INTERVAL); console.log(`Automatic data refresh interval started (${AppConfig.FETCH_DEVICES_INTERVAL / 1000}s).`);
    function setupMapListeners() {
        if (typeof L !== 'undefined' && window.AppMap && window.AppUI) {
            console.log("Setting up Leaflet-dependent event listeners."); const indexPage = document.getElementById('index-page'); indexPage?.addEventListener('click', (e) => { const buttonId = e.target.closest('.map-control-button')?.id; const mapInstance = AppState.getMap(); if (!mapInstance) return; if (buttonId === 'zoom-in') mapInstance.zoomIn(); else if (buttonId === 'zoom-out') mapInstance.zoomOut(); else if (buttonId === 'my-location') AppMap.locateMe(); else if (buttonId === 'show-all-button') AppUI.toggleShowAllDevices(); else if (buttonId === 'show-history-button') AppUI.toggleShowHistory(); }); document.getElementById('refresh-button')?.addEventListener('click', () => AppMap.locateMe());
        } else {
            console.warn("Leaflet (L) or AppMap/AppUI not defined when setting up map event listeners. Retrying..."); setTimeout(setupMapListeners, 500);
        }
    } setTimeout(setupMapListeners, 100);
    const mainContent = document.getElementById('main-content');
    const body = document.body;
    const searchInput = document.getElementById('location-search-input'); const searchResultsContainer = document.getElementById('search-results-container'); document.getElementById('menu-button')?.addEventListener('click', () => AppUI.openDrawer()); document.getElementById('drawer-overlay')?.addEventListener('click', () => AppUI.closeDrawer());
    document.getElementById('drawer-close-button')?.addEventListener('click', () => AppUI.closeDrawer()); document.getElementById('drawer')?.addEventListener('click', (e) => { const drawerItem = e.target.closest('.drawer-item'); const anchor = e.target.closest('a'); if (!drawerItem && !anchor) return; const page = drawerItem?.dataset.page || anchor?.dataset.page; const dialog = drawerItem?.dataset.dialog || anchor?.dataset.dialog; const targetAction = anchor?.dataset.target; const section = drawerItem?.dataset.section || anchor?.dataset.section; if (anchor && anchor.href.includes('logout')) { AppUI.closeDrawer(); return; } else if (anchor && anchor.href.includes('manage_apple_creds')) { AppUI.closeDrawer(); return; } else if (page) { e.preventDefault(); AppUI.changePage(page, section); AppUI.closeDrawer(); } else if (dialog) { e.preventDefault(); AppUI.openDialog(dialog); AppUI.closeDrawer(); } }); document.getElementById('more-button')?.addEventListener('click', (e) => { e.stopPropagation(); AppUI.openMoreMenu(); }); document.getElementById('more-menu-dialog-overlay')?.addEventListener('click', () => AppUI.closeMoreMenu()); document.querySelector('.bottom-nav')?.addEventListener('click', (e) => { const navLink = e.target.closest('.nav-link'); if (navLink && navLink.dataset.page) { e.preventDefault(); AppUI.changePage(navLink.dataset.page); } }); body.addEventListener('click', (e) => { const closeButton = e.target.closest('[data-close-dialog]'); if (closeButton) { AppUI.closeDialog(closeButton.dataset.closeDialog); } else if (e.target.classList.contains('dialog-overlay') && !e.target.id.includes('more-menu')) { const dialogId = e.target.id.replace('-overlay', ''); AppUI.closeDialog(dialogId); } }); document.getElementById('add-place-button')?.addEventListener('click', () => AppUI.openAddPlaceDialog()); document.getElementById('add-place-dialog-button')?.addEventListener('click', () => AppUI.handleAddPlaceSubmit()); document.getElementById('share-button')?.addEventListener('click', () => { AppUI.openDialog('share-location-dialog'); AppUI.copyShareLocationText(); }); document.getElementById('copy-share-button')?.addEventListener('click', () => AppUI.copyShareLocationText()); document.getElementById('refresh-devices-button')?.addEventListener('click', () => AppActions.refreshDevices()); document.getElementById('clear-history-button')?.addEventListener('click', () => { AppUI.showConfirmationDialog("Clear History?", "Are you sure you want to clear all your location history?", () => { AppState.clearLocationHistory(); AppUI.renderLocationHistory(); }); });
    if (searchInput) { searchInput.addEventListener('input', (e) => { const query = e.target.value.trim(); if (query.length === 0) { AppUI.hideSearchResults(); } else { AppActions._debouncedSearchHandler(query); } }); searchInput.addEventListener('focus', (e) => { const query = e.target.value.trim(); if (query.length >= 2) { AppActions.performSearch(query); } }); searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); const firstResult = searchResultsContainer?.querySelector('.search-result-item'); if (firstResult) { firstResult.click(); } } }); document.addEventListener('click', (event) => { if (!searchInput.contains(event.target) && !searchResultsContainer?.contains(event.target) && !event.target.closest('.app-bar')) { AppUI.hideSearchResults(); } }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && searchResultsContainer?.classList.contains('show')) { AppUI.hideSearchResults(); searchInput.blur(); } }); } document.getElementById('add-global-geofence-button')?.addEventListener('click', () => AppUI.openAddGlobalGeofenceDialog()); document.getElementById('test-notification-button')?.addEventListener('click', () => AppNotifications.handleTestNotification()); const globalGeofencesList = document.getElementById('global-geofences-list'); globalGeofencesList?.addEventListener('click', (e) => { const editBtn = e.target.closest('.geofence-edit'); const removeBtn = e.target.closest('.geofence-remove'); const item = e.target.closest('.settings-item[data-geofence-id]'); if (editBtn) { e.stopPropagation(); AppUI.openEditGlobalGeofenceDialog(editBtn.dataset.geofenceId); } else if (removeBtn) { e.stopPropagation(); const id = removeBtn.dataset.geofenceId; const name = item?.querySelector('.settings-item-title')?.textContent || id; AppUI.confirmRemoveItem('geofence', id, name, AppActions.handleRemoveGlobalGeofence); } else if (item) { AppUI.openEditGlobalGeofenceDialog(item.dataset.geofenceId); } }); globalGeofencesList?.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') { const item = e.target.closest('.settings-item[data-geofence-id]'); if (item && !e.target.closest('.geofence-edit, .geofence-remove')) { e.preventDefault(); AppUI.openEditGlobalGeofenceDialog(item.dataset.geofenceId); } } }); const deviceGeofenceLinksList = document.getElementById('device-geofence-links-list'); deviceGeofenceLinksList?.addEventListener('click', (e) => { const unlinkBtn = e.target.closest('.geofence-remove[data-geofence-id]'); const linkBtn = e.target.closest('.link-geofence-button'); const saveBtn = e.target.closest('.save-links-button[data-device-id]'); const cardElement = e.target.closest('.device-geofence-card'); if (!cardElement) return; const deviceId = cardElement.id.replace('device-link-card-', ''); if (unlinkBtn) { e.stopPropagation(); const geofenceIdToUnlink = unlinkBtn.dataset.geofenceId; const itemToRemove = cardElement.querySelector(`.geofence-link-item[data-geofence-id="${geofenceIdToUnlink}"]`); if (itemToRemove) { itemToRemove.remove(); cardElement.querySelector('.save-links-button').style.display = 'inline-flex'; AppUI.renderAddGeofenceDropdown(cardElement, deviceId); if (cardElement.querySelectorAll('.geofence-link-item').length === 0) { cardElement.querySelector('.linked-geofences-list').innerHTML = '<p class="no-geofences-message" style="padding: 8px 0; font-style: italic; opacity: 0.7;">No geofences linked yet.</p>'; } } } else if (linkBtn) { e.stopPropagation(); const selectElement = cardElement.querySelector('.add-geofence-select'); const geofenceIdToAdd = selectElement.value; const errorElement = cardElement.querySelector(`#link-error-${deviceId}`); errorElement.style.display = 'none'; if (!geofenceIdToAdd) { errorElement.textContent = 'Please select a geofence to link.'; errorElement.style.display = 'block'; return; } const geofenceToAdd = AppState.globalGeofenceData.find(gf => gf.id === geofenceIdToAdd); if (!geofenceToAdd) { errorElement.textContent = 'Selected geofence definition not found.'; errorElement.style.display = 'block'; return; } const list = cardElement.querySelector('.linked-geofences-list'); const noItemsMsg = list.querySelector('.no-geofences-message'); if (noItemsMsg) noItemsMsg.remove(); const newLinkItem = document.createElement('div'); newLinkItem.className = 'geofence-link-item'; newLinkItem.dataset.geofenceId = geofenceIdToAdd; newLinkItem.innerHTML = `<div class="geofence-link-info"><div class="geofence-link-name">${geofenceToAdd.name}</div><div class="geofence-link-details">Radius: ${geofenceToAdd.radius}m</div></div><div class="geofence-link-toggles"><label class="geofence-link-toggle-label" title="Notify on Entry"><input type="checkbox" data-notify-type="entry"> Entry</label><label class="geofence-link-toggle-label" title="Notify on Exit"><input type="checkbox" data-notify-type="exit"> Exit</label><span class="material-icons geofence-remove" title="Unlink Geofence" data-geofence-id="${geofenceIdToAdd}" style="margin-left: 8px; cursor: pointer; opacity: 0.6; color: var(--m3-sys-color-error);" tabindex="0" role="button" aria-label="Unlink ${geofenceToAdd.name}">link_off</span></div>`; list.appendChild(newLinkItem); cardElement.querySelector('.save-links-button').style.display = 'inline-flex'; AppUI.renderAddGeofenceDropdown(cardElement, deviceId); } else if (saveBtn) { e.stopPropagation(); AppActions.handleSaveDeviceGeofenceLinks(deviceId, cardElement); } }); deviceGeofenceLinksList?.addEventListener('change', (e) => { if (e.target.matches('.geofence-link-toggles input[type="checkbox"]')) { const cardElement = e.target.closest('.device-geofence-card'); if (cardElement) { cardElement.querySelector('.save-links-button').style.display = 'inline-flex'; } } }); const settingsPage = document.getElementById('settings-page'); settingsPage?.addEventListener('change', (e) => { if (e.target.id === 'location-history-toggle') { AppState.locationHistoryEnabled = e.target.checked; AppState.saveLocationHistoryEnabled(); console.log("Location history enabled:", AppState.locationHistoryEnabled); if (!AppState.locationHistoryEnabled) { AppState.clearLocationHistory(); } if (document.getElementById('history-page')?.style.display === 'block') { AppUI.renderLocationHistory(); } } else if (e.target.id === 'show-all-default-toggle') { AppState.isShowingAllDevices = e.target.checked; AppState.saveMapToggles(); if (document.getElementById('index-page')?.style.display !== 'none' && window.AppUI) { AppUI.updateShowAllButtonState(); AppMap.updateMapView(); } } else if (e.target.id === 'show-history-default-toggle') { AppState.showDeviceHistory = e.target.checked; AppState.saveMapToggles(); if (document.getElementById('index-page')?.style.display !== 'none' && window.AppUI) { AppUI.updateShowHistoryButtonState(); AppMap.updateHistoryLayersVisibility(); } } }); document.getElementById('enable-notifications-button')?.addEventListener('click', () => AppNotifications.handleNotificationPermission()); document.getElementById('unsubscribe-button')?.addEventListener('click', () => AppNotifications.unsubscribeUser()); const sharedDevicesList = document.getElementById('shared-devices-list'); sharedDevicesList?.addEventListener('click', (e) => { const deviceItem = e.target.closest('.shared-device[data-device-id]'); const menuButton = e.target.closest('.device-menu[data-device-index]'); const visibilityToggle = e.target.closest('.device-visibility-toggle input'); if (visibilityToggle) { /* Handled by change listener */ } else if (menuButton) { e.stopPropagation(); const index = parseInt(menuButton.dataset.deviceIndex, 10); AppUI.openDeviceMenu(index, menuButton); } else if (deviceItem && window.AppMap) { AppMap.viewDeviceOnMap(deviceItem.dataset.deviceId); } }); sharedDevicesList?.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') { const deviceItem = e.target.closest('.shared-device[data-device-id]'); const menuButton = e.target.closest('.device-menu[data-device-index]'); const visibilityToggle = e.target.closest('.device-visibility-toggle input'); if (visibilityToggle) { e.preventDefault(); visibilityToggle.click(); } else if (menuButton) { e.preventDefault(); const index = parseInt(menuButton.dataset.deviceIndex, 10); AppUI.openDeviceMenu(index, menuButton); } else if (deviceItem && window.AppMap) { e.preventDefault(); AppMap.viewDeviceOnMap(deviceItem.dataset.deviceId); } } }); sharedDevicesList?.addEventListener('change', (e) => { if (e.target.matches('.device-visibility-toggle input[data-device-id]')) { AppUI.handleDeviceVisibilityToggle(e.target); } }); const savedPlacesList = document.getElementById('saved-places-list'); savedPlacesList?.addEventListener('click', (e) => { const placeItem = e.target.closest('.shared-device[data-place-index]'); const menuButton = e.target.closest('.device-menu[data-place-index]'); if (menuButton) { e.stopPropagation(); const index = parseInt(menuButton.dataset.placeIndex, 10); AppUI.openPlaceMenu(index, menuButton); } else if (placeItem && window.AppMap) { const index = parseInt(placeItem.dataset.placeIndex, 10); AppMap.viewPlaceOnMap(index); } }); savedPlacesList?.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') { const placeItem = e.target.closest('.shared-device[data-place-index]'); const menuButton = e.target.closest('.device-menu[data-place-index]'); if (menuButton) { e.preventDefault(); const index = parseInt(menuButton.dataset.placeIndex, 10); AppUI.openPlaceMenu(index, menuButton); } else if (placeItem && window.AppMap) { e.preventDefault(); const index = parseInt(placeItem.dataset.placeIndex, 10); AppMap.viewPlaceOnMap(index); } } }); document.getElementById('export-config-button')?.addEventListener('click', AppActions.handleExportConfig); document.getElementById('dialog-import-config-file-input')?.addEventListener('change', AppUI.handleDialogImportFileSelection);
    document.getElementById('dialog-confirm-import-button')?.addEventListener('click', AppActions.handleImportConfirm); document.getElementById('place-picker-my-location')?.addEventListener('click', () => AppMap.centerDialogMapOnUserLocation('place')); document.getElementById('geofence-picker-my-location')?.addEventListener('click', () => AppMap.centerDialogMapOnUserLocation('geofence')); document.getElementById('delete-account-button')?.addEventListener('click', () => { AppUI.showConfirmationDialog("Delete Account?", "<strong>This action is permanent...</strong>", () => AppActions.handleDeleteAccount(), () => console.log("Account deletion cancelled.")); });
    document.getElementById('mark-all-read-button')?.addEventListener('click', () => AppUI.handleMarkAllRead());
    document.getElementById('clear-all-history-button')?.addEventListener('click', () => AppUI.handleClearAllHistory());
}

// --- Main Initialization Trigger ---
document.addEventListener('DOMContentLoaded', initializeApp);