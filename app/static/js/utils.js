// app/static/js/utils.js

window.AppUtils = {

    /**
     * Basic HTML escaping function.
     * Replaces characters that have special meaning in HTML.
     * @param {string} unsafe String potentially containing HTML.
     * @returns {string} Escaped string.
     */
    escapeHtml: function (unsafe) {
        if (typeof unsafe !== 'string') {
            return unsafe; // Return non-strings as is
        }
        return unsafe
            .replace(/&/g, "&")
            .replace(/</g, "<")
            .replace(/>/g, ">")
            .replace(/"/g, '"')
            .replace(/'/g, "'");
    },


    /**
     * Generates a default hex color based on a string ID.
     * @param {string} id_str The input string ID.
     * @returns {string} A hex color string (e.g., "#aabbcc").
     */
    getDefaultColorForId: function (id_str) {
        if (!id_str || id_str.length === 0) return '#70757a';
        let hash = 0;
        for (let i = 0; i < id_str.length; i++) {
            hash = id_str.charCodeAt(i) + ((hash << 5) - hash);
            hash &= hash; // Convert to 32bit integer
        }
        hash = Math.abs(hash);
        const r = (hash & 0xFF0000) >> 16;
        const g = (hash & 0x00FF00) >> 8;
        const b = hash & 0x0000FF;
        const avg = (r + g + b) / 3;
        const factor = 0.6; // Brightness adjustment factor
        const nr = Math.min(255, Math.max(0, r + (128 - avg) * factor));
        const ng = Math.min(255, Math.max(0, g + (128 - avg) * factor));
        const nb = Math.min(255, Math.max(0, b + (128 - avg) * factor));
        return `#${Math.round(nr).toString(16).padStart(2, '0')}${Math.round(ng).toString(16).padStart(2, '0')}${Math.round(nb).toString(16).padStart(2, '0')}`;
    },

    /**
     * Formats a Date object into a localized string.
     * @param {Date} date The Date object.
     * @returns {string} Formatted date/time string or "Invalid date".
     */
    formatTime: function (date) {
        if (!date || !(date instanceof Date) || isNaN(date)) return "Invalid date";
        try {
            return new Intl.DateTimeFormat(navigator.language || 'en-US', {
                dateStyle: 'medium',
                timeStyle: 'short'
            }).format(date);
        } catch (e) { // Fallback for very old browsers
            const h = date.getHours(); const m = date.getMinutes(); const ampm = h >= 12 ? 'PM' : 'AM';
            const fh = h % 12 || 12; const mo = date.getMonth() + 1; const d = date.getDate(); const y = date.getFullYear();
            return `${mo}/${d}/${y}, ${fh}:${m < 10 ? '0' + m : m} ${ampm}`;
        }
    },

    /**
     * Formats a Date object into a relative time string (e.g., "5 min ago").
     * @param {Date} date The Date object.
     * @returns {string} Relative time string or absolute time if older than a week.
     */
    formatTimeRelative: function (date) {
        if (!date || !(date instanceof Date) || isNaN(date)) return "Never";
        const now = new Date();
        const deltaSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
        if (deltaSeconds < 0) return "In the future"; // Handle clock skew
        if (deltaSeconds < 5) return "Just now";
        if (deltaSeconds < 60) return `${deltaSeconds} sec ago`;

        const deltaMinutes = Math.round(deltaSeconds / 60);
        if (deltaMinutes < 60) return `${deltaMinutes} min ago`;

        const deltaHours = Math.round(deltaMinutes / 60);
        if (deltaHours < 24) return `${deltaHours} hr ago`;

        const deltaDays = Math.round(deltaHours / 24);
        if (deltaDays === 1) return "Yesterday";
        if (deltaDays < 7) return `${deltaDays} days ago`;

        // If older than a week, return absolute time
        return this.formatTime(date);
    },

    /**
    * Converts a URL-safe base64 string to a Uint8Array.
    * @param {string} base64String The URL-safe base64 string.
    * @returns {Uint8Array} The corresponding Uint8Array.
    */
    urlBase64ToUint8Array: function (base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    },

    /**
     * Basic debouncer function.
     * @param {Function} func The function to debounce.
     * @param {number} wait Delay in milliseconds.
     * @returns {Function} The debounced function.
     */
    debounce: function (func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Generates an SVG icon string (similar to backend).
     * Circle with colored border, white inner, dark text.
     * @param {string} label The label (max 2 chars/graphemes).
     * @param {string} color Hex color string for border.
     * @param {number} size Icon size in pixels.
     * @returns {string} SVG string.
     */
    generateDeviceIconSVG: function (label, color, size = 36) {
        const sanitizedLabel = (label || '?'); // Start with label or '?'
        let displayLabel = '?';
        // Attempt grapheme extraction if possible (basic JS doesn't have easy regex for this)
        // Simple approach: handle surrogate pairs for 2-char emojis, else take 1 char
        if (sanitizedLabel.length > 0) {
            if (sanitizedLabel.length >= 2 && 0xD800 <= sanitizedLabel.charCodeAt(0) && sanitizedLabel.charCodeAt(0) <= 0xDBFF) {
                displayLabel = sanitizedLabel.substring(0, 2).toUpperCase();
            } else {
                displayLabel = sanitizedLabel.substring(0, 1).toUpperCase(); // Default to first char
            }
        }

        const sanitizedColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : this.getDefaultColorForId(displayLabel); // Use default color if invalid

        const border_width = Math.max(1, Math.round(size * 0.1));
        const inner_radius = Math.max(1, Math.round(size / 2) - border_width);
        const text_size = size * (displayLabel.length === 1 ? 0.50 : 0.40); // Adjust based on actual displayed label length
        const text_y_adjust = size * 0.04; // Nudge text down slightly

        // Text color is always dark against the white inner circle
        const text_color = '#333333';

        // Basic SVG escaping
        const label_safe = displayLabel.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');

        return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${sanitizedColor}" />
                    <circle cx="${size / 2}" cy="${size / 2}" r="${inner_radius}" fill="#FFFFFF" />
                    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
                          font-family="sans-serif" font-size="${text_size}px" font-weight="bold" fill="${text_color}">
                        ${label_safe}
                    </text>
                </svg>`;
    },

    /**
     * Parses battery level and status from raw report data.
     * Mirrors the logic in Python's _parse_battery_info.
     * @param {*} batteryLevelRaw Raw battery value (number or string).
     * @param {*} rawStatusCode Raw status code.
     * @param {number} lowBatteryThreshold The threshold for 'Very Low'.
     * @returns {Array} [number|null, string] - Parsed level and status string.
     */
    _parseBatteryInfo: function (batteryLevelRaw, rawStatusCode, lowBatteryThreshold) {
        let mappedBatteryLevel = null;
        let batteryStatusStr = "Unknown";

        // Try status code first
        if (rawStatusCode !== null && rawStatusCode !== undefined) {
            const statusInt = parseInt(rawStatusCode);
            if (!isNaN(statusInt)) {
                switch (statusInt) {
                    case 0: mappedBatteryLevel = 100.0; batteryStatusStr = "Full"; break;
                    case 32: mappedBatteryLevel = 90.0; batteryStatusStr = "High"; break;
                    case 64: mappedBatteryLevel = 50.0; batteryStatusStr = "Medium"; break;
                    case 128: mappedBatteryLevel = 30.0; batteryStatusStr = "Low"; break;
                    case 192: mappedBatteryLevel = 10.0; batteryStatusStr = "Very Low"; break;
                }
            }
        }

        // If status code didn't give level, check battery field
        if (mappedBatteryLevel === null) {
            if (typeof batteryLevelRaw === 'number') {
                mappedBatteryLevel = batteryLevelRaw;
                // Status string determined later based on level
            } else if (typeof batteryLevelRaw === 'string') {
                const levelLower = batteryLevelRaw.toLowerCase();
                if (levelLower === "very low") { mappedBatteryLevel = 10.0; batteryStatusStr = "Very Low"; }
                else if (levelLower === "low") { mappedBatteryLevel = 25.0; batteryStatusStr = "Low"; }
                else if (levelLower === "medium") { mappedBatteryLevel = 50.0; batteryStatusStr = "Medium"; }
                else if (levelLower === "high") { mappedBatteryLevel = 85.0; batteryStatusStr = "High"; }
                else if (levelLower === "full") { mappedBatteryLevel = 100.0; batteryStatusStr = "Full"; }
                else {
                    batteryStatusStr = batteryLevelRaw.charAt(0).toUpperCase() + batteryLevelRaw.slice(1);
                }
            }
        }

        // Final check: Determine status string based on level
        if (mappedBatteryLevel !== null) {
            if (mappedBatteryLevel < lowBatteryThreshold) batteryStatusStr = "Very Low";
            else if (mappedBatteryLevel < 30) batteryStatusStr = "Low";
            else if (mappedBatteryLevel < 70) batteryStatusStr = "Medium";
            else if (mappedBatteryLevel < 95) batteryStatusStr = "High";
            else batteryStatusStr = "Full";
        }

        return [mappedBatteryLevel, batteryStatusStr];
    }
};