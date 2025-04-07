# FindMy WebApp - TODO List

This list tracks potential improvements and new features for the application. Items marked with `[Done]` are considered implemented.

## High Priority / Core Features

*   **[Feature] Play Sound / Lost Mode:** Implement API endpoints and backend logic (`AppleDataService`) to trigger "Play Sound" and potentially "Lost Mode" actions on devices using `pyfindmy` library functions. Add corresponding UI buttons in the device menu. (Requires investigation into `pyfindmy` capabilities and permissions).
*   **[Backend] Database Migration:** Migrate data storage from individual JSON files per user to a database (e.g., SQLite for simplicity, PostgreSQL for scalability). This involves refactoring `UserDataService` significantly but will improve performance, reduce race condition risks, and enable more complex queries (like history filtering).

## Security Enhancements

*   **[Security] Rate Limiting:** Implement rate limiting (e.g., using `Flask-Limiter`) on sensitive endpoints like login, registration, and potentially credential saving to mitigate brute-force attacks.
*   **[Security] Content Security Policy (CSP):** Define and implement a strict CSP header (e.g., via `Flask-Talisman` or manually) to reduce XSS risks. This might require moving inline scripts/styles.
*   **[Security] Session Cookie Review:** Verify session cookie attributes (`HttpOnly`, `Secure`, `SameSite`) are optimally configured for production, especially when behind a reverse proxy.

## Backend & Performance

*   **[Performance] API Payload Optimization (`/api/devices`):**
    *   Currently sends full history. Modify endpoint to accept parameters (e.g., `?history=latest`, `?history_since=<ts>`, `?limit=N`) to fetch only necessary data.
    *   Consider a separate endpoint (`/api/devices/<id>/history`) for fetching full history on demand.
*   **[Performance] Asynchronous Operations:** Investigate using `asyncio` (potentially with Quart/FastAPI or Flask async support) and `aiohttp`/`async findmy` (if available) for I/O-bound tasks like Apple data fetching and Anisette communication to improve concurrency over threading.
*   **[Refactor] Centralized Task Triggering:** Improve the manual refresh mechanism. Currently, `/api/user/refresh` triggers a full fetch for the user. Explore options for more targeted refreshes or better integration with the scheduler.
*   **[Backend] Error Reporting:** Integrate an external error tracking service (e.g., Sentry) for better production error visibility.

## Frontend / UI/UX

*   **[UI/UX] Loading States:** Implement more granular loading indicators (e.g., skeleton loaders for lists, progress indicator in app bar during background fetches) instead of just spinners.
*   **[UI/UX] Error Handling:** Improve user-friendliness of error messages in dialogs. Consider adding "Retry" buttons for network/fetch errors.
*   **[UI/UX] Map Interactions:**
    *   Implement marker clustering (e.g., `Leaflet.markercluster`) for better usability when many devices/history points are close.
    *   Provide clearer visual distinction for the currently selected/viewed device marker.
    *   Allow clicking on history points on the map polyline/dots to open their specific popup.
*   **[UI/UX] History Confidence Value:** Translate the raw `confidence` value (0-255) in map popups to a more user-friendly format (e.g., `[value]/255`, "High/Medium/Low", or a visual indicator).
*   **[UI/UX] Accessibility (A11y):** Conduct a thorough review of ARIA attributes, keyboard navigation (especially menus, dialogs, map controls), color contrast, and focus management.
*   **[UI/UX] Smooth Transitions:** Apply CSS transitions more consistently for UI elements appearing/disappearing (e.g., history slider, search results, dialogs).
*   **[UI/UX] Relative Time Updates:** Ensure all relative timestamps in the UI update periodically without requiring a full refresh (e.g., "5 min ago" should become "6 min ago"). (Currently implemented for some areas).

## New Features / Functionality

*   **[Feature] Custom Map Tile Layers:** Add a map layer control (Leaflet built-in or custom) to allow switching between base maps (OSM, Satellite - may require API key/attribution).
*   **[Feature] Battery History:** Store historical battery levels alongside location reports. Add a UI element (e.g., chart in device details/dialog) to visualize battery level over time.
*   **[Feature] Improved Offline Cache (Service Worker):** Enhance the `sw.js` fetch handler to cache responses from `/api/devices` (NetworkFirst or StaleWhileRevalidate strategy) to allow viewing last known locations when offline. Requires careful cache invalidation.
*   **[Feature] Granular Notifications:**
    *   Allow setting notification cooldowns per-device or per-link.
    *   Implement "Left Behind" alerts (requires tracking user's primary device location relative to accessories).
*   **[Feature] Improved Search:** Add fuzzy search capabilities. Allow filtering/searching by device model or status.

## Other / Miscellaneous

*   **[Testing] Add Unit and Integration Tests:** Implement a testing suite (e.g., using `pytest`) to cover backend logic, API endpoints, and utility functions.
*   **[Docs] Improve Documentation:** Add more detailed documentation for setup, configuration options, advanced features, and troubleshooting. Add actual screenshots to README.
*   **[Refactor] Code Quality:** Introduce linters (e.g., Flake8, Black, Ruff) and formatters (e.g., Prettier for JS) to maintain code consistency. Refactor complex functions for clarity.
*   **[i18n/l10n] Internationalization:** Add support for multiple languages using libraries like `Flask-Babel`.
*   **[Demo] Demo Instance:** Consider setting up a publicly accessible (read-only?) demo instance to showcase features.
*   **[Refactor] Redundant Asset Serving:** Routes for `sw.js`, `manifest.json`, `favicon.ico` exist in both `main` and `public` blueprints. Consolidate to use only the `public` routes for these assets and update `index.html` template `url_for` calls accordingly.

---
**Done:**

*   **[Done] CSRF Protection:** Implemented via Flask-WTF.
*   **[Done] Device Sharing:** Core functionality (create, view, manage links, public page) implemented.
*   **[Done] Seed-Based Key Generation:** Implemented in `config.py` and `utils/key_utils.py`.
*   **[Done] Dynamic SVG Icons:** Implemented in helpers and used in `data_formatting`.
*   **[Done] Notification History:** Implemented (API, UI page, storage).