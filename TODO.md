# TODO / Roadmap

## 🔥 High Priority / Near Term
*   **[Native Scanner] Implement BLE Scanning:** Implement actual BLE scanning logic in `BleScanWorker.kt` using Android's `BluetoothLeScanner`. Filter for Apple manufacturer data (0x004C). Parse OF payloads.
*   **[Native Scanner] Implement Key Matching:** Complete the `KeyManager.kt` logic to generate rolling/static keys from loaded `.plist`/`.keys` data and perform matching against received OF payloads (`findMatchingKey`). Use BouncyCastle correctly.
*   **[Native Scanner] Implement Data Flow & UI Display:** Connect `BleScanWorker` results (matched devices, timestamps, battery) to `ScannerViewModel` (e.g., via Repository or LiveData updates). Update `ScannerFragment` `RecyclerView` (`ScanResultAdapter`) to display *actual scan results* instead of placeholders.
*   **[Native Scanner] Permissions Flow:** Implement a user-friendly flow within the Android app (perhaps in `MainActivity` or a dedicated settings screen) to request Bluetooth, Location, and Background Location permissions *at the appropriate time*. Guide the user to grant "Allow all the time" for background location. Update UI based on permission status.
*   **[Native Scanner & Backend] FCM Integration (Android):** Implement `MyFirebaseMessagingService.sendRegistrationToServer` (ensure it triggers when token changes *and* user is linked). Handle incoming data messages correctly in `onMessageReceived` and display native notifications using `NotificationManager`.
*   **[Native Scanner & Backend] FCM Integration (Backend):** Modify Flask backend: Add DB field/storage for FCM tokens per user/subscription. Update `/api/subscribe` endpoint to robustly handle optional `fcm_token` in payload and store it. Implement FCM sending logic in `NotificationService` using `firebase-admin` or similar library to push alerts to registered Android devices.
*   **[Security] Review & Expand Rate Limiting:** Apply `Flask-Limiter` to *all* sensitive API endpoints (incl. new scanner/FCM endpoints). Review existing limits for appropriate values.

---

## ▶️ Medium Priority
*   **[Native Scanner] UI Refinement:** Improve `ScannerFragment` UI: Show scan progress/status clearly (beyond ViewModel status text). Enhance `ScanResultAdapter` to display RSSI, relative time, matched device info prettily. Implement "Start/Stop Background Scan" toggle functionality properly linked to `WorkManager` enqueue/cancel in `ScannerViewModel`.
*   **[Native Scanner] Settings Integration:** Expand settings within the Android app (or via JS interface to web settings) to: Display current link status. Potentially allow override scan interval. Display scanner status/last run time/last report time. Improve error display.
*   **[Feature] Play Sound / Lost Mode (Web & Backend):** Implement backend logic and API endpoints using `FindMy.py` for these actions. Add UI controls in web app.
*   **[Performance] API Payload Optimization (`/api/devices`):** Refine endpoint to potentially return less history by default, accept parameters. Ensure `last_seen_local` is efficiently updated and included.
*   **[UI/UX] Map Marker Clustering:** Implement `Leaflet.markercluster` for web map performance with many devices/history points.
*   **[Backend] External Error Reporting (Sentry, etc.).**
*   **[Testing] Unit & Integration Tests (Flask & Android).**
*   **[Security] JavascriptInterface Security:** Review and harden `WebAppInterface` methods if more complex data/actions are passed between PWA and Native.

---

## ⬇️ Low Priority
*   [UI/UX] Accessibility (A11y) Review (Web & Android).
*   [UI/UX] PWA Offline Cache Improvements (`sw.js`).
*   [UI/UX] Granular Loading States (Web & Android).
*   [UI/UX] Smooth CSS Transitions (Web).
*   [Refactor] Centralized Task Triggering (Websockets?).
*   [Docs] Improve Documentation (Architecture, Android Setup, FCM, Theme Sync).
*   [Refactor] Code Quality (Linters, Formatters).
*   **[Native Scanner] Advanced Filtering:** Investigate native Android `ScanFilter` capabilities (e.g., `manufacturerDataMask`).
*   **[Native Scanner] Queued Backend Reporting:** Implement offline queue in Android to send reports when connectivity returns.
*   **[Native Scanner] Battery Optimization:** Fine-tune `WorkManager`, scan parameters.

---

## 🧊 Icebox / Future Ideas
*   [Feature] User-to-User Device Sharing.
*   [Feature] Custom Map Tile Layers.
*   [Feature] Battery History Graph.
*   [i18n/l10n] Internationalization.
*   [Demo] Public read-only demo instance.
*   [Native Scanner] iOS Companion App.

