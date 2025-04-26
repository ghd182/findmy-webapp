**3. Updated TODO.md**

```markdown
# FindMy WebApp - TODO List (Updated & Prioritized)

## 🧊 Icebox / Future Ideas
*   [Feature] User-to-User Device Sharing: Secure sharing between registered users.
*   [Feature] Custom Map Tile Layers: Add layer control and options.
*   [Feature] Battery History: Store and visualize historical battery levels.
*   [i18n/l10n] Internationalization: Add support for multiple languages.
*   [Demo] Demo Instance: Consider setting up a public read-only demo.
*   [Feature] Admin Panel: Basic controls for managing users, global settings.
*   [Alternative] Explore per-user scheduler jobs if performance allows and complexity is justified (Alternative to Feature 3).

## ⬇️ Low Priority
*   [UI/UX] Smooth Transitions: Apply CSS transitions more consistently for polish.
*   [UI/UX] Relative Time Updates: Ensure *all* relative timestamps update periodically (some might be missed).
*   [Refactor] Centralized Task Triggering: Refine the manual refresh mechanism (`POST /api/user/refresh`) - maybe use websockets later?
*   [Docs] Improve Documentation: Add more detail on scanner limitations, troubleshooting, architecture. Update screenshots.
*   [Refactor] Code Quality: Introduce linters/formatters (e.g., Black, Flake8/Ruff) and enforce style.
*   [Feature] Enhance Local Share Geofence UI: Improve drawing tools, make notification settings clearer on the share page.

## ▶️ Medium Priority
*   **[Feature] "Not Seen" Notifications (Backend - Feature 1):**
    *   Modify `UserDataService` (devices.json) for `notify_not_seen` flag and `not_seen_threshold_hours`.
    *   Add `DEFAULT_NOT_SEEN_THRESHOLD_HOURS` to `config.py`.
    *   Implement `_check_not_seen_for_device` in `NotificationService`.
    *   Implement state tracking file (e.g., `device_seen_state.json`) and associated load/save in `UserDataService`.
    *   Call new check from `run_fetch_for_user_task` in `tasks.py`.
*   **[Feature] Per-Device Notification Toggles (UI - Feature 1):**
    *   Add toggles for "Low Battery Alerts" & "Not Seen Alerts" in `edit-device-dialog.html`.
    *   Add input for "Not Seen Threshold" (optional).
    *   Update `ui.js` `openEditDeviceDialog` to populate/save these.
    *   Update `api.py` `update_device_display_config` to handle saving these new fields.
*   **[Feature] Per-Device Battery Threshold (Feature 2):**
    *   Modify `UserDataService` (devices.json) for `low_battery_threshold`.
    *   Add input field in `edit-device-dialog.html` and handle in `ui.js` and `api.py`.
    *   Modify `NotificationService._check_low_battery_for_device` to use per-device threshold if available.
*   **[Feature] Shared Link Local Geofences (Frontend - Feature 5):**
    *   Add UI controls to `share_map.html` (draw button, list, notification toggles).
    *   Implement Leaflet drawing tools in `share_page.js`.
    *   Implement `localStorage` saving/loading keyed by `shareId`.
    *   Add location checking logic against local geofences within the polling loop.
    *   Implement browser `Notification` API calls (request permission, display notifications).
    *   Add clear disclaimers about local-only functionality.
*   [Feature] Play Sound / Lost Mode: Implement API endpoints and backend logic (`AppleDataService`) to trigger actions using `FindMy.py`. Add UI buttons.
*   [Performance] API Payload Optimization (`/api/devices`): Modify endpoint to accept parameters (e.g., `?reports=latest`). Consider separate history endpoint (`/api/devices/<id>/history`).
*   [Performance] Asynchronous Operations: Investigate using `asyncio` within Flask routes (`async def`) or background tasks if needed.
*   [Backend] Error Reporting: Integrate Sentry/Rollbar.
*   [UI/UX] Loading States: Implement more granular loading indicators.
*   [UI/UX] Map Interactions: Implement marker clustering (`Leaflet.markercluster`). Make history points clickable.
*   [Feature] Improved Offline Cache (Service Worker): Enhance `sw.js` to cache `/api/devices` data more effectively.
*   [Feature] Granular Notifications: User-configurable cooldowns, "Left Behind" alerts.
*   [Testing] Add Unit & Integration Tests: Implement `pytest` suite.

## 🔥 High Priority / Near Term
*   **[Feature] Splash Screen (Frontend - Feature 4):**
    *   Add splash screen HTML/CSS in `index.html`/`style.css`.
    *   Modify `app.js` `initializeApp` to hide splash screen after load.
*   **[Feature] Multi-Device Share Links (Backend/API - Feature 6 Core):**
    *   Modify `shares.json` structure (`device_id` -> `device_ids`).
    *   Update `UserDataService` share methods (`add`, `get`, `load`, `save`, `prune`, `toggle`, `update_expiry`, `delete`) to handle `device_ids` list.
    *   Modify `POST /api/shares` (new or renamed endpoint) to accept `device_ids` list.
    *   Modify `GET /api/shares` to return `device_ids` and device names.
    *   Modify `GET /public/api/shared/<id>` to fetch and return data for all devices in `device_ids`.
*   **[Feature] Multi-Device Share Links (Frontend - Feature 6 Core):**
    *   Update share creation UI (`share-device-dialog.html`, `ui.js`) to allow multi-select.
    *   Update share management UI (`settings.html`, `ui.js`) to display multiple devices per share.
    *   Update public share page (`share_map.html`, `share_page.js`) to handle and display multiple devices/markers.
*   **[Feature] Manage Devices within Multi-Device Share (Feature 6 Enhancements - Lower Prio than Core):**
    *   Add `paused_device_ids` to `shares.json` structure (optional).
    *   Create new API endpoints (`PUT /api/shares/<share_id>/device/<device_id>/status`, `DELETE /api/shares/<share_id>/device/<device_id>`).
    *   Add UI controls in share management (Settings page) to pause/remove individual devices from a share.
    *   Update public API to filter paused devices.
*   **[Backend] Database Migration:** Migrate data storage from JSON files to a database (SQLite recommended first). Refactor `UserDataService`. **(CRITICAL for stability & performance)**
*   **[UI/UX] Interactive 2FA Flow:** Implement frontend UI and backend API endpoints (`/api/auth/2fa/...`). Store intermediate state securely. **(BLOCKER for reliable credentials)**
*   **[Security] Rate Limiting:** Implement robust rate limiting (`Flask-Limiter`) on `auth` and sensitive API endpoints.
*   **[Security] Content Security Policy (CSP):** Define and implement a strict CSP header.
*   **[UI/UX] Error Handling & User Feedback:** Improve user-friendliness of error messages. Add "Retry" options. Use Material 3 dialogs/snackbars.
*   **[UI/UX] Scanner Tab Limitations:** Clearly document limitations within the Scanner tab UI itself.
*   **[Bugfix/Refactor] Review Key Generation/Loading:** Ensure seed-based key logic is robust, handles errors gracefully, logs clearly.
*   **[UI/UX] Accessibility (A11y):** Conduct basic review (keyboard nav, focus, ARIA, contrast).

---

**Recently Implemented / Done:**

*   [Done] UI Navigation Rearrangement (Drawer, Bottom Nav, More Menu)
*   [Done] Multi-User Auth & Registration
*   [Done] Apple Device Tracking (.plist/.keys)
*   [Done] Interactive Map (Leaflet, OSM)
*   [Done] Location History Trail & Slider
*   [Done] Material 3 Design (Light/Dark, Dynamic Color via JS)
*   [Done] Geofencing (Create, Link, Notify)
*   [Done] Low Battery Notifications
*   [Done] Web Push Notifications (VAPID)
*   [Done] Notification History Page & Management API
*   [Done - Single Device] Public Device Sharing via Links & Management API/Page
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
*   [Done] Interactive 2FA API (Backend part - Needs UI)