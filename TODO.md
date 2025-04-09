# FindMy WebApp - TODO List (Current Status & Roadmap)

## High Priority / Core Features

*   **[Feature] Play Sound / Lost Mode:** Implement API endpoints and backend logic (`AppleDataService`) to trigger "Play Sound" and potentially "Lost Mode" actions using `pyfindmy`. Add UI buttons.
*   **[Backend] Database Migration:** Migrate data storage from JSON files to a database (SQLite recommended first step) to improve performance, concurrency handling, and enable complex queries. Refactor `UserDataService`. **(High Priority)**

## Security Enhancements

*   **[Security] Rate Limiting:** Implement rate limiting (`Flask-Limiter`) on login, registration, and possibly credential saving endpoints.
*   **[Security] Content Security Policy (CSP):** Define and implement a strict CSP header (`Flask-Talisman` or manual) to mitigate XSS risks.
*   **[Done] CSRF Protection:** Implemented via Flask-WTF for forms and API endpoints.
*   **[Review] Session Cookie Security:** Verify `HttpOnly`, `Secure`, `SameSite` attributes are optimally configured in production.

## Backend & Performance

*   **[Performance] API Payload Optimization (`/api/devices`):** Modify endpoint to accept parameters (e.g., `?history=latest`). Consider separate history endpoint.
*   **[Performance] Asynchronous Operations:** Investigate using `asyncio` for I/O-bound tasks.
*   **[Refactor] Centralized Task Triggering:** Refine the manual refresh mechanism (`POST /api/user/refresh`).
*   **[Backend] Error Reporting:** Integrate an external error tracking service (e.g., Sentry).
*   **[Done] Public Asset Serving:** Consolidated serving via `public` blueprint and `main`.

## Frontend / UI/UX

*   **[UI/UX] Scanner Tab (Partial Implementation):**
    *   Implemented using Web Bluetooth `requestLEScan` to detect nearby Apple Find My advertisement packets (`0x12 0x19`).
    *   Displays *all* detected OF packets with raw data (RSSI, Status Byte, Payload Hex, Service Data).
    *   Highlights owned devices identified via:
        *   Haystack Service Data UUID `0xFD6F` (if firmware supports it).
        *   Experimental iterative MAC reconstruction (Works for static `.keys`, **unreliable for `.plist`/official devices**).
    *   **Limitation:** Cannot reliably identify standard OF packets from `.plist`/official devices due to Web Bluetooth MAC address obfuscation.
    *   **Todo:** Clearly document limitations in UI. Explore server-side scanning as an alternative/complementary feature. Improve display of raw data in details view.
*   **[UI/UX] Loading States:** Implement more granular loading indicators (skeleton loaders, app bar indicator).
*   **[UI/UX] Error Handling:** Improve user-friendliness of error messages. Add "Retry" options.
*   **[UI/UX] Map Interactions:** Implement marker clustering (`Leaflet.markercluster`). Highlight selected marker. Clickable history points.
*   **[UI/UX] Accessibility (A11y):** Conduct a thorough review (ARIA, keyboard navigation, focus management, color contrast).
*   **[UI/UX] Smooth Transitions:** Apply CSS transitions more consistently.
*   **[UI/UX] Relative Time Updates:** Ensure all relative timestamps update periodically.

## New Features / Functionality

*   **[Feature] Custom Map Tile Layers:** Add layer control and options (may require API keys).
*   **[Feature] Battery History:** Store and visualize historical battery levels (depends on DB migration).
*   **[Feature] Improved Offline Cache (Service Worker):** Enhance `sw.js` to cache `/api/devices` data.
*   **[Feature] User-to-User Device Sharing:** Secure sharing between registered users (depends on DB migration).
*   **[Feature] Granular Notifications:** User-configurable cooldowns, "Left Behind" alerts.

## Other / Miscellaneous

*   **[Testing] Add Unit & Integration Tests:** Implement `pytest` suite.
*   **[Docs] Improve Documentation:** Add scanner limitations. Add actual screenshots to README.
*   **[Refactor] Code Quality:** Introduce linters/formatters.
*   **[i18n/l10n] Internationalization:** Add support for multiple languages.
*   **[Demo] Demo Instance:** Consider setting up a public read-only demo.

---
**Implemented Features (Reflected Above):**

*   [Done] Multi-User Auth & Registration
*   [Done] Apple Device Tracking (.plist/.keys)
*   [Done] Interactive Map (Leaflet, OSM)
*   [Done] Location History Trail & Slider
*   [Done] Material 3 Design (Light/Dark, Dynamic Color)
*   [Done] Geofencing (Create, Link, Notify)
*   [Done] Low Battery Notifications
*   [Done] Web Push Notifications (VAPID)
*   [Done] Notification History Page
*   [Done] Public Device Sharing via Links & Management
*   [Done - Experimental/Limited] Nearby Scanner Tab (Web Bluetooth)
*   [Done] Device Configuration (Name, Label, Color, Visibility)
*   [Done] Secure Credential Storage (Fernet)
*   [Done] Configuration Import/Export
*   [Done] Account Deletion
*   [Done] PWA Support (Basic Offline Shell)
*   [Done] Seed-Based Key Generation
*   [Done] Dockerization (ARM64 Optimized)
*   [Done] CSRF Protection
*   [Done] Background Fetch Scheduling & Manual Trigger
*   [Done] Atomic File Saving & Locking (To be replaced by DB)
*   [Done] Dynamic SVG Icon Generation
*   [Done] Public Share Page & API