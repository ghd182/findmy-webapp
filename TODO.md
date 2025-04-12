# FindMy WebApp - TODO List (Updated & Prioritized)

## 🧊 Icebox / Future Ideas
*   [Feature] User-to-User Device Sharing: Secure sharing between registered users.
*   [Feature] Custom Map Tile Layers: Add layer control and options.
*   [Feature] Battery History: Store and visualize historical battery levels.
*   [i18n/l10n] Internationalization: Add support for multiple languages.
*   [Demo] Demo Instance: Consider setting up a public read-only demo.

## ⬇️ Low Priority
*   [UI/UX] Smooth Transitions: Apply CSS transitions more consistently for polish.
*   [UI/UX] Relative Time Updates: Ensure *all* relative timestamps update periodically (some might be missed).
*   [Refactor] Centralized Task Triggering: Refine the manual refresh mechanism (`POST /api/user/refresh`) - maybe use websockets later?
*   [Docs] Improve Documentation: Add more detail on scanner limitations, troubleshooting, architecture. Update screenshots.
*   [Refactor] Code Quality: Introduce linters/formatters (e.g., Black, Flake8/Ruff) and enforce style.

## ▶️ Medium Priority
*   [Feature] Play Sound / Lost Mode: Implement API endpoints and backend logic (`AppleDataService`) to trigger "Play Sound" and potentially "Lost Mode" actions using `FindMy.py`. Add UI buttons in device menus/dialogs.
*   [Performance] API Payload Optimization (`/api/devices`): Modify endpoint to accept parameters (e.g., `?reports=latest`). Consider separate history endpoint (`/api/devices/<id>/history`).
*   [Performance] Asynchronous Operations: Investigate using `asyncio` within Flask routes (`async def`) or background tasks for I/O-bound operations (like `FindMy.py` calls) if Waitress proves insufficient under load.
*   [Backend] Error Reporting: Integrate an external error tracking service (e.g., Sentry, Rollbar) for better production monitoring.
*   [UI/UX] Loading States: Implement more granular loading indicators (e.g., spinners on specific cards or sections during updates, subtle progress bars).
*   [UI/UX] Map Interactions: Implement marker clustering (`Leaflet.markercluster`) for better performance with many devices/history points. Make history points clickable to show their specific popup.
*   [Feature] Improved Offline Cache (Service Worker): Enhance `sw.js` to cache `/api/devices` data more effectively for offline viewing (requires careful cache invalidation strategy).
*   [Feature] Granular Notifications: User-configurable cooldowns per device/geofence, "Left Behind" alerts (requires more complex state tracking).
*   [Testing] Add Unit & Integration Tests: Implement `pytest` suite covering services, utils, and key API endpoints.

## 🔥 High Priority / Near Term
*   **[Backend] Database Migration:** Migrate data storage from JSON files to a database (SQLite recommended first) to fix concurrency/locking issues, improve performance, and enable complex features. Refactor `UserDataService`. **(CRITICAL for stability & performance)**
*   **[UI/UX] Interactive 2FA Flow:** Implement frontend UI and backend API endpoints (`/api/auth/2fa/...`) for handling the interactive 2FA required by `FindMy.py`. Store intermediate state securely (e.g., in session, encrypted). **(BLOCKER for reliable credentials)**
*   **[Security] Rate Limiting:** Implement robust rate limiting (`Flask-Limiter`) on `auth` blueprint routes (login, register) and sensitive API endpoints (credential saving, possibly data refresh) to prevent abuse.
*   **[Security] Content Security Policy (CSP):** Define and implement a strict CSP header (via `Flask-Talisman` or manually) to mitigate XSS risks from potentially embedded map data or user input.
*   **[UI/UX] Error Handling & User Feedback:** Improve user-friendliness of error messages from API calls and background tasks. Add "Retry" options where appropriate. Use Material 3 dialogs/snackbars for feedback.
*   **[UI/UX] Scanner Tab Limitations:** Clearly document the limitations (Web Bluetooth MAC obfuscation, `.keys` file support) within the Scanner tab UI itself. Add a note about its experimental nature.
*   **[Bugfix/Refactor] Review Key Generation/Loading:** Ensure `SECRET_SEED`, `FERNET_SEED`, `VAPID_SEED` logic in `config.py` and `key_utils.py` is robust, handles errors gracefully, and logs clearly. Ensure production warnings/errors for missing keys are effective.
*   **[UI/UX] Accessibility (A11y):** Conduct a basic review of keyboard navigation, focus management, ARIA roles, and color contrast, especially for interactive elements (map controls, dialogs, forms).

---

**Recently Implemented / Done:**

*   [Done] UI Navigation Rearrangement (Drawer, Bottom Nav, More Menu) - *As proposed above*.
*   [Done] Multi-User Auth & Registration
*   [Done] Apple Device Tracking (.plist/.keys)
*   [Done] Interactive Map (Leaflet, OSM)
*   [Done] Location History Trail & Slider
*   [Done] Material 3 Design (Light/Dark, Dynamic Color via JS)
*   [Done] Geofencing (Create, Link, Notify)
*   [Done] Low Battery Notifications
*   [Done] Web Push Notifications (VAPID)
*   [Done] Notification History Page & Management API
*   [Done] Public Device Sharing via Links & Management API/Page
*   [Done - Experimental/Limited] Nearby Scanner Tab (Web Bluetooth)
*   [Done] Device Configuration (Name, Label, Color, Visibility) API
*   [Done] Secure Credential Storage (Fernet/Base64 Fallback)
*   [Done] Configuration Import/Export API & Basic UI
*   [Done] Account Deletion API & Basic UI Flow
*   [Done] PWA Support (Basic Offline Shell via Service Worker)
*   [Done] Seed-Based Key Generation (Flask Secret, Fernet, VAPID)
*   [Done] Dockerization (ARM64 Optimized) & Anisette Server Integration
*   [Done] CSRF Protection (Flask-WTF)
*   [Done] Background Fetch Scheduling (APScheduler) & Manual Trigger API
*   [Done] Atomic File Saving & Locking (Via `json_utils` - To be replaced by DB)
*   [Done] Dynamic SVG Icon Generation (Backend & Frontend Helper)
*   [Done] Public Asset Serving consolidation.