## ✅ Recently Implemented / Done
*   **[Done] [UI/UX] Theme Sync (Native Application & WebApp):** Implemented logic in Android (`MainActivity`) to dynamically apply the user's preferred color (received from web app via `updateNativeThemeColor` interface and stored in SharedPreferences) to the native Material Components theme at runtime using `DynamicColorsOptions`. WebApp sends color preference changes to the native side. `getAppThemeColor` in Android now prioritizes this stored user color.
*   [Done] UI Navigation Rearrangement (Drawer, Bottom Nav, More Menu)
*   [Done] Multi-User Auth & Registration
*   [Done] Apple Device Tracking (.plist/.keys)
*   [Done] Interactive Map (Leaflet, OSM) & Basic Markers
*   [Done] Location History Trail & Slider (Basic Implementation)
*   [Done] Material 3 Design (Light/Dark, Dynamic Color via JS for Web)
*   [Done] Geofencing (Create, Link - Basic)
*   [Done] Web Push Notifications (VAPID Setup, Basic Sending)
*   [Done] Notification History Page & Management API (Basic CRUD)
*   [Done] Public Device Sharing via Links & Management API/Page
*   [Done] Device Configuration API (Name, Label, Color, Visibility)
*   [Done] Secure Credential Storage (Fernet/Base64 Fallback)
*   [Done] Configuration Import/Export API & Basic UI
*   [Done] Account Deletion API & Basic UI Flow
*   [Done] PWA Support (Basic Offline Shell via Service Worker)
*   [Done] Seed-Based Key Generation (Flask Secret, Fernet, VAPID) & Prod Validation
*   [Done] Dockerization (ARM64 Optimized) & Anisette Server Integration
*   [Done] CSRF Protection (Flask-WTF)
*   [Done] Background Fetch Scheduling (APScheduler) & Manual Trigger API
*   [Done] Atomic File Saving & Locking (Via `json_utils`)
*   [Done] Dynamic SVG Icon Generation (Backend & Frontend Helper)
*   [Done] Public Asset Serving Consolidation
*   [Done] Basic Interactive 2FA Flow (Backend State, API Endpoints, Frontend JS/HTML)
*   [Done] Basic Rate Limiting (Login/Register)
*   [Done] Backend Database Migration (SQLite)
*   **[Done] [Native Scanner] Backend API:** `/api/scanner/config` endpoint created (token auth).
*   **[Done] [Native Scanner] Backend API:** `/api/scanner/report` endpoint created (token auth, CSRF exempt).
*   **[Done] [Native Scanner] Backend API:** `/auth-api/generate_token` endpoint created (username/password auth).
*   **[Done] [Native Scanner] DB Schema:** Added `last_seen_local` to `Device` model.
*   **[Done] [Native Scanner] DB Schema:** Added `ApiToken` model and migration.
*   **[Done] [Native Scanner] Backend Logic:** Updated `UserDataService` for `last_seen_local` field and raw device data retrieval.
*   **[Done] [Native Scanner] Backend Logic:** Implemented `@token_required` decorator and `get_current_api_user` helper.
*   **[Done] [Native Scanner] Backend Logic:** Refined `before_request` to handle token routes.
*   **[Done] [Native Scanner] Backend Logic:** Fixed Dockerfile CMD to handle migrations (`stamp head`).
*   **[Done] [Native Scanner] Frontend Display:** Updated device list UI (`ui.js`) to show `last_seen_local`.
*   **[Done] [Native Scanner] Frontend Display:** Added absolute time with timezone to relative time tooltips.
*   **[Done] [Native Scanner] Android App Shell:** Basic project structure, `MainActivity`, `BottomNavigationView`.
*   **[Done] [Native Scanner] Android Fragments:** Created `WebViewFragment`, `ScannerFragment`.
*   **[Done] [Native Scanner] Android ViewModel:** Created `ScannerViewModel` with LiveData for status, linking.
*   **[Done] [Native Scanner] Android UI Binding:** Connected `ScannerFragment` to `ViewModel`, basic `RecyclerView` setup, Link/Unlink button.
*   **[Done] [Native Scanner] Android Networking:** Implemented `RetrofitClient` with `AuthTokenInterceptor`. Added API service methods and Repository calls.
*   **[Done] [Native Scanner] Android Auth:** Implemented `TokenStorage` using `EncryptedSharedPreferences`. Added link/unlink logic in `ScannerViewModel`.
*   **[Done] [Native Scanner] Android Worker:** Created `BleScanWorker` structure, added config fetching.
*   **[Done] [Native Scanner] Android App Init:** Created `FindMyApplication` to initialize `RetrofitClient`.
*   **[Done] [Native Scanner] Android Build:** Added necessary dependencies (`security-crypto`, BouncyCastle, etc.).
*   **[Done] [UI/UX] Conditional Web Scanner:** Verified `isRunningInAndroidApp` JS interface hides web scanner tab.
*   **[Partially Done] [Native Scanner] FCM Setup:** Android dependencies, service, manifest entries added; Backend sending & Token storage TODO.
*   **[Partially Done] [Native Scanner] Secure Data Storage:** Token storage is secure; Key file storage/parsing needs review for security (currently basic file access).