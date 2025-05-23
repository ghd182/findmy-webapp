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
        // Surface container roles
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
            // Generate the FULL theme object, which includes palettes
            const theme = themeFromSourceColor(sourceArgb);

            // Helper function to extract roles and tones
            const extractRolesAndTones = (scheme, palette, tones, mode) => {
                const hexPalette = {};
                console.log(`[Theme Gen - ${mode}] Extracting roles from scheme...`);
                // 1. Extract core roles from the scheme
                for (const role in this.cssVariableMap) {
                    if (scheme[role] !== undefined && typeof scheme[role] === 'number') {
                        try { hexPalette[role] = hexFromArgb(scheme[role]); }
                        catch (e) { console.warn(`[Theme Gen - ${mode}] Failed to convert scheme role ${role}:`, e); }
                    }
                }
                console.log(`[Theme Gen - ${mode}] Extracting tones from neutral palette...`, tones);
                // 2. Extract surface tones from the neutral palette
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

            // Define the required tones for light and dark modes
            const lightTones = {
                surfaceDim: 87, surfaceBright: 98, surfaceContainerLowest: 100,
                surfaceContainerLow: 96, surfaceContainer: 94, surfaceContainerHigh: 92,
                surfaceContainerHighest: 90
            };
            const darkTones = {
                surfaceDim: 6, surfaceBright: 24, surfaceContainerLowest: 4,
                surfaceContainerLow: 10, surfaceContainer: 12, surfaceContainerHigh: 17,
                surfaceContainerHighest: 22
            };

            // Extract palettes, making sure they exist
            const neutralPalette = theme.palettes?.neutral;
            if (!neutralPalette) {
                console.error("[Theme Gen] Neutral palette is missing from the generated theme object!");
                // Return palettes without the derived surface tones as a fallback
                const lightFallback = {};
                const darkFallback = {};
                for (const role in this.cssVariableMap) { // Populate only with scheme roles
                    if (theme.schemes.light[role]) lightFallback[role] = hexFromArgb(theme.schemes.light[role]);
                    if (theme.schemes.dark[role]) darkFallback[role] = hexFromArgb(theme.schemes.dark[role]);
                }
                return { light: lightFallback, dark: darkFallback };
            }


            // Generate the final palettes including derived tones
            const lightPaletteHex = extractRolesAndTones(theme.schemes.light, neutralPalette, lightTones, 'light');
            const darkPaletteHex = extractRolesAndTones(theme.schemes.dark, neutralPalette, darkTones, 'dark');

            console.log("[Theme Gen] Light Palette (Hex):", lightPaletteHex);
            console.log("[Theme Gen] Dark Palette (Hex):", darkPaletteHex);

            return { light: lightPaletteHex, dark: darkPaletteHex };
        } catch (error) {
            console.error(`Error generating M3 palettes from ${hexColor}:`, error);
            return null; // Return null on error
        }
    },

    applyPaletteToCSS(palette) {
        if (!palette) { console.error("Cannot apply null palette to CSS."); return; }
        const targetStyle = document.documentElement.style; // Apply to :root (html)
        let appliedCount = 0;
        let mappedCount = 0;
        const missingRoles = []; // Track missing roles

        console.log("[Theme Debug] Generated Palette Keys:", Object.keys(palette)); // Log what the library returned

        for (const role in this.cssVariableMap) {
            mappedCount++;
            const cssVarName = this.cssVariableMap[role];
            // *** Check if the role EXISTS in the generated palette ***
            if (palette[role] !== undefined && palette[role] !== null) {
                // Check if the value is a number (ARGB) and convert, otherwise assume it's already hex
                let hexValue;
                if (typeof palette[role] === 'number' && window.M3ColorUtils?.hexFromArgb) {
                    try { hexValue = window.M3ColorUtils.hexFromArgb(palette[role]); }
                    catch (e) { console.warn(`[Theme] Failed to convert ARGB for role ${role}`, e); hexValue = null; }
                } else if (typeof palette[role] === 'string' && /^#[0-9a-fA-F]{6}$/.test(palette[role])) {
                    hexValue = palette[role]; // Assume already hex
                } else {
                    console.warn(`[Theme] Invalid color value type for role ${role}:`, palette[role]);
                    hexValue = null;
                }

                if (hexValue) {
                    targetStyle.setProperty(cssVarName, hexValue);
                    appliedCount++;
                } else {
                    missingRoles.push(`${role} (invalid value)`);
                }
            } else {
                // Role is in our map but not generated by the library
                missingRoles.push(role);
            }
        }
        console.log(`[Theme] Applied ${appliedCount} / ${mappedCount} mapped CSS color variables to root style.`);
        if (missingRoles.length > 0) {
            console.warn(`[Theme] Roles missing from generated palette or had invalid value: ${missingRoles.join(', ')}`);
            // We don't throw an error, just rely on CSS fallbacks for these missing roles.
        }
    },

    isDarkModeActive(themePreference) {
        if (themePreference === 'dark') return true;
        if (themePreference === 'light') return false;
        // Default to system preference
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    },

    applyTheme(sourceHexColor, themePreference) {
        console.log(`[Theme] Applying theme: Color=${sourceHexColor}, Mode=${themePreference}`);
        if (!window.M3ColorUtils || !window.M3ColorUtils.themeFromSourceColor) {
            console.error("[Theme Apply] M3ColorUtils not loaded. Cannot generate palette. Applying basic theme class.");
            const isDarkFallback = this.isDarkModeActive(themePreference);
            this._updateBodyAndMapTheme(isDarkFallback, null); // Pass null palette
            return;
        }
        // --- End check ---
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

    _updateBodyAndMapTheme(isDark, activePalette) { // activePalette might be null if generation failed
        // --- FIX: Apply class to <html> ---
        const targetElement = document.documentElement;
        // --- ---------------------------- ---
        targetElement.classList.remove('dark-theme', 'light-theme');
        targetElement.classList.add(isDark ? 'dark-theme' : 'light-theme');

        const metaThemeColor = document.getElementById('meta-theme-color');
        // Use background color OR a sensible default based on mode
        const metaColorValue = activePalette?.background || (isDark ? '#1C1B1F' : '#FFFBFE');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', metaColorValue);
        }

        if (window.AppMap && typeof window.AppMap.updateMapThemeStyle === 'function') {
            window.AppMap.updateMapThemeStyle(isDark);
        }
    },

    setupThemeControls() {
        if (!this._debouncedSavePreferences) {
            this._debouncedSavePreferences = this._debounce(async (mode, color) => {
                console.log(`[Theme Debounced] Saving Prefs - Mode: ${mode}, Color: ${color}`);
                try {
                    if (window.AppApi && typeof window.AppApi.updateUserPreferences === 'function') {
                        await AppApi.updateUserPreferences(mode, color);
                        console.log("[Theme Debounced] Preferences saved to backend.");
                    } else { console.error("[Theme Debounced] AppApi.updateUserPreferences not available!"); }
                } catch (error) {
                    console.error("[Theme Debounced] Failed to save preferences to backend:", error);
                    if (window.AppUI) AppUI.showErrorDialog("Save Error", "Could not save theme preference to server.", 3000);
                }
            }, 1000);
        }

        const colorPicker = document.getElementById('theme-color-picker');
        const themeRadios = document.querySelectorAll('input[name="theme"]');
        const resetColorButton = document.getElementById('reset-theme-color-button');
        // Ensure 'this' refers to AppTheme inside listeners
        const self = this; // Store reference to AppTheme

        colorPicker?.addEventListener('input', (e) => {
            const newColor = e.target.value;
            AppState.userColor = newColor;
            // Use self to call methods
            self.applyTheme(newColor, AppState.currentTheme);
            self._debouncedSavePreferences(AppState.currentTheme, newColor);
        });

        themeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const newMode = e.target.value;
                    if (window.AppUI) AppUI.setTheme(newMode); // UI handles calling AppTheme.applyTheme
                    self._debouncedSavePreferences(newMode, AppState.userColor); // Use self
                }
            });
        });

        resetColorButton?.addEventListener('click', () => {
            console.log("Resetting theme color to default.");
            const defaultColor = self.DEFAULT_SOURCE_COLOR; // Use self
            AppState.userColor = defaultColor;
            if (colorPicker) colorPicker.value = defaultColor;
            self.applyTheme(defaultColor, AppState.currentTheme); // Use self
            self._debouncedSavePreferences(AppState.currentTheme, defaultColor); // Use self
        });

        // Media Query listener
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (mediaQuery._themeChangeListener) {
            mediaQuery.removeEventListener('change', mediaQuery._themeChangeListener);
        }
        mediaQuery._themeChangeListener = (e) => {
            if (AppState.currentTheme === 'system') {
                self.applyTheme(AppState.userColor, 'system'); // Use self
            }
        };
        mediaQuery.addEventListener('change', mediaQuery._themeChangeListener);

        console.log("[Theme] Theme controls setup complete.");
    },

    initializeTheme() {
        // Ensure AppState exists and has loaded preferences
        if (!window.AppState) { console.error("[Theme Init] AppState not available!"); return; }
        // Ensure M3ColorUtils is ready before proceeding
        if (!window.M3ColorUtils) {
            console.error("[Theme Init] M3ColorUtils not available! Theme initialization failed.");
            // Apply basic fallback class based on AppState pref
            const isDarkFallback = this.isDarkModeActive(AppState.currentTheme);
            document.body.classList.remove('dark-theme', 'light-theme');
            document.body.classList.add(isDarkFallback ? 'dark-theme' : 'light-theme');
            return;
        }

        console.log(`[Theme] Initializing with Color=${AppState.userColor}, Mode=${AppState.currentTheme}`);
        const colorPicker = document.getElementById('theme-color-picker');
        if (colorPicker) colorPicker.value = AppState.userColor;
        document.querySelectorAll('input[name="theme"]').forEach(radio => { radio.checked = (radio.value === AppState.currentTheme); });

        this.applyTheme(AppState.userColor, AppState.currentTheme);
        this.setupThemeControls();
    }
};
// --- End AppTheme definition ---


