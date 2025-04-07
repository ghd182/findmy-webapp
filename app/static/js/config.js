// app/static/js/config.js

// Values passed from the backend via window object (in index.html)
const VAPID_PUBLIC_KEY = window.VAPID_PUBLIC_KEY || null;
const LOW_BATTERY_THRESHOLD = window.LOW_BATTERY_THRESHOLD || 15;
const APP_VERSION = window.APP_VERSION || "?.?.?";

// --- Notification Icon/Badge URLs ---
const DEFAULT_NOTIFICATION_ICON_URL = window.DEFAULT_NOTIFICATION_ICON_URL || '/static/icons/favicon.svg';
const WELCOME_NOTIFICATION_ICON_URL = window.WELCOME_NOTIFICATION_ICON_URL || DEFAULT_NOTIFICATION_ICON_URL;
const GEOFENCE_BADGE_URL = window.GEOFENCE_BADGE_URL || '/static/icons/badge-icon.png'; // Fallback to default badge
const BATTERY_BADGE_URL = window.BATTERY_BADGE_URL || '/static/icons/badge-icon.png'; // Fallback to default badge
const TEST_NOTIFICATION_ICON_URL = window.TEST_ICON_BADGE_URL || DEFAULT_NOTIFICATION_ICON_URL; // Icon for Test
const TEST_NOTIFICATION_BADGE_URL = window.TEST_ICON_BADGE_URL || '/static/icons/badge-icon.png'; // Badge for Test
const DEFAULT_BADGE_URL = window.DEFAULT_BADGE_URL || '/static/icons/badge-icon.png';
// --- ----------------------------- ---


// Other client-side constants
const MAX_HISTORY_POINTS = 50; // Max location history items to keep
const SAVE_VISIBILITY_DEBOUNCE = 500; // ms delay before saving visibility state
const FETCH_DEVICES_INTERVAL = 5 * 60 * 1000; // Optional: Interval for background refresh (e.g., 5 minutes) - can be disabled if relying solely on scheduler


// Leaflet pane configuration (centralized)
const LEAFLET_PANES = {
    GEOFENCE: { name: 'geofencePane', zIndex: 350 }, // Keep geofences potentially below accuracy? Or move accuracy below geofences (e.g., 300)? Let's try 400 first.
    HISTORY_ACCURACY: { name: 'historyAccuracyPane', zIndex: 400 }, // Circles pane
    USER_ACCURACY: { name: 'userAccuracyPane', zIndex: 400 },
    HISTORY_LINE: { name: 'historyLinePane', zIndex: 450 }, // Lines above accuracy
    HISTORY_POINT: { name: 'historyPointPane', zIndex: 500 }, // Points above lines
    SAVED_PLACES: { name: 'savedPlacePane', zIndex: 550 },
    USER: { name: 'userLocationPane', zIndex: 600 },
    MARKERS: { name: 'markerPane', zIndex: 650 },
    POPUPS: { name: 'popupPane', zIndex: 700 },
    SEARCH: { name: 'searchPane', zIndex: 800 },
    
};
// Export constants
window.AppConfig = {
    VAPID_PUBLIC_KEY,
    LOW_BATTERY_THRESHOLD,
    APP_VERSION,
    DEFAULT_NOTIFICATION_ICON_URL, // Keep for potential fallback in SW
    WELCOME_NOTIFICATION_ICON_URL, // Needed? Maybe not directly
    GEOFENCE_BADGE_URL,            // Needed? Maybe not directly
    BATTERY_BADGE_URL,             // Needed? Maybe not directly
    TEST_NOTIFICATION_ICON_URL,    // Needed for JS test trigger
    TEST_NOTIFICATION_BADGE_URL,   // Needed for JS test trigger
    DEFAULT_BADGE_URL,             // Keep for potential fallback in SW
    MAX_HISTORY_POINTS,
    SAVE_VISIBILITY_DEBOUNCE,
    FETCH_DEVICES_INTERVAL,
    LEAFLET_PANES
};