// --- AppActions ---
window.AppActions = {
    _refreshPollingInterval: null, // Interval handle
    _refreshPollingTimeout: null,  // Timeout handle
    _stopRefreshPolling: function () {
        if (this._refreshPollingInterval) { clearInterval(this._refreshPollingInterval); this._refreshPollingInterval = null; console.log("[Action Refresh Poll] Polling stopped."); }
        if (this._refreshPollingTimeout) { clearTimeout(this._refreshPollingTimeout); this._refreshPollingTimeout = null; }
        const button = document.getElementById('refresh-devices-button');
        if (button && button.disabled) {
            button.disabled = false;
            if (button.dataset.originalHtml) { button.innerHTML = button.dataset.originalHtml; }
            else { button.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">refresh</span> Update Status`; }
            console.log("[Action Refresh Poll] Button restored by _stopRefreshPolling.");
        }
    },

    // --- _updateDeviceUI (Crucially, this function calls AppMap.updateMapView internally if map is ready/visible) ---
    _updateDeviceUI: function (data, lastUpdatedElement, listElement, noDevicesMessage, error = null) {
        // --- Define devicesPageVisible HERE, outside the try block ---
        const devicesPageVisible = document.getElementById('shared-page')?.style.display !== 'none';
        const listContainer = document.getElementById('shared-devices-list'); // Also get list container reference early

        try {
            const errorMessageElement = document.getElementById('devices-error-message');
            if (error) {
                console.error("Updating device UI with error:", error);
                // Only show pop-up for non-auth/2FA errors
                if (error.code !== 'NO_APPLE_CREDS' && error.status !== 401 && error.status !== 403 && !(error.message && error.message.includes("2FA Required"))) {
                    if (window.AppUI) AppUI.showErrorDialog("Device Refresh Error", `Could not get device status.<br>Details: ${error.message} (${error.code || 'N/A'})`);
                }
                if (errorMessageElement) { errorMessageElement.textContent = `Error: ${error.message}`; errorMessageElement.style.display = 'block'; }
                if (lastUpdatedElement) { lastUpdatedElement.textContent = 'Update failed'; lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; }
                // Render empty list ONLY if the shared page is visible
                if (devicesPageVisible && listElement) AppUI.renderDevicesList([]);

            } else if (data) {
                const previousTimestamp = AppState.lastDeviceUpdateTime ? AppState.lastDeviceUpdateTime.toISOString() : null;
                const newTimestamp = data.last_updated || null;

                if (AppState.currentViewedDeviceId && !data.devices?.some(d => d.id === AppState.currentViewedDeviceId)) { AppState.currentViewedDeviceId = null; }
                AppState.setCurrentDeviceData(data.devices || []);

                // Render device list only if the shared page is currently active
                if (devicesPageVisible && listElement) {
                    AppUI.renderDevicesList(AppState.getCurrentDeviceData());
                }

                // Update Status Text (logic remains the same)
                let statusText = 'Last updated: Unknown';
                if (data.code === 'NO_DEVICE_FILES') { statusText = 'No devices configured'; }
                else if (data.code === 'NO_APPLE_CREDS') { statusText = 'Credentials needed'; }
                else if (data.fetch_errors && data.fetch_errors.includes("2FA Required")) { statusText = `Update Failed: ${data.fetch_errors}`; }
                else if (data.code === 'CACHE_EMPTY' || data.code === 'CACHE_EMPTY_CONFIG_RETURNED') { statusText = `Waiting for first fetch... (${data.fetch_errors || 'No data yet'})`; }
                else if (data.last_updated) {
                    try {
                        const d = new Date(data.last_updated);
                        const relativeTimeStr = AppUtils.formatTimeRelative(d);
                        statusText = `Last updated: ${relativeTimeStr}`;
                        if (lastUpdatedElement) {
                            lastUpdatedElement.dataset.timestamp = data.last_updated;
                            lastUpdatedElement.classList.add('relative-time');
                        }
                    } catch (e) {
                        statusText = `Last updated: ${data.last_updated}`;
                        if (lastUpdatedElement) { lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; }
                    }
                } else if (data.fetch_errors) {
                    statusText = `Update Failed: ${data.fetch_errors}`;
                    if (lastUpdatedElement) { lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; }
                }
                if (lastUpdatedElement) { lastUpdatedElement.textContent = statusText; }


                if (devicesPageVisible && noDevicesMessage) noDevicesMessage.style.display = (data.devices?.length === 0) ? 'block' : 'none';
                if (errorMessageElement) errorMessageElement.style.display = 'none';

                if (window.AppUI && typeof AppUI.updateRelativeTimes === 'function') { AppUI.updateRelativeTimes(); }

                // Trigger Map Update (logic remains the same)
                const mapPageVisible = document.getElementById('index-page')?.style.display !== 'none';
                const shouldUpdateMap = AppState.mapReady && (mapPageVisible || AppState.isInitialLoad) && (newTimestamp !== previousTimestamp || AppState.isInitialLoad);

                if (shouldUpdateMap) {
                    console.log(`[UI Update] Triggering AppMap.updateMapView(). Map Visible: ${mapPageVisible}, Timestamp Changed: ${newTimestamp !== previousTimestamp}, Initial Load: ${AppState.isInitialLoad}`);
                    if (window.AppMap && typeof AppMap.updateMapView === 'function') {
                        AppMap.updateMapView(); // <<< THE KEY CALL TO UPDATE THE MAP
                    } else {
                        console.warn("[UI Update] AppMap.updateMapView function not found when trying to update map.");
                    }
                } else {
                    console.log(`[UI Update] Skipping map update. Map Visible: ${mapPageVisible}, Map Ready: ${AppState.mapReady}, Timestamp Changed: ${newTimestamp !== previousTimestamp}, Initial Load: ${AppState.isInitialLoad}`);
                }

                // Mark initial load as false after the first successful update
                if (AppState.isInitialLoad && data && !error) {
                    AppState.isInitialLoad = false;
                }

            } else { // Handle case where data is null/undefined but no explicit error
                if (lastUpdatedElement) { lastUpdatedElement.textContent = 'No data received.'; lastUpdatedElement.classList.remove('relative-time'); delete lastUpdatedElement.dataset.timestamp; }
                if (devicesPageVisible && listElement) AppUI.renderDevicesList([]);
            }
        } catch (uiError) {
            console.error("Error updating device UI:", uiError);
            // Optionally display a generic error message if specific elements aren't available
            const errorMsgElem = document.getElementById('devices-error-message');
            if (errorMsgElem) { errorMsgElem.textContent = `UI Error: ${uiError.message}`; errorMsgElem.style.display = 'block'; }
        } finally {
            // Now 'devicesPageVisible' is guaranteed to be defined here
            if (devicesPageVisible) {
                const loadingIndicator = document.getElementById('devices-loading-indicator');
                if (loadingIndicator) loadingIndicator.style.display = 'none';
                // Check listElement directly, it was passed in
                if (listElement) {
                    // Ensure noDevicesMessage is also referenced correctly if needed
                    const noDevMsg = document.getElementById('no-devices-message');
                    listElement.style.display = (listElement.hasChildNodes() && (!noDevMsg || noDevMsg.style.display === 'none')) ? 'block' : 'none';
                }
            }
        }
    }, // End _updateDeviceUI


    refreshDevices: async function (triggerBackgroundFetch = false) {
        console.log(`Action: Refresh Devices triggered. (Background Fetch: ${triggerBackgroundFetch})`);
        const button = document.getElementById('refresh-devices-button');
        const listElement = document.getElementById('shared-devices-list');
        const loadingIndicator = document.getElementById('devices-loading-indicator');
        const lastUpdatedElement = document.getElementById('devices-last-updated');
        const noDevicesMessage = document.getElementById('no-devices-message');
        const devicesPageVisible = document.getElementById('shared-page')?.style.display !== 'none';

        this._stopRefreshPolling(); // Stop previous polling if any

        // Show loading state ONLY if the devices page is visible
        if (devicesPageVisible) {
            if (button) {
                button.disabled = true;
                if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
                button.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Updating...`;
            }
            if (loadingIndicator) loadingIndicator.style.display = 'block';
            if (lastUpdatedElement) lastUpdatedElement.textContent = 'Checking status...';
            if (noDevicesMessage) noDevicesMessage.style.display = 'none';
            if (listElement) listElement.style.display = 'none';
        }

        let initialTimestamp = AppState.lastDeviceUpdateTime ? AppState.lastDeviceUpdateTime.toISOString() : null;

        try {
            if (triggerBackgroundFetch) {
                // --- Manual Refresh Flow ---
                console.log("[Action Refresh] Manual trigger: Stored initial timestamp:", initialTimestamp);
                console.log("Triggering background refresh via API...");
                try {
                    await AppApi.triggerUserRefresh();
                    console.log("Background refresh trigger successful.");
                    if (devicesPageVisible && lastUpdatedElement) lastUpdatedElement.textContent = 'Refresh initiated, polling for updates...';

                    // Start Polling (keep existing polling logic)
                    const pollStartTime = Date.now(); const maxPollDuration = 90 * 1000; const pollInterval = 5 * 1000;
                    this._refreshPollingInterval = setInterval(async () => {
                        console.log("[Action Refresh Poll] Polling check...");
                        try {
                            const pollData = await AppApi.fetchDevices(); const currentTimestamp = pollData?.last_updated || null;
                            if (currentTimestamp && currentTimestamp !== initialTimestamp) {
                                console.log("[Action Refresh Poll] New timestamp detected! Update complete.");
                                this._stopRefreshPolling(); // Stops polling AND resets button
                                this._updateDeviceUI(pollData, lastUpdatedElement, listElement, noDevicesMessage); // Update UI fully
                            } else { console.log(`[Action Refresh Poll] Timestamp unchanged (${currentTimestamp} vs ${initialTimestamp}).`); }
                        } catch (pollError) { console.error("[Action Refresh Poll] Error during poll fetch:", pollError); this._stopRefreshPolling(); this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, pollError); }
                    }, pollInterval);
                    this._refreshPollingTimeout = setTimeout(() => {
                        if (this._refreshPollingInterval) {
                            console.warn("[Action Refresh Poll] Polling timed out."); this._stopRefreshPolling();
                            if (devicesPageVisible && lastUpdatedElement) lastUpdatedElement.textContent = 'Refresh timed out. Displaying last known status.';
                            AppApi.fetchDevices() // Fetch one last time
                                .then(finalData => this._updateDeviceUI(finalData, lastUpdatedElement, listElement, noDevicesMessage))
                                .catch(finalError => this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, finalError));
                        }
                    }, maxPollDuration);
                    return; // Exit function, let polling handle UI update and button reset

                } catch (triggerError) {
                    console.error("Error triggering background refresh:", triggerError);
                    if (devicesPageVisible && lastUpdatedElement) lastUpdatedElement.textContent = 'Refresh trigger failed.';
                    this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, triggerError);
                    this._stopRefreshPolling(); // Reset button on trigger error
                    return; // Stop execution
                }
            } else {
                // --- Automatic Interval Refresh Flow ---
                console.log("Fetching current device status (interval)...");
                const fetchStatusData = await AppApi.fetchDevices();
                // --- CRITICAL: Call the UI update function ---
                this._updateDeviceUI(fetchStatusData, lastUpdatedElement, listElement, noDevicesMessage);
                // --- -------------------------------------- ---
            }
        } catch (error) { // Catch errors from the fetchDevices call when trigger=false
            console.error("Error fetching device status (interval):", error);
            this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, error);
        } finally {
            // --- START: Revised Finally Block ---
            if (devicesPageVisible) { // Still check if page was visible for loading indicator
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'none';
                    console.log("[Action Refresh Finally] Hid loading indicator.");
                }

                // Reset button if NOT polling (automatic refresh or failed trigger)
                if (!this._refreshPollingInterval && button && button.disabled) {
                    console.log("[Action Refresh Finally] NOT Polling. Resetting button.");
                    button.disabled = false;
                    if (button.dataset.originalHtml) {
                        button.innerHTML = button.dataset.originalHtml;
                    } else {
                        // Ensure consistent button text reset
                        button.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">refresh</span> Update Status`;
                    }
                } else if (this._refreshPollingInterval) {
                    console.log("[Action Refresh Finally] Polling is active. Button state managed by polling.");
                }
            }
            // --- END: Revised Finally Block ---
        }
    }, // End refreshDevices

    refreshGeofencesAndDevices: async function () {
        console.log("Action: Refreshing Geofences and Devices");
        const globalLoading = document.getElementById('global-geofences-loading');
        const linksLoading = document.getElementById('device-links-loading');
        if (globalLoading) globalLoading.style.display = 'block';
        if (linksLoading) linksLoading.style.display = 'block';
        try {
            // Fetch geofences first
            const geoData = await AppApi.fetchGlobalGeofences();
            AppState.setGlobalGeofences(geoData || []);
            AppUI.renderGlobalGeofences(); // Render global list

            // Then refresh devices (which might depend on geofences being loaded)
            await AppActions.refreshDevices(); // Await device refresh

            // Render links and map layers AFTER both are loaded
            AppUI.renderDeviceGeofenceLinks();
            if (window.AppMap) AppMap.redrawGeofenceLayer();

        } catch (error) {
            console.error("Error refreshing geofences/devices:", error);
            if (error.code !== 'NO_DEVICE_FILES' && error.code !== 'NO_APPLE_CREDS') {
                if (window.AppUI) AppUI.showErrorDialog("Data Load Error", `Could not load geofence/device data.<br>Details: ${error.message} (${error.code || 'N/A'})`);
            }
        } finally {
            if (globalLoading) globalLoading.style.display = 'none';
            if (linksLoading) linksLoading.style.display = 'none';
        }
    },

    fetchInitialData: async function () {
        console.log("Action: Fetching initial data (devices, geofences, shares)"); // Updated log
        const listElement = document.getElementById('shared-devices-list');
        const loadingIndicator = document.getElementById('devices-loading-indicator');
        const lastUpdatedElement = document.getElementById('devices-last-updated');
        const noDevicesMessage = document.getElementById('no-devices-message');
        const devicesPageVisible = document.getElementById('shared-page')?.style.display !== 'none';

        try {
            // Fetch geofences, devices, AND shares (can run in parallel)
            const [geoData, devicesData, sharesData] = await Promise.all([
                AppApi.fetchGlobalGeofences().catch(e => { console.error("Failed initial geofence fetch", e); return []; }), // Handle potential errors
                AppApi.fetchDevices().catch(e => { console.error("Failed initial device fetch", e); return null; }),      // Handle potential errors
                AppApi.fetchUserShares().catch(e => { console.error("Failed initial shares fetch", e); return []; })        // Handle potential errors
            ]);

            // Set state AFTER all fetches complete
            AppState.setGlobalGeofences(geoData || []);
            AppState.setUserActiveShares(sharesData || []); // <<< SET SHARES STATE

            // Update device UI (this updates AppState.currentDeviceData)
            this._updateDeviceUI(devicesData, lastUpdatedElement, listElement, noDevicesMessage, devicesData ? null : new Error("Failed to fetch device data"));

            // Render static lists based on updated state
            AppUI.renderGlobalGeofences();
            AppUI.renderDeviceGeofenceLinks();
            AppUI.renderDevicePageSharesList(); // <<< RENDER SHARES on Devices page
            AppUI.renderActiveSharesList();     // <<< Also render on Settings page

            // Update map AFTER state is set
            if (window.AppMap && AppState.mapReady) {
                AppMap.redrawGeofenceLayer();
                AppMap.updateMapView(); // Ensure map reflects device visibility etc.
            }

        } catch (error) { // Catch errors from Promise.all or subsequent processing
            console.error("Initial data fetch sequence failed:", error);
            this._updateDeviceUI(null, lastUpdatedElement, listElement, noDevicesMessage, error);
            if (error.code !== 'NO_DEVICE_FILES' && error.code !== 'NO_APPLE_CREDS' && error.status !== 401 && error.status !== 403 && !(error.message && error.message.includes("2FA Required"))) {
                if (window.AppUI) AppUI.showErrorDialog("Initial Load Failed", `Could not load initial data.<br>Details: ${error.message} (${error.code || 'N/A'})`);
            }
        } finally {
            if (devicesPageVisible && loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
        }
    },


    handleRemoveDevice: async function (deviceId) {
        const device = AppState.getDeviceDisplayInfo(deviceId);
        const deviceName = device?.name || deviceId; // Use name or ID for message
        console.log(`[Action] Confirmed removal for device ${deviceId} (${deviceName})`);
        // Optional: Show a temporary "Deleting..." dialog/indicator
        AppUI.showConfirmationDialog("Deleting...", `Removing device "${deviceName}" and its data...`, null, null);
        const progressDialog = document.getElementById('confirmation-dialog');
        if (progressDialog) progressDialog.querySelector('.dialog-actions').style.display = 'none';

        try {
            const result = await AppApi.deleteDevice(deviceId);
            console.log(`[Action] Device removal API result for ${deviceId}:`, result);
            AppUI.closeDialog('confirmation-dialog'); // Close deleting dialog

            // --- Update Frontend State ---
            // Remove from main data list
            AppState.currentDeviceData = AppState.currentDeviceData.filter(d => d.id !== deviceId);
            // Remove marker
            if (AppState.deviceMarkers[deviceId]) {
                const map = AppState.getMap();
                if (map && map.hasLayer(AppState.deviceMarkers[deviceId])) {
                    map.removeLayer(AppState.deviceMarkers[deviceId]);
                }
                delete AppState.deviceMarkers[deviceId];
            }
            // Remove history layer
            AppMap.clearDeviceHistoryLayer(deviceId); // Use existing map function
            // Remove visibility setting
            if (deviceId in AppState.deviceVisibility) {
                delete AppState.deviceVisibility[deviceId];
                AppState.saveDeviceVisibilityState(); // Save the updated visibility state
            }
            // --- End Frontend State Update ---

            AppUI.showConfirmationDialog("Device Removed", result.message || `Device "${deviceName}" removed successfully.`);
            AppUI.renderDevicesList(AppState.getCurrentDeviceData()); // Re-render device list on shared page
            if (document.getElementById('geofences-page')?.style.display === 'block') {
                AppUI.renderDeviceGeofenceLinks(); // Re-render links on geofence page
            }
            if (document.getElementById('index-page')?.style.display === 'block') {
                AppMap.updateMapView(); // Update map view
            }

        } catch (error) {
            AppUI.closeDialog('confirmation-dialog'); // Close deleting dialog
            console.error("Error removing device:", error);
            AppUI.showErrorDialog("Removal Failed", `Could not remove device "${deviceName}".<br>Details: ${error.message}`);
            // Optionally trigger a full refresh if state might be inconsistent
            // AppActions.refreshDevices();
        }
    },

    handleEditDeviceSubmit: async function () {
        const id = document.getElementById('edit-device-id').value;
        const nameInput = document.getElementById('edit-device-name').value.trim();
        const label = document.getElementById('edit-device-label').value.trim();
        const color = document.getElementById('edit-device-color').value;
        if (!id) return;
        const name = nameInput || document.getElementById('edit-device-name').placeholder || id;
        const payload = { name: name, label: label || '❓', color: color };
        const saveButton = document.getElementById('save-device-edit-button');
        if (!saveButton) return;
        saveButton.disabled = true;
        saveButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>`;
        try {
            const updatedConfig = await AppApi.updateDeviceDisplay(id, payload);
            console.log("Save successful, updated display info:", updatedConfig);
            const dataIndex = AppState.currentDeviceData.findIndex(d => d.id === id);
            if (dataIndex > -1) {
                const existingGeofences = AppState.currentDeviceData[dataIndex].geofences || [];
                AppState.currentDeviceData[dataIndex] = { ...AppState.currentDeviceData[dataIndex], ...updatedConfig, geofences: updatedConfig.geofences || existingGeofences };
            } else {
                console.warn("Edited device not found in local data cache after save.");
                await AppActions.refreshDevices();
            }
            // Refresh UI
            if (document.getElementById('shared-page')?.style.display !== 'none') { AppUI.renderDevicesList(AppState.getCurrentDeviceData()); }
            if (document.getElementById('geofences-page')?.style.display !== 'none') { AppUI.renderDeviceGeofenceLinks(); }
            if (document.getElementById('index-page')?.style.display !== 'none' && window.AppMap) { AppMap.updateMapView(); }
            AppUI.closeDialog('edit-device-dialog');
            AppUI.showConfirmationDialog("Device Updated", `Display settings for "${updatedConfig.name}" saved.`);
        } catch (error) {
            console.error("Error saving device config:", error);
            if (window.AppUI) AppUI.showErrorDialog("Save Failed", `Could not save settings.<br>Details: ${error.message}`);
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = 'Save Display Info'; }
        }
    },

    handleGeofenceDialogSubmit: async function () {
        const editId = document.getElementById('geofence-edit-id').value;
        const isEditing = !!editId;
        const name = document.getElementById('geofence-name').value.trim();
        const radius = parseFloat(document.getElementById('geofence-radius').value);
        const lat = parseFloat(document.getElementById('geofence-lat').value);
        const lng = parseFloat(document.getElementById('geofence-lng').value);

        if (!name) { if (window.AppUI) AppUI.showErrorDialog("Input Required", "Geofence name cannot be empty."); return; }
        if (isNaN(lat) || isNaN(lng)) { if (window.AppUI) AppUI.showErrorDialog("Input Required", "Please select a location on the map."); return; }
        if (isNaN(radius) || radius <= 0) { if (window.AppUI) AppUI.showErrorDialog("Input Required", "Please enter a valid positive radius."); return; }

        const geofenceData = { name, lat, lng, radius };
        const saveButton = document.getElementById('geofence-dialog-save-button');
        if (!saveButton) return;
        saveButton.disabled = true;
        saveButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div>`;

        try {
            let savedGeofence;
            if (isEditing) {
                savedGeofence = await AppApi.updateGeofence(editId, geofenceData);
                const index = AppState.globalGeofenceData.findIndex(gf => gf.id === editId);
                if (index > -1) AppState.globalGeofenceData[index] = savedGeofence;
                else AppState.globalGeofenceData.push(savedGeofence);
            } else {
                savedGeofence = await AppApi.createGeofence(geofenceData);
                AppState.globalGeofenceData.push(savedGeofence);
            }
            AppState.globalGeofenceData.sort((a, b) => a.name.localeCompare(b.name));
            console.log(`Global geofence ${isEditing ? 'updated' : 'created'} successfully.`);

            AppUI.renderGlobalGeofences();
            AppUI.renderDeviceGeofenceLinks();
            if (window.AppMap) AppMap.redrawGeofenceLayer();

            AppUI.closeDialog('geofence-dialog');
            AppUI.showConfirmationDialog(`Geofence ${isEditing ? 'Updated' : 'Created'}`, `Geofence "${savedGeofence.name}" saved.`);
        } catch (error) {
            console.error(`Error ${isEditing ? 'updating' : 'creating'} geofence:`, error);
            if (error.status === 409) { if (window.AppUI) AppUI.showErrorDialog("Name Conflict", error.message || "A geofence with this name already exists."); }
            else { if (window.AppUI) AppUI.showErrorDialog("Save Failed", `Could not save geofence.<br>Details: ${error.message}`); }
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = `Save Geofence`; }
        }
    },

    handleRemoveGlobalGeofence: async function (geofenceId) {
        const geofenceToRemove = AppState.globalGeofenceData.find(gf => gf.id === geofenceId);
        if (!geofenceToRemove) { if (window.AppUI) AppUI.showErrorDialog("Error", "Geofence not found in local data."); return; }
        console.log(`Confirmed removal for ${geofenceId}`);
        try {
            const result = await AppApi.deleteGeofence(geofenceId);
            AppState.globalGeofenceData = AppState.globalGeofenceData.filter(gf => gf.id !== geofenceId);
            console.log(`Global geofence "${geofenceToRemove.name}" removed successfully.`);
            if (window.AppUI) AppUI.showConfirmationDialog("Geofence Removed", result.message || `Geofence "${geofenceToRemove.name}" removed.`);

            AppUI.renderGlobalGeofences();
            if (window.AppMap) AppMap.redrawGeofenceLayer();
            AppActions.refreshDevices().then(() => {
                if (document.getElementById('geofences-page')?.style.display === 'block') {
                    AppUI.renderDeviceGeofenceLinks();
                }
            });
        } catch (error) {
            console.error("Error removing global geofence:", error);
            if (window.AppUI) AppUI.showErrorDialog("Removal Failed", `Could not remove geofence.<br>Details: ${error.message}`);
        }
    },

    handleSaveDeviceGeofenceLinks: async function (deviceId, cardElement) {
        const saveButton = cardElement.querySelector('.save-links-button');
        if (!saveButton) return;
        saveButton.disabled = true;
        saveButton.innerHTML = `<div class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin: 0 auto;"></div>`;

        const linkItems = cardElement.querySelectorAll('.geofence-link-item');
        const updatedLinksPayload = Array.from(linkItems).map(item => {
            const gfId = item.dataset.geofenceId;
            const notifyEntryInput = item.querySelector('input[data-notify-type="entry"]');
            const notifyExitInput = item.querySelector('input[data-notify-type="exit"]');
            return { id: gfId, notify_entry: notifyEntryInput?.checked ?? false, notify_exit: notifyExitInput?.checked ?? false };
        });

        const deviceName = AppState.getDeviceDisplayInfo(deviceId).name;

        try {
            const responseData = await AppApi.updateDeviceGeofenceLinks(deviceId, updatedLinksPayload);
            const dataIndex = AppState.currentDeviceData.findIndex(d => d.id === deviceId);
            if (dataIndex > -1) {
                AppState.currentDeviceData[dataIndex].geofences = responseData.linked_geofences || [];
            } else { console.warn(`Device ${deviceId} not found in cache after saving links.`); }
            console.log("Device links saved successfully.");
            if (window.AppUI) AppUI.showConfirmationDialog("Links Saved", `Geofence links and notifications for ${deviceName} saved.`);
            saveButton.style.display = 'none';
            AppUI.renderAddGeofenceDropdown(cardElement, deviceId);
            if (document.getElementById('index-page')?.style.display !== 'none' && window.AppMap) { AppMap.redrawGeofenceLayer(); }
        } catch (error) {
            console.error("Error saving device links:", error);
            if (window.AppUI) AppUI.showErrorDialog("Save Failed", `Could not save geofence links.<br>Details: ${error.message}`);
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">save</span> Save Changes`; }
        }
    },

    _debouncedSearchHandler: null, // Holder for debounced function

    performSearch: async function (query) { // Main app bar search
        if (query.length < 2) { AppUI.renderSearchResults([], 'search-results-container'); AppUI.hideSearchResults('search-results-container'); return; }
        console.log("Performing search for:", query); let results = []; const lowerQuery = query.toLowerCase();
        const appActions = [
            { type: 'action', target: 'settings', name: 'Settings', keywords: ['settings', 'theme', 'history', 'map defaults', 'config'], icon: 'settings' },
            { type: 'action', target: 'geofences', name: 'Geofences', keywords: ['geofence', 'fence', 'area', 'zone', 'boundary'], icon: 'location_searching' },
            { type: 'action', target: 'shared', name: 'Devices', keywords: ['device', 'item', 'accessory', 'shared', 'list'], icon: 'devices' },
            { type: 'action', target: 'places', name: 'Saved Places', keywords: ['place', 'saved', 'favorite', 'star'], icon: 'star_outline' },
            { type: 'action', target: 'history', name: 'Location History', keywords: ['history', 'timeline', 'past'], icon: 'history' },
            { type: 'action', target: 'notifications-history', name: 'Notification History', keywords: ['notification', 'alert', 'message'], icon: 'history_toggle_off' }, // Added History
            { type: 'action', target: 'dialog:help-dialog', name: 'Help & Feedback', keywords: ['help', 'info', 'guide', 'feedback'], icon: 'help_outline' },
            { type: 'action', target: 'manage_apple_creds', name: 'Manage Apple Credentials', keywords: ['apple', 'credential', 'password', 'account', 'login'], icon: 'security' },
            { type: 'action', target: 'settings', section: 'settings-upload-section', name: 'Upload Device Files', keywords: ['upload', 'file', 'key', 'plist', 'add device'], icon: 'upload_file' },
            { type: 'action', target: 'settings', section: 'settings-import-export', name: 'Import/Export Config (Backup)', keywords: ['import', 'export', 'config', 'backup', 'restore', 'setting'], icon: 'import_export' },
            { type: 'action', target: 'index', name: 'Map View', keywords: ['map', 'view', 'overview'], icon: 'map' },
            { type: 'action', target: 'settings', section: 'settings-notifications', name: 'Notifications (Settings)', keywords: ['notifications'], icon: 'notifications' },
            { type: 'action', target: 'settings', section: 'settings-account-management', name: 'Delete Account', keywords: ['delete', 'remove', 'account', 'danger'], icon: 'delete_forever' },
        ];
        appActions.forEach(action => { if (action.name.toLowerCase().includes(lowerQuery) || action.keywords.some(k => k.includes(lowerQuery))) { results.push({ ...action, description: action.description || `Go to ${action.name}` }); } });
        AppState.getCurrentDeviceData().forEach(device => { const displayInfo = AppState.getDeviceDisplayInfo(device.id); if (displayInfo.name.toLowerCase().includes(lowerQuery) || device.id.toLowerCase().includes(lowerQuery)) { results.push({ type: 'device', id: device.id, name: displayInfo.name, description: displayInfo.status || 'Device', icon: 'devices', svg_icon: displayInfo.svg_icon }); } });
        AppState.savedPlaces.forEach((place, index) => { if (place.name.toLowerCase().includes(lowerQuery) || (place.description && place.description.toLowerCase().includes(lowerQuery))) { results.push({ type: 'place', placeIndex: index, name: place.name, description: place.description || 'Saved Place', icon: 'star' }); } });
        AppState.getGlobalGeofences().forEach(gf => { if (gf.name.toLowerCase().includes(lowerQuery)) { results.push({ type: 'geofence', id: gf.id, name: gf.name, description: `Radius: ${gf.radius}m`, icon: 'location_searching' }); } });
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=4`;
            // Use AppConfig if available, otherwise default
            const appVersion = window.AppConfig?.APP_VERSION || '?.?.?';
            const response = await fetch(url, { headers: { 'User-Agent': `FindMyWebApp/${appVersion}` } });
            if (!response.ok) { console.error(`Nominatim search failed: ${response.status}`); }
            else { const nominatimData = await response.json(); nominatimData.forEach(loc => { results.push({ type: 'location', query: loc.display_name, name: loc.display_name.split(',')[0], description: loc.display_name, icon: 'travel_explore', lat: parseFloat(loc.lat), lng: parseFloat(loc.lon) }); }); }
        } catch (error) { console.error("Nominatim search error during global search:", error); }
        AppUI.renderSearchResults(results, 'search-results-container'); AppUI.showSearchResults('search-results-container');
    },

    initDebouncedSearch: function () {
        // Ensure AppUtils is defined
        if (window.AppUtils && typeof AppUtils.debounce === 'function') {
            this._debouncedSearchHandler = AppUtils.debounce(this.performSearch, 350);
        } else {
            console.error("AppUtils or AppUtils.debounce not found! Search debouncing will not work.");
            // Fallback to immediate search (can be laggy)
            this._debouncedSearchHandler = this.performSearch;
        }
    },

    handleExportConfig: async function () {
        const checkboxes = document.querySelectorAll('#export-parts-selection input[name="export_part"]:checked');
        const selectedParts = Array.from(checkboxes).map(cb => cb.value);
        if (selectedParts.length === 0) { if (window.AppUI) AppUI.showErrorDialog("Export Error", "Please select at least one part to export."); return; }

        const exportData = {
            export_format: "findmyapp_combined_v1",
            app_version: window.AppConfig?.APP_VERSION || "?.?.?", // Use AppConfig
            timestamp: new Date().toISOString(),
            client: {}, server: {}
        };
        const errors = [];

        if (window.AppUI) AppUI.showConfirmationDialog("Exporting...", "Gathering configuration data...", null, null);

        // Gather Client Data
        if (selectedParts.includes('clientSettings')) { exportData.client.clientSettings = { theme: AppState.currentTheme, userColor: AppState.userColor, isShowingAllDevices: AppState.isShowingAllDevices, showDeviceHistory: AppState.showDeviceHistory, historyTimeFilterHours: AppState.historyTimeFilterHours, locationHistoryEnabled: AppState.locationHistoryEnabled }; }
        if (selectedParts.includes('savedPlaces')) { exportData.client.savedPlaces = AppState.savedPlaces; }
        if (selectedParts.includes('locationHistory')) { exportData.client.locationHistory = AppState.locationHistory; }
        if (selectedParts.includes('deviceVisibility')) { exportData.client.deviceVisibility = AppState.deviceVisibility; }

        // Gather Server Data
        const serverPartsToFetch = selectedParts.filter(p => ['devices', 'geofences'].includes(p));
        if (serverPartsToFetch.length > 0) {
            try {
                for (const part of serverPartsToFetch) { console.log(`Fetching server part: ${part}`); const partData = await AppApi.getConfigPart(part); exportData.server[part] = partData; }
            } catch (error) { console.error("Error fetching server config parts for export:", error); errors.push(`Failed to fetch server part (${error.message})`); }
        }

        if (window.AppUI) AppUI.closeDialog('confirmation-dialog');

        if (errors.length > 0) { if (window.AppUI) AppUI.showErrorDialog("Export Failed", `Could not gather all selected configuration parts.<br>Errors: ${errors.join(', ')}`); return; }
        if (Object.keys(exportData.client).length === 0 && Object.keys(exportData.server).length === 0) { if (window.AppUI) AppUI.showErrorDialog("Export Error", "No data was gathered for the selected parts."); return; }

        // Trigger Download
        try {
            const jsonString = JSON.stringify(exportData, null, 2); const blob = new Blob([jsonString], { type: 'application/json' });
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); const filename = `findmyapp_config_${timestamp}.json`;
            const link = document.createElement('a'); link.href = window.URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link); window.URL.revokeObjectURL(link.href);
            console.log(`Config exported successfully as ${filename}`);
        } catch (error) { console.error("Error triggering config download:", error); if (window.AppUI) AppUI.showErrorDialog("Download Failed", `Could not create download file.<br>Details: ${error.message}`); }
    },

    handleImportFileSelected: async function (file) {
        console.log("[Action] Processing selected import file (handleImportFileSelected)...");
        // Target DIALOG elements consistently
        const statusMessage = document.getElementById('dialog-import-status-message');
        const partsSelectionDiv = document.getElementById('dialog-import-parts-selection');
        const confirmButton = document.getElementById('dialog-confirm-import-button');

        if (!statusMessage || !partsSelectionDiv || !confirmButton) {
            console.error("[Action Import] Dialog UI elements missing. Aborting file processing.");
            // Attempt to reset if elements are missing, might clear partial state
            if (window.AppUI) AppUI.resetImportDialog();
            return;
        }

        // Reset dialog state BEFORE processing (already done by AppUI.handleDialogImportFileSelection, but safe to repeat)
        AppState.clearImportData();
        partsSelectionDiv.style.display = 'none';
        partsSelectionDiv.innerHTML = '<h4 class="settings-section-title">Select Parts to Import</h4>';
        confirmButton.style.display = 'none';
        confirmButton.disabled = true;
        statusMessage.textContent = 'Reading file...';
        statusMessage.style.color = 'inherit';
        console.log(`[Action Import] Reading import file: ${file.name}`);

        try {
            const fileContent = await file.text();
            console.log("[Action Import] Import file read.");
            const parsedData = JSON.parse(fileContent);
            AppState.setImportData(parsedData); // Store parsed data
            console.log("[Action Import] Import file parsed:", parsedData);

            if (!parsedData.export_format || !parsedData.export_format.startsWith('findmyapp_combined_')) {
                throw new Error(`Unsupported format: ${parsedData.export_format || 'Unknown'}.`);
            }
            console.log(`[Action Import] Format validated: ${parsedData.export_format}`);

            const availableParts = {};
            // Corrected part definitions (matching export)
            const partDefinitions = {
                clientSettings: { name: 'UI/Map/Theme Settings', data: parsedData.client?.clientSettings },
                savedPlaces: { name: `Saved Places`, data: parsedData.client?.savedPlaces },
                locationHistory: { name: `Location History`, data: parsedData.client?.locationHistory },
                deviceVisibility: { name: `Device Visibility`, data: parsedData.client?.deviceVisibility },
                devices: { name: `Device Configs`, data: parsedData.server?.devices },
                geofences: { name: `Geofences`, data: parsedData.server?.geofences }
            };
            let hasParts = false;

            console.log("[Action Import] Checking available parts in JSON...");
            console.log("[Action Import] Parsed Client Data:", parsedData.client);
            console.log("[Action Import] Parsed Server Data:", parsedData.server);

            for (const partKey in partDefinitions) {
                const partInfo = partDefinitions[partKey];
                const dataToCheck = partKey.startsWith('client') ? parsedData.client?.[partKey] : parsedData.server?.[partKey];
                let count = 0;

                // console.log(`[Action Debug] Checking part: ${partKey}, Data:`, dataToCheck);

                if (dataToCheck !== null && dataToCheck !== undefined) {
                    if (Array.isArray(dataToCheck)) {
                        count = dataToCheck.length;
                    } else if (typeof dataToCheck === 'object' && Object.keys(dataToCheck).length > 0) {
                        count = Object.keys(dataToCheck).length;
                    } else if (typeof dataToCheck !== 'object' && !Array.isArray(dataToCheck)) {
                        // Allow single non-object/array value (like boolean in clientSettings)
                        // This wasn't the issue, but safer check
                        count = 1;
                    }
                    // --- FIX: Check for simple objects like clientSettings ---
                    // If it's an object but we didn't count keys, still count as 1 if it exists
                    else if (typeof dataToCheck === 'object' && count === 0) {
                        count = 1; // Treat presence of the object itself as 1 item
                        console.log(`[Action Debug] Part ${partKey} is an object, counting as 1.`);
                    }
                }

                console.log(`[Action Debug] Part: ${partKey}, Count: ${count}`);


                if (count > 0) {
                    availableParts[partKey] = `${partInfo.name}${Array.isArray(dataToCheck) ? ` (${count})` : ''}`; // Only show count for arrays
                    hasParts = true;
                }
            }

            console.log("[Action Import] Finished checking parts. Has parts:", hasParts, "Available:", availableParts);

            if (hasParts) {
                const fileInfoTime = parsedData.timestamp ? AppUtils.formatTimeRelative(new Date(parsedData.timestamp)) : 'N/A';
                statusMessage.textContent = `File Read. Format: ${parsedData.export_format}, Ver: ${parsedData.app_version || 'N/A'}, Created: ${fileInfoTime}`;
                partsSelectionDiv.innerHTML = '<h4 class="settings-section-title">Select Parts to Import</h4>'; // Ensure it's reset

                Object.keys(availableParts).forEach(partKey => {
                    const labelText = availableParts[partKey];
                    const label = document.createElement('label');
                    // --- USE DIALOG-SPECIFIC NAME for checkbox ---
                    label.innerHTML = `<input type="checkbox" name="dialog_import_part" value="${partKey}" checked> ${labelText}`;
                    partsSelectionDiv.appendChild(label);
                    console.log(`[Action UI] Added checkbox for: ${partKey}`);
                });

                partsSelectionDiv.style.display = 'block'; // Display the div
                confirmButton.style.display = 'inline-flex'; // Display the button
                confirmButton.disabled = false;
                console.log("[Action UI] Checkbox container and confirm button displayed.");
            } else {
                statusMessage.textContent = "No importable parts found in this file.";
                statusMessage.style.color = 'var(--m3-sys-color-error)';
                console.warn("[Action] No importable parts identified in the file.");
                // Keep confirm button hidden/disabled
                confirmButton.style.display = 'none';
                confirmButton.disabled = true;
            }
        } catch (error) {
            console.error("[Action] Error reading or parsing import file:", error);
            statusMessage.textContent = `Error reading file: ${error.message}`;
            statusMessage.style.color = 'var(--m3-sys-color-error)';
            AppState.clearImportData();
            // Reset UI elements (confirm button, parts selection) explicitly here
            if (partsSelectionDiv) partsSelectionDiv.style.display = 'none';
            if (confirmButton) {
                confirmButton.style.display = 'none';
                confirmButton.disabled = true;
            }
        }
    }, // End handleImportFileSelected

    handleImportConfirm: async function () {
        console.log("[Action] Confirm Import button clicked.");
        // Target DIALOG elements
        const statusMessage = document.getElementById('dialog-import-status-message');
        const partsSelectionDiv = document.getElementById('dialog-import-parts-selection');
        const confirmButton = document.getElementById('dialog-confirm-import-button');

        if (!statusMessage || !partsSelectionDiv || !confirmButton) {
            console.error("[Action Import] Dialog confirm UI elements missing."); return;
        }

        // --- Query using DIALOG-SPECIFIC checkbox name ---
        const selectedParts = Array.from(partsSelectionDiv.querySelectorAll('input[name="dialog_import_part"]:checked')).map(cb => cb.value);
        const importedData = AppState.getImportData();

        if (selectedParts.length === 0) { statusMessage.textContent = "Please select at least one part to import."; statusMessage.style.color = 'var(--m3-sys-color-error)'; return; }
        if (!importedData) { statusMessage.textContent = "Import data not found. Please select file again."; statusMessage.style.color = 'var(--m3-sys-color-error)'; AppUI.resetImportDialog(); return; }

        confirmButton.disabled = true; // Disable button immediately
        confirmButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Checking...`;
        statusMessage.textContent = `Checking for potential overwrites...`; statusMessage.style.color = 'inherit';

        let needsOverwriteConfirm = false; let overwriteItems = [];
        const getPartName = (partKey) => ({ devices: 'Device configurations', geofences: 'Geofences', savedPlaces: 'Saved Places', locationHistory: 'Location History', clientSettings: 'UI/Map/Theme settings', deviceVisibility: 'Device visibility' }[partKey] || partKey);
        const hasExisting = (partKey) => { switch (partKey) { case 'devices': return AppState.currentDeviceData.length > 0; case 'geofences': return AppState.globalGeofenceData.length > 0; case 'savedPlaces': return AppState.savedPlaces.length > 0; case 'locationHistory': return AppState.locationHistory.length > 0; case 'clientSettings': return true; case 'deviceVisibility': return Object.keys(AppState.deviceVisibility).length > 0; default: return false; } };

        selectedParts.forEach(partKey => {
            const dataToCheck = partKey.startsWith('client') ? importedData.client?.[partKey] : importedData.server?.[partKey];
            // Check if the part exists in the import data AND there's existing data for that part locally
            if (dataToCheck !== undefined && dataToCheck !== null && hasExisting(partKey)) {
                const partName = getPartName(partKey);
                if (!overwriteItems.includes(partName)) {
                    needsOverwriteConfirm = true;
                    overwriteItems.push(partName);
                }
            }
        });

        // --- Restore button if only checking and no overwrite needed immediately ---
        if (!needsOverwriteConfirm) {
            confirmButton.disabled = false;
            confirmButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">save</span> Import Selected`;
        }
        // --- --------------------------------------------------------------- ---

        if (needsOverwriteConfirm) {
            const confirmationMessage = `Importing selected parts (${overwriteItems.join(', ')}) will <strong>completely replace</strong> existing data for those parts. Continue?`;
            console.log("[Action] Showing overwrite confirmation.");
            // Show overwrite confirmation
            AppUI.showConfirmationDialog("Confirm Overwrite", confirmationMessage,
                () => { // onConfirm: User agreed to overwrite
                    console.log("[Action] Overwrite confirmed.");
                    confirmButton.disabled = true; // Disable again before proceeding
                    confirmButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Importing...`;
                    statusMessage.textContent = 'Proceeding with import...';
                    // Use setTimeout to allow UI update before blocking with _proceedWithImport
                    setTimeout(() => AppActions._proceedWithImport(selectedParts, importedData), 50);
                },
                () => { // onCancel: User cancelled overwrite
                    console.log("[Action] Overwrite cancelled.");
                    statusMessage.textContent = "Import cancelled.";
                    // Re-enable the button in the import dialog
                    confirmButton.disabled = false;
                    confirmButton.innerHTML = `<span class="material-icons" style="font-size: 18px; vertical-align: bottom; margin-right: 4px;">save</span> Import Selected`;
                }
            );
        } else {
            console.log("[Action] No overwrite needed. Proceeding directly.");
            confirmButton.disabled = true; // Disable before proceeding
            confirmButton.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 auto;"></div> Importing...`;
            statusMessage.textContent = 'Proceeding with import...';
            // Use setTimeout to allow UI update
            setTimeout(() => AppActions._proceedWithImport(selectedParts, importedData), 50);
        }
    }, // End handleImportConfirm

    _proceedWithImport: async function (selectedParts, importedData) {
        console.log("[Action] Proceeding with import processing for parts:", selectedParts);
        let clientImported = false; let serverImported = false;
        const serverPartsPayload = {}; const clientErrors = []; const serverErrors = [];
        // Target DIALOG status message initially
        const statusMessage = document.getElementById('dialog-import-status-message');

        if (statusMessage) statusMessage.textContent = `Importing selected parts (${selectedParts.join(', ')})...`;

        // --- Process Client Parts (Keep existing logic) ---
        console.log("[Action] Processing client parts...");
        try {
            if (selectedParts.includes('clientSettings') && importedData.client?.clientSettings) {
                console.log("[Action] Importing client settings...");
                const settings = importedData.client.clientSettings;
                // Apply settings to AppState and call save functions
                if (settings.theme_mode !== undefined) AppState.currentTheme = settings.theme_mode;
                if (settings.theme_color !== undefined) AppState.userColor = settings.theme_color;
                if (window.AppTheme && typeof window.AppTheme.applyTheme === 'function') {
                    AppTheme.applyTheme(AppState.userColor, AppState.currentTheme); // Apply visually
                }
                if (settings.isShowingAllDevices !== undefined) AppState.isShowingAllDevices = settings.isShowingAllDevices;
                if (settings.showDeviceHistory !== undefined) AppState.showDeviceHistory = settings.showDeviceHistory;
                if (settings.historyTimeFilterHours !== undefined) AppState.historyTimeFilterHours = parseInt(settings.historyTimeFilterHours, 10) || AppState.historyTimeFilterHours;
                if (settings.locationHistoryEnabled !== undefined) AppState.locationHistoryEnabled = settings.locationHistoryEnabled;

                // Save persistent client state
                AppState.saveMapToggles();
                AppState.saveLocationHistoryEnabled();
                AppState.saveTheme(); // Save theme mode to localStorage

                clientImported = true; console.log("[Action] Client settings imported and saved locally.");
            }
            if (selectedParts.includes('savedPlaces') && importedData.client?.savedPlaces) {
                console.log("[Action] Importing saved places...");
                AppState.savedPlaces = importedData.client.savedPlaces;
                AppState.saveSavedPlaces();
                clientImported = true;
            }
            if (selectedParts.includes('locationHistory') && importedData.client?.locationHistory) {
                console.log("[Action] Importing location history...");
                AppState.locationHistory = importedData.client.locationHistory;
                AppState.saveLocationHistory();
                clientImported = true;
            }
            if (selectedParts.includes('deviceVisibility') && importedData.client?.deviceVisibility) {
                console.log("[Action] Importing device visibility...");
                AppState.deviceVisibility = importedData.client.deviceVisibility;
                AppState.saveDeviceVisibilityState();
                clientImported = true;
            }
        } catch (e) {
            clientErrors.push(`Client settings import failed: ${e.message}`);
            console.error("[Action] Client import error:", e);
        }

        // --- Prepare & Process Server Parts (Keep existing logic) ---
        console.log("[Action] Preparing server parts...");
        if (selectedParts.includes('devices') && importedData.server?.devices) serverPartsPayload.devices = importedData.server.devices;
        if (selectedParts.includes('geofences') && importedData.server?.geofences) serverPartsPayload.geofences = importedData.server.geofences;

        const hasServerParts = Object.keys(serverPartsPayload).length > 0;
        if (hasServerParts) {
            console.log("[Action] Sending server config parts to backend:", Object.keys(serverPartsPayload));
            try {
                const serverResult = await AppApi.applyImportedConfig(serverPartsPayload);
                serverImported = true;
                console.log("[Action] Server config import response:", serverResult);
                if (serverResult.details?.errors?.length > 0) serverErrors.push(...serverResult.details.errors);
            }
            catch (e) {
                serverErrors.push(`Server config import API call failed: ${e.message}`);
                console.error("[Action] Server config import API error:", e);
            }
        }

        // Save theme prefs separately if client settings were chosen AND changed, and no other server parts sent
        const hasThemeParts = selectedParts.includes('clientSettings');
        if (hasThemeParts && !hasServerParts && clientErrors.length === 0) {
            console.log("[Action] Saving theme preferences to backend.");
            try {
                await AppApi.updateUserPreferences(AppState.currentTheme, AppState.userColor);
                serverImported = true; // Mark server interaction
                console.log("[Action] Theme preferences saved successfully.");
            } catch (e) {
                serverErrors.push(`Failed to save theme preferences: ${e.message}`);
                console.error("[Action] Theme preferences save API error:", e);
            }
        }

        // --- Determine final status ---
        let finalMessage = "";
        let isSuccess = false;
        if (clientErrors.length === 0 && serverErrors.length === 0) {
            if (clientImported || serverImported) {
                finalMessage = "Import complete.";
                isSuccess = true;
            } else {
                finalMessage = "Import finished, but no changes were selected or applied.";
                isSuccess = true; // Not an error
            }
        } else {
            finalMessage = "Import completed with errors: " + [...clientErrors, ...serverErrors].join('; ');
            isSuccess = false;
        }

        // --- REVISED DIALOG HANDLING ---
        // 1. Close the import dialog FIRST
        AppUI.closeDialog('config-import-dialog'); // Ensure this uses the correct ID

        // 2. Show the final status using appropriate dialog
        if (isSuccess) {
            AppUI.showConfirmationDialog("Import Result", finalMessage, () => {
                // 3. Refresh AFTER user dismisses the success dialog
                if (clientImported || serverImported) { // Only refresh if changes were made
                    console.log("[Action] Refreshing UI and data after successful import confirmation...");
                    AppUI.setupSettingsPage(); // Update settings page UI elements
                    AppActions.refreshGeofencesAndDevices().then(() => { // Fetch latest server data
                        AppUI.renderSavedPlacesList();
                        AppUI.renderLocationHistory();
                        console.log("[Action] UI and data refresh complete post-import.");
                    });
                }
            });
        } else {
            AppUI.showErrorDialog("Import Failed", finalMessage);
            // No automatic refresh on error
        }
        // --- END REVISED DIALOG HANDLING ---
    }, // End _proceedWithImport

    handleDeleteAccount: async function () {
        console.log("Account deletion confirmed by user. Calling API...");
        AppUI.showConfirmationDialog("Deleting...", "Deleting your account and data...", null, null);
        const progressDialog = document.getElementById('confirmation-dialog');
        if (progressDialog) progressDialog.querySelector('.dialog-actions').style.display = 'none';

        try {
            const result = await AppApi.deleteAccount();
            console.log("Account deletion successful on backend:", result);

            // --- MODIFIED: Frontend logout and redirect ---
            console.log("Account deleted. Logging out and redirecting...");
            // Clear specific relevant local storage items instead of everything
            localStorage.removeItem('isShowingAllDevices');
            localStorage.removeItem('showDeviceHistory');
            localStorage.removeItem('historyTimeFilterHours');
            localStorage.removeItem('deviceVisibility');
            localStorage.removeItem('locationHistoryEnabled');
            localStorage.removeItem('locationHistory');
            localStorage.removeItem('savedPlaces');
            localStorage.removeItem('theme'); // Keep theme? Maybe. Let's remove for clean slate.
            localStorage.removeItem('userColor');
            localStorage.removeItem('lastActivePageId');
            console.log("Cleared user-specific localStorage items.");

            // Redirect via logout route to ensure server session is also cleared
            window.location.href = '/logout';
            // --- END MODIFICATION ---

        } catch (error) {
            console.error("Account deletion failed:", error);
            AppUI.closeDialog('confirmation-dialog');
            AppUI.showErrorDialog("Deletion Failed", `Could not delete account: ${error.message}`);
        }
    }, // --- End Handle Account Deletion ---
};

// --- Main Initialization Sequence ---
async function initializeApp() {
    console.log(`FindMy App (${window.AppConfig?.APP_VERSION || '?.?.?'}) Initializing...`);
    function addLoadingClass() { if (document.body) { document.body.classList.add('app-loading'); } else { requestAnimationFrame(addLoadingClass); } } addLoadingClass();
    const m3UtilsLocalPath = '/static/libs/material-color/material-color-utilities.esm.js';
    try { await loadLocalModuleFallback(m3UtilsLocalPath, 'M3ColorUtils'); } catch (err) { console.error("Critical error loading Material Color Utilities.", err); }

    AppState.loadInitialState(); // Load theme prefs, toggles etc first

    // Fetch user prefs early for themeing
    try {
        const prefs = await AppApi.fetchUserPreferences(); // Await prefs
        AppState.setCurrentUserPreferences(prefs);
    } catch (error) {
        console.error("Failed to fetch user preferences:", error);
        // Use defaults already set in AppState
    }

    // Initialize theme *after* loading preferences
    if (window.AppTheme && typeof window.AppTheme.initializeTheme === 'function') {
        AppTheme.initializeTheme();
    } else {
        console.error("AppTheme init error.");
        // Apply basic fallback class based on AppState pref
        const isDarkFallback = AppTheme.isDarkModeActive(AppState.currentTheme);
        document.documentElement.classList.add(isDarkFallback ? 'dark-theme' : 'light-theme'); // Apply to HTML
    }

    // Setup basic UI listeners etc.
    AppUI.setupSettingsPage();
    AppActions.initDebouncedSearch();


    // --- *** AWAIT Initial Data Fetch BEFORE Navigating *** ---
    try {
        console.log("[Init] Starting fetchInitialData...");
        await AppActions.fetchInitialData(); // <<< ADD await HERE
        console.log("[Init] fetchInitialData COMPLETED.");
    } catch (err) {
        console.error("[Init] Initial data fetch failed:", err);
        // Error is already handled/shown by fetchInitialData/_updateDeviceUI
    }
    // --- *************************************************** ---

    // --- Initialize Map AFTER potentially getting initial device data ---
    // Check if the initially determined page is the map page
    const initialPageId = AppState.getLastActivePageId();
    if (initialPageId === 'index') {
        if (window.AppMap && typeof window.AppMap.initMap === 'function') {
            AppMap.initMap(); // Initialize map if starting on map page
        } else {
            console.error("AppMap or AppMap.initMap not found!");
            if (window.AppUI) AppUI.showErrorDialog("Map Error", "Could not load map component.");
        }
    } else {
        console.log("Skipping initial map load as not starting on map page.");
    }
    // --- End Map Initialization ---


    // --- Navigate to Initial Page AFTER data fetch attempt ---
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const pageParam = urlParams.get('page');
        if (pageParam) {
            const validPages = ['index', 'shared', 'scanner', 'geofences', 'settings', 'notifications-history']; // Ensure 'scanner' is valid
            if (validPages.includes(pageParam)) {
                AppUI.changePage(pageParam); // Navigate to param if valid
            } else {
                console.warn(`[Init] Invalid page parameter '${pageParam}'. Navigating to default.`);
                AppUI.navigateToInitialPage(); // Navigate based on localStorage or default
            }
        } else {
            AppUI.navigateToInitialPage(); // Navigate based on localStorage or default
        }
    } catch (e) {
        console.error("[Init] Error handling initial page navigation:", e);
        AppUI.navigateToInitialPage(); // Fallback
    }
    // --- End Initial Navigation ---

    // --- Service Worker Registration & Message Listener ---
    if (window.AppNotifications) {
        AppNotifications.registerServiceWorker()
            .then(() => console.log("SW reg sequence complete."))
            .catch(error => console.error("SW reg failed:", error));

        // *** ADD LISTENER HERE ***
        // Listen for messages from the Service Worker AFTER initiating registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                console.log('[App] Received message from SW:', event.data);

                // --- Cloudflare Auth Handling ---
                if (event.data && event.data.type === 'CLOUDFLARE_AUTH_REQUIRED') {
                    console.warn('[App] Received Cloudflare Auth required message from SW.');
                    const existingPrompt = document.getElementById('confirmation-dialog-overlay');
                    // Only show prompt if one isn't already visible
                    if (!existingPrompt || !existingPrompt.classList.contains('show')) {
                        if (window.AppUI && typeof window.AppUI.showCloudflareReauthPrompt === 'function') {
                            // Show the specific prompt to reload for Cloudflare
                            AppUI.showCloudflareReauthPrompt(event.data.url || 'a required resource');
                        } else {
                            console.error("[App] AppUI or showCloudflareReauthPrompt not available when needed!");
                            // Fallback alert (less ideal)
                            alert("Your security session may have expired. Please reload the page to re-authenticate.");
                        }
                    } else {
                        console.log("[App] Cloudflare prompt already visible, ignoring duplicate message.");
                    }
                }
                // --- SW Update Handling ---
                else if (event.data && event.data.type === 'SW_UPDATE') {
                    console.log('[Client] SW Update Available message received.');
                    if (window.AppUI && typeof window.AppUI.showUpdateAvailablePrompt === 'function') {
                        AppUI.showUpdateAvailablePrompt(event.source); // Pass the worker source if needed
                    } else {
                        if (confirm("A new version is available. Refresh now?")) { window.location.reload(); }
                    }
                }
                // --- Focus Device Handling ---
                else if (event.data?.type === 'focusDevice' && event.data.deviceId) {
                    console.log(`[Client] Received focus message for device ${event.data.deviceId}`);
                    if (window.AppMap && AppState.mapReady) {
                        AppMap.viewDeviceOnMap(event.data.deviceId);
                    } else { console.warn("[Client] Map not ready, cannot focus device from SW message immediately."); }
                }
                // --- Add other message type handlers here ---

            });
            console.log("[App] Service Worker message listener attached."); // Log attachment
        }
        // *** END LISTENER ADDITION ***

    } else {
        console.error("AppNotifications not found!");
    }

    // Mark app as loaded
    if (document.body) { document.body.classList.remove('app-loading'); document.body.classList.add('app-loaded'); console.log("App marked as loaded."); }
    else { window.addEventListener('load', () => { if (document.body) { document.body.classList.remove('app-loading'); document.body.classList.add('app-loaded'); } }); }

    // Setup refresh button listener (ensure it's only added once)
    const refreshButton = document.getElementById('refresh-devices-button');
    if (refreshButton && !refreshButton._clickListenerAttached) {
        refreshButton.addEventListener('click', () => AppActions.refreshDevices(true));
        refreshButton._clickListenerAttached = true; // Add flag
    } else if (!refreshButton) {
        console.warn("Refresh button not found during init.");
    }

    // Start periodic updates and listeners
    if (window.AppUI && typeof AppUI.updateRelativeTimes === 'function') {
        // Clear existing interval if re-initializing (though this shouldn't happen often)
        if (window._relativeTimeUpdaterInterval) clearInterval(window._relativeTimeUpdaterInterval);
        window._relativeTimeUpdaterInterval = setInterval(AppUI.updateRelativeTimes, 60 * 1000);
        console.log("Relative time updater started.");
    }
    // Clear existing interval if re-initializing
    if (window._deviceRefreshInterval) clearInterval(window._deviceRefreshInterval);
    window._deviceRefreshInterval = setInterval(() => AppActions.refreshDevices(false), AppConfig.FETCH_DEVICES_INTERVAL);
    console.log(`Automatic data refresh interval started (${AppConfig.FETCH_DEVICES_INTERVAL / 1000}s).`);
    const lastUpdatedEl = document.getElementById('last-updated-text');
    if (lastUpdatedEl) { const handleLastUpdatedClick = (e) => { AppUI.changePage('history'); }; lastUpdatedEl.addEventListener('click', handleLastUpdatedClick); lastUpdatedEl.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLastUpdatedClick(e); } }); } else { console.warn("last-updated-text not found."); }



    function setupMapListeners() {
        // Check for Leaflet (L), AppMap, and AppUI readiness
        if (typeof L !== 'undefined' && window.AppMap && window.AppUI) {
            console.log("Setting up Leaflet-dependent event listeners.");
            const indexPage = document.getElementById('index-page');
            indexPage?.addEventListener('click', (e) => {
                const buttonId = e.target.closest('.map-control-button')?.id;
                const mapInstance = AppState.getMap(); // Get map instance
                if (!mapInstance) return; // Don't act if map isn't ready

                if (buttonId === 'zoom-in') mapInstance.zoomIn();
                else if (buttonId === 'zoom-out') mapInstance.zoomOut();
                else if (buttonId === 'my-location') AppMap.locateMe();
                else if (buttonId === 'show-all-button') AppUI.toggleShowAllDevices();
                else if (buttonId === 'show-history-button') AppUI.toggleShowHistory();
            });
            document.getElementById('refresh-button')?.addEventListener('click', () => AppMap.locateMe());
            // Add other Leaflet-dependent listeners here if needed
        } else {
            console.warn("Leaflet (L) or AppMap/AppUI not defined when setting up map event listeners. Retrying...");
            setTimeout(setupMapListeners, 500); // Retry after a delay
        }
    }
    setTimeout(setupMapListeners, 100); // Initial attempt after small delay

    // Setup listeners NOT dependent on Leaflet
    const mainContent = document.getElementById('main-content');
    const body = document.body;
    const searchInput = document.getElementById('location-search-input');
    const searchResultsContainer = document.getElementById('search-results-container');
    document.getElementById('menu-button')?.addEventListener('click', () => AppUI.openDrawer());
    document.getElementById('drawer-overlay')?.addEventListener('click', () => AppUI.closeDrawer());
    document.getElementById('drawer-close-button')?.addEventListener('click', () => AppUI.closeDrawer());
    document.getElementById('drawer')?.addEventListener('click', (e) => {
        const drawerItem = e.target.closest('.drawer-item');
        const anchor = e.target.closest('a');
        if (!drawerItem && !anchor) return;
        const page = drawerItem?.dataset.page || anchor?.dataset.page;
        const dialog = drawerItem?.dataset.dialog || anchor?.dataset.dialog;
        const targetAction = anchor?.dataset.target;
        const section = drawerItem?.dataset.section || anchor?.dataset.section;

        if (anchor && anchor.href.includes('logout')) { AppUI.closeDrawer(); return; }
        else if (anchor && anchor.href.includes('manage_apple_creds')) { AppUI.closeDrawer(); return; }
        else if (page) { e.preventDefault(); AppUI.changePage(page, section); AppUI.closeDrawer(); }
        else if (dialog) { e.preventDefault(); AppUI.openDialog(dialog); AppUI.closeDrawer(); }
    });
    document.getElementById('more-button')?.addEventListener('click', (e) => { e.stopPropagation(); AppUI.openMoreMenu(); });
    document.getElementById('more-menu-dialog-overlay')?.addEventListener('click', () => AppUI.closeMoreMenu());
    document.querySelector('.bottom-nav')?.addEventListener('click', (e) => {
        const navLink = e.target.closest('.nav-link');
        if (navLink && navLink.dataset.page) { e.preventDefault(); AppUI.changePage(navLink.dataset.page); }
    });
    body.addEventListener('click', (e) => {
        const closeButton = e.target.closest('[data-close-dialog]');
        if (closeButton) { AppUI.closeDialog(closeButton.dataset.closeDialog); }
        else if (e.target.classList.contains('dialog-overlay') && !e.target.id.includes('more-menu')) { const dialogId = e.target.id.replace('-overlay', ''); AppUI.closeDialog(dialogId); }
    });
    document.getElementById('add-place-button')?.addEventListener('click', () => AppUI.openAddPlaceDialog());
    document.getElementById('add-place-dialog-button')?.addEventListener('click', () => AppUI.handleAddPlaceSubmit());
    document.getElementById('share-button')?.addEventListener('click', () => { AppUI.openDialog('share-location-dialog'); AppUI.copyShareLocationText(); });
    document.getElementById('copy-share-button')?.addEventListener('click', () => AppUI.copyShareLocationText());
    document.getElementById('refresh-devices-button')?.addEventListener('click', () => AppActions.refreshDevices());
    document.getElementById('clear-history-button')?.addEventListener('click', () => { AppUI.showConfirmationDialog("Clear History?", "Are you sure you want to clear all your location history?", () => { AppState.clearLocationHistory(); AppUI.renderLocationHistory(); }); });
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length === 0) { AppUI.hideSearchResults(); }
            else { AppActions._debouncedSearchHandler(query); }
        });
        searchInput.addEventListener('focus', (e) => {
            const query = e.target.value.trim();
            if (query.length >= 2) { AppActions.performSearch(query); }
        });
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const firstResult = searchResultsContainer?.querySelector('.search-result-item');
                if (firstResult) { firstResult.click(); }
            }
        });
        document.addEventListener('click', (event) => {
            if (!searchInput.contains(event.target) && !searchResultsContainer?.contains(event.target) && !event.target.closest('.app-bar')) {
                AppUI.hideSearchResults();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && searchResultsContainer?.classList.contains('show')) {
                AppUI.hideSearchResults();
                searchInput.blur();
            }
        });
    }
    document.getElementById('add-global-geofence-button')?.addEventListener('click', () => AppUI.openAddGlobalGeofenceDialog());
    document.getElementById('test-notification-button')?.addEventListener('click', () => AppNotifications.handleTestNotification());
    const globalGeofencesList = document.getElementById('global-geofences-list');
    globalGeofencesList?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.geofence-edit');
        const removeBtn = e.target.closest('.geofence-remove');
        const item = e.target.closest('.settings-item[data-geofence-id]');
        if (editBtn) { e.stopPropagation(); AppUI.openEditGlobalGeofenceDialog(editBtn.dataset.geofenceId); }
        else if (removeBtn) { e.stopPropagation(); const id = removeBtn.dataset.geofenceId; const name = item?.querySelector('.settings-item-title')?.textContent || id; AppUI.confirmRemoveItem('geofence', id, name, AppActions.handleRemoveGlobalGeofence); }
        else if (item) { AppUI.openEditGlobalGeofenceDialog(item.dataset.geofenceId); }
    });
    globalGeofencesList?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const item = e.target.closest('.settings-item[data-geofence-id]');
            if (item && !e.target.closest('.geofence-edit, .geofence-remove')) { e.preventDefault(); AppUI.openEditGlobalGeofenceDialog(item.dataset.geofenceId); }
        }
    });
    const deviceGeofenceLinksList = document.getElementById('device-geofence-links-list');
    deviceGeofenceLinksList?.addEventListener('click', (e) => {
        const unlinkBtn = e.target.closest('.geofence-remove[data-geofence-id]');
        const linkBtn = e.target.closest('.link-geofence-button');
        const saveBtn = e.target.closest('.save-links-button[data-device-id]');
        const cardElement = e.target.closest('.device-geofence-card');
        if (!cardElement) return;
        const deviceId = cardElement.id.replace('device-link-card-', '');
        if (unlinkBtn) {
            e.stopPropagation();
            const geofenceIdToUnlink = unlinkBtn.dataset.geofenceId;
            const itemToRemove = cardElement.querySelector(`.geofence-link-item[data-geofence-id="${geofenceIdToUnlink}"]`);
            if (itemToRemove) { itemToRemove.remove(); cardElement.querySelector('.save-links-button').style.display = 'inline-flex'; AppUI.renderAddGeofenceDropdown(cardElement, deviceId); if (cardElement.querySelectorAll('.geofence-link-item').length === 0) { cardElement.querySelector('.linked-geofences-list').innerHTML = '<p class="no-geofences-message" style="padding: 8px 0; font-style: italic; opacity: 0.7;">No geofences linked yet.</p>'; } }
        } else if (linkBtn) {
            e.stopPropagation();
            const selectElement = cardElement.querySelector('.add-geofence-select');
            const geofenceIdToAdd = selectElement.value;
            const errorElement = cardElement.querySelector(`#link-error-${deviceId}`);
            errorElement.style.display = 'none';
            if (!geofenceIdToAdd) { errorElement.textContent = 'Please select a geofence to link.'; errorElement.style.display = 'block'; return; }
            const geofenceToAdd = AppState.globalGeofenceData.find(gf => gf.id === geofenceIdToAdd);
            if (!geofenceToAdd) { errorElement.textContent = 'Selected geofence definition not found.'; errorElement.style.display = 'block'; return; }
            const list = cardElement.querySelector('.linked-geofences-list');
            const noItemsMsg = list.querySelector('.no-geofences-message');
            if (noItemsMsg) noItemsMsg.remove();
            const newLinkItem = document.createElement('div');
            newLinkItem.className = 'geofence-link-item'; newLinkItem.dataset.geofenceId = geofenceIdToAdd;
            newLinkItem.innerHTML = `<div class="geofence-link-info"><div class="geofence-link-name">${geofenceToAdd.name}</div><div class="geofence-link-details">Radius: ${geofenceToAdd.radius}m</div></div><div class="geofence-link-toggles"><label class="geofence-link-toggle-label" title="Notify on Entry"><input type="checkbox" data-notify-type="entry"> Entry</label><label class="geofence-link-toggle-label" title="Notify on Exit"><input type="checkbox" data-notify-type="exit"> Exit</label><span class="material-icons geofence-remove" title="Unlink Geofence" data-geofence-id="${geofenceIdToAdd}" style="margin-left: 8px; cursor: pointer; opacity: 0.6; color: var(--m3-sys-color-error);" tabindex="0" role="button" aria-label="Unlink ${geofenceToAdd.name}">link_off</span></div>`; list.appendChild(newLinkItem); cardElement.querySelector('.save-links-button').style.display = 'inline-flex'; AppUI.renderAddGeofenceDropdown(cardElement, deviceId);
        } else if (saveBtn) { e.stopPropagation(); AppActions.handleSaveDeviceGeofenceLinks(deviceId, cardElement); }
    });
    deviceGeofenceLinksList?.addEventListener('change', (e) => {
        if (e.target.matches('.geofence-link-toggles input[type="checkbox"]')) {
            const cardElement = e.target.closest('.device-geofence-card');
            if (cardElement) { cardElement.querySelector('.save-links-button').style.display = 'inline-flex'; }
        }
    });
    const settingsPage = document.getElementById('settings-page');
    settingsPage?.addEventListener('change', (e) => {
        if (e.target.id === 'location-history-toggle') { AppState.locationHistoryEnabled = e.target.checked; AppState.saveLocationHistoryEnabled(); console.log("Location history enabled:", AppState.locationHistoryEnabled); if (!AppState.locationHistoryEnabled) { AppState.clearLocationHistory(); } if (document.getElementById('history-page')?.style.display === 'block') { AppUI.renderLocationHistory(); } }
        else if (e.target.id === 'show-all-default-toggle') { AppState.isShowingAllDevices = e.target.checked; AppState.saveMapToggles(); if (document.getElementById('index-page')?.style.display !== 'none' && window.AppUI) { AppUI.updateShowAllButtonState(); AppMap.updateMapView(); } }
        else if (e.target.id === 'show-history-default-toggle') { AppState.showDeviceHistory = e.target.checked; AppState.saveMapToggles(); if (document.getElementById('index-page')?.style.display !== 'none' && window.AppUI) { AppUI.updateShowHistoryButtonState(); AppMap.updateHistoryLayersVisibility(); } }
    });
    document.getElementById('enable-notifications-button')?.addEventListener('click', () => AppNotifications.handleNotificationPermission());
    document.getElementById('unsubscribe-button')?.addEventListener('click', () => AppNotifications.unsubscribeUser());
    // document.getElementById('test-notification-button')?.addEventListener('click', () => AppNotifications.handleTestNotification('test')); // Moved to setupSettingsPage
    const sharedDevicesList = document.getElementById('shared-devices-list');
    sharedDevicesList?.addEventListener('click', (e) => {
        const deviceItem = e.target.closest('.shared-device[data-device-id]');
        const menuButton = e.target.closest('.device-menu[data-device-index]');
        const visibilityToggle = e.target.closest('.device-visibility-toggle input');
        if (visibilityToggle) { /* Handled by change listener */ }
        else if (menuButton) { e.stopPropagation(); const index = parseInt(menuButton.dataset.deviceIndex, 10); AppUI.openDeviceMenu(index, menuButton); }
        else if (deviceItem && window.AppMap) { AppMap.viewDeviceOnMap(deviceItem.dataset.deviceId); }
    });
    sharedDevicesList?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const deviceItem = e.target.closest('.shared-device[data-device-id]');
            const menuButton = e.target.closest('.device-menu[data-device-index]');
            const visibilityToggle = e.target.closest('.device-visibility-toggle input');
            if (visibilityToggle) { e.preventDefault(); visibilityToggle.click(); }
            else if (menuButton) { e.preventDefault(); const index = parseInt(menuButton.dataset.deviceIndex, 10); AppUI.openDeviceMenu(index, menuButton); }
            else if (deviceItem && window.AppMap) { e.preventDefault(); AppMap.viewDeviceOnMap(deviceItem.dataset.deviceId); }
        }
    });
    sharedDevicesList?.addEventListener('change', (e) => { if (e.target.matches('.device-visibility-toggle input[data-device-id]')) { AppUI.handleDeviceVisibilityToggle(e.target); } });
    const savedPlacesList = document.getElementById('saved-places-list');
    savedPlacesList?.addEventListener('click', (e) => {
        const placeItem = e.target.closest('.shared-device[data-place-index]');
        const menuButton = e.target.closest('.device-menu[data-place-index]');
        if (menuButton) { e.stopPropagation(); const index = parseInt(menuButton.dataset.placeIndex, 10); AppUI.openPlaceMenu(index, menuButton); }
        else if (placeItem && window.AppMap) { const index = parseInt(placeItem.dataset.placeIndex, 10); AppMap.viewPlaceOnMap(index); }
    });
    savedPlacesList?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const placeItem = e.target.closest('.shared-device[data-place-index]');
            const menuButton = e.target.closest('.device-menu[data-place-index]');
            if (menuButton) { e.preventDefault(); const index = parseInt(menuButton.dataset.placeIndex, 10); AppUI.openPlaceMenu(index, menuButton); }
            else if (placeItem && window.AppMap) { e.preventDefault(); const index = parseInt(placeItem.dataset.placeIndex, 10); AppMap.viewPlaceOnMap(index); }
        }
    });
    document.getElementById('export-config-button')?.addEventListener('click', AppActions.handleExportConfig);
    document.getElementById('import-config-file-input')?.addEventListener('change', AppUI.handleImportFileSelection); // UI handles change
    document.getElementById('confirm-import-button')?.addEventListener('click', AppActions.handleImportConfirm); // Action handles confirm
    document.getElementById('place-picker-my-location')?.addEventListener('click', () => AppMap.centerDialogMapOnUserLocation('place'));
    document.getElementById('geofence-picker-my-location')?.addEventListener('click', () => AppMap.centerDialogMapOnUserLocation('geofence'));
    document.getElementById('delete-account-button')?.addEventListener('click', () => {
        AppUI.showConfirmationDialog(
            "Delete Account?",
            "<strong>This action is permanent and cannot be undone.</strong><br>All your devices, geofences, settings, and stored credentials will be deleted.<br><br>Are you absolutely sure you want to delete your account?",
            () => { // onConfirm - Now calls the AppActions handler
                AppActions.handleDeleteAccount(); // <<< CALL ACTION HANDLER
            },
            () => { console.log("Account deletion cancelled."); } // onCancel
        );
    });

    // Notification History Page Listeners
    document.getElementById('mark-all-read-button')?.addEventListener('click', () => AppUI.handleMarkAllRead());
    document.getElementById('clear-all-history-button')?.addEventListener('click', () => AppUI.handleClearAllHistory());

    console.log("App initialization sequence complete.");
}

// --- Main Initialization Trigger ---
document.addEventListener('DOMContentLoaded', initializeApp);