# FindMy WebApp - A Multi-User Find My Alternative

[![Build Status](https://img.shields.io/github/actions/workflow/status/ghd182/findmy-multiuser/ci.yml?branch=main&style=flat-square)](https://github.com/ghd182/findmy-multiuser/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![App Version](https://img.shields.io/badge/Version-2.2.1-blue.svg?style=flat-square)](https://github.com/ghd182/findmy-multiuser) <!-- Update version badge if needed -->

A self-hosted, multi-user web application designed as an alternative to Apple's Find My service, focusing on tracking Apple devices (like AirTags, iPhones, MacBooks) using [FindMy.py](https://github.com/malmeloo/FindMy.py) with a modern, responsive Material 3 interface.

<div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
    <img src="app/static/img/screenshot_map.png" alt="Map Tab" width="200"/>
    <img src="app/static/img/screenshot_devices.png" alt="Devices Tab" width="200"/>
</div>

## Overview

This project provides a self-hosted web interface accessible from any device to locate your Apple accessories (AirTags, iPhones, etc.). It fetches location data periodically using the excellent [malmeloo/FindMy.py](https://github.com/malmeloo/FindMy.py) library and presents it on an interactive map (OpenStreetMap via Leaflet.js).

Beyond basic tracking, it offers multi-user support with secure login, geofencing with push notifications, low battery alerts, location history viewing, device sharing via public links, dynamic Material 3 theming (adapting to your system or chosen preference), and PWA support for app-like installation. It's designed for easy deployment using Docker, making it ideal for home servers like a Raspberry Pi.

## Key Features

*   **Multi-User Support:** Secure user registration and login. Each user manages their own Apple credentials and device data independently.
*   **Apple Device Tracking:** Locates accessories linked to an Apple ID using [FindMy.py](https://github.com/malmeloo/FindMy.py). Supports devices associated via `.plist` or `.keys` files. Fetches and stores historical location data.
*   **Interactive Map:** Displays device locations on an OpenStreetMap base layer using Leaflet.js.
    *   Dynamic, colored SVG icons based on user-defined labels (emojis supported).
    *   Popups showing device name, last update time (relative & absolute), battery status, coordinates, and accuracy.
    *   Map controls: Zoom, Center on user location, Show all visible devices, Toggle history trails.
*   **Location History:** View the recent location history trail for visible devices directly on the map. Filter history duration using an intuitive slider (1 hour to 7 days).
*   **Material 3 Design:** Modern, responsive interface adhering to Material 3 guidelines.
    *   **Light/Dark Modes:** Follows system preference or allows manual override.
    *   **Dynamic Color Theming:** Adapts UI colors based on a user-selected accent color (using Material Color Utilities).
*   **Geofencing:**
    *   Create/Edit/Delete custom circular geofence zones visually on a map.
    *   Link geofences to specific devices.
    *   Configure entry and/or exit push notifications per device-geofence link.
*   **Notifications:**
    *   **Geofence Alerts:** Receive push notifications upon device entry or exit from linked geofences.
    *   **Low Battery Alerts:** Receive push notifications when a device's battery level falls below a configurable threshold.
    *   **Web Push:** Uses Web Push API for real-time alerts (requires VAPID key setup and user permission in browser).
    *   **Notification History:** View a dedicated "Alerts" page showing a history of notifications sent by the backend. Manage read/unread status and delete history entries.
*   **Device Sharing:**
    *   Create secure, time-limited (e.g., 1h, 24h, 7d) or indefinite public links to share a specific device's live location. Add optional notes to shares.
    *   Viewers access a simplified, read-only map page without needing to log in.
    *   Manage created share links from Settings: View URL, Copy URL, Suspend/Resume, Update duration/note, Delete permanently.
*   **Nearby Scanner (Experimental):**
    *   Uses Web Bluetooth (on supported platforms like Chrome/Edge on Desktop/Android - **NOT iOS**) to scan for nearby devices broadcasting Apple Find My advertisement packets.
    *   Displays *all* detected Find My packets, showing signal strength (RSSI), status byte, and raw packet data.
    *   **Highlights** devices matched to the user's configured keys if they broadcast using a compatible method (e.g., `.keys` file static key or OpenHaystack firmware broadcasting via Service Data UUID `0xFD6F`).
    *   **Limitation:** Cannot reliably identify devices broadcasting *standard, time-rolled* Find My packets (like official AirTags or standard `.plist` configurations) due to Web Bluetooth privacy restrictions (MAC address obfuscation).
*   **Device Configuration:** Customize device display names, map icon labels (emojis supported, up to 2 characters), and icon colors. Toggle map visibility per device.
*   **Secure Credential Storage:** Apple passwords are encrypted using Fernet symmetric encryption (requires `FERNET_SEED` or `FERNET_KEY`).
*   **Configuration Import/Export:** Backup and restore user configuration (device settings, geofences, UI preferences, visibility states, etc.) via JSON file download/upload.
*   **Account Management:** Users can delete their account and all associated data permanently.
*   **PWA Support:** Installable as a Progressive Web App (PWA) on compatible devices for a more native app experience. Includes basic offline caching for the app shell via Service Worker.
*   **Seed-Based Key Generation:** **(Recommended)** Deterministically generates the Flask `SECRET_KEY`, `FERNET_KEY` for encryption, and VAPID keys for push notifications from user-provided seed environment variables. Simplifies secret management and ensures key persistence across container restarts.
*   **Dockerized:** Easy deployment using Docker and Docker Compose. Optimized Dockerfile for `linux/arm64/v8` (Raspberry Pi 4/5 and other ARM devices). Includes `ProxyFix` middleware for correct operation behind reverse proxies.

## Technology Stack

*   **Backend:** Python 3.11+, Flask, Waitress (WSGI Server), APScheduler (Task Scheduling)
*   **Device Interaction:** [FindMy.py](https://github.com/malmeloo/FindMy.py)
*   **Frontend:** Vanilla JavaScript (ES Modules), HTML5, CSS3
*   **Mapping:** Leaflet.js
*   **Styling:** Material 3 Design principles (CSS variables), Material Icons & Symbols, [Material Color Utilities](https://github.com/material-foundation/material-color-utilities) (JS library for dynamic theming)
*   **Push Notifications:** `pywebpush`, Web Push API, VAPID
*   **Security/Auth:** Flask-Login, Flask-WTF (CSRF protection), Werkzeug password hashing, `cryptography` (Fernet encryption, HKDF for key derivation)
*   **Deployment:** Docker, Docker Compose

## Getting Started

*(This section remains largely the same as your provided version, with minor clarifications)*

### Prerequisites

*   **Python:** Version 3.11 or higher recommended.
*   **Pip:** Python package installer.
*   **Git:** For cloning the repository.
*   **Docker & Docker Compose:** (Required for Docker/Portainer deployment) Install Docker Engine and Docker Compose V2.
*   **(Optional) Anisette Server:** Required by [FindMy.py](https://github.com/malmeloo/FindMy.py) for authentication. Public servers can be configured via the `ANISETTE_SERVERS` env var, but running your own instance (e.g., [Dadoum/anisette-v3-server](https://github.com/Dadoum/anisette-v3-server)) is more reliable.
*   **Apple ID:**
    *   **2FA Accounts (Strongly Recommended):** If 2FA is enabled, you **MUST** generate and use an **App-Specific Password (ASP)**. Your regular Apple ID password will *not* work. Generate via [appleid.apple.com](https://appleid.apple.com) ➔ Sign-In and Security ➔ App-Specific Passwords.
    *   **Non-2FA Accounts:** Using accounts *without* 2FA is **strongly discouraged** due to security risks and potential incompatibility with Apple's changing APIs.
*   **Device Files:** `.plist` or `.keys` files for the Apple devices (e.g., AirTags) you want to track. Generate these using tools like [OpenHaystack](https://github.com/seemoo-lab/openhaystack).

### Configuration (Environment Variables & Seeds)

*(This section remains largely the same)*

**(Required Variables & Optional Variables list is accurate based on `app/config.py`)**

### 1. Local Development Setup

*(Steps are accurate)*

### 2. Docker Setup (using Docker Compose)

*(Steps are accurate)*

### 3. Portainer Setup (Stack Deployment)

*(Steps are accurate)*

## Usage

1.  **Access & Register/Login:** Open the app URL. Create an account or log in.
2.  **Set Apple Credentials:** Navigate `☰ Menu` ➔ `Apple Credentials`. Enter your Apple ID email and **App-Specific Password (ASP)**. Save. (An initial data fetch is triggered).
3.  **Upload Device Files:** Navigate `☰ Menu` ➔ `Settings` ➔ `Manage Device Files`. Upload `.plist` or `.keys` files. (Another fetch is triggered).
4.  **View Map:** Go to the `Map` tab. Devices appear after the background fetch completes. Use controls to zoom, center, toggle 'Show All', or toggle/filter history trails. Click markers for popups.
5.  **View Devices:** Go to the `Devices` tab for a list view. Click a device to center map. Use the `⋮` menu for options (Edit, Share, Geofences, Test Notifications, Remove). Toggle visibility using the eye icon.
6.  **Manage Geofences:** Go to `Geofences` tab. Create global areas via the "+" button. Link/unlink devices and configure notifications per link in the device cards below.
7.  **View Alerts:** Go to `Alerts` tab to view notification history. Mark as read/unread or delete entries.
8.  **Configure Settings:** Go to `Settings` tab. Manage theme/color, map defaults (Show All/History), notification permissions/unsubscribe, import/export config, manage active shares, and delete your account.

## Gallery

*(Keep your existing Gallery section here with the linked images)*
<div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
    <img src="app/static/img/screenshot_map.png" alt="Map Tab" width="200"/>
    <img src="app/static/img/screenshot_devices.png" alt="Devices Tab" width="200"/>
    <img src="app/static/img/screenshot_drawer.png" alt="Drawer" width="200"/>
    <img src="app/static/img/screenshot_device.png" alt="Device Options" width="200"/>
    <img src="app/static/img/screenshot_share.png" alt="Device Sharing" width="200"/>
    <img src="app/static/img/screenshot_shared.png" alt="Shared Device" width="200"/>
    <img src="app/static/img/screenshot_geofences.png" alt="Geofences Tab" width="200"/>
    <img src="app/static/img/screenshot_geofence.png" alt="Geofence Options" width="200"/>
    <img src="app/static/img/screenshot_notifications.png" alt="Notifications Tab" width="200"/>
    <img src="app/static/img/screenshot_settings.png" alt="Settings" width="200"/>
    <img src="app/static/img/screenshot_settings_color.png" alt="Custom Accents Color" width="200"/>
    <img src="app/static/img/screenshot_settings_dark.png" alt="Dark Mode" width="200"/>
</div>

## Troubleshooting / FAQ

*(This section remains largely the same and accurate)*

*   **Login Failed / Background Fetch Errors / 2FA Required:** Use an **App-Specific Password (ASP)** if 2FA is enabled on your Apple ID.
*   **No Devices Showing:** Check credentials (ASP!), file uploads, wait for fetch interval, or trigger manual refresh (`Devices` ➔ `Update Status`), check server logs.
*   **Notifications Not Working:** Check browser permission, VAPID setup (`VAPID_SEED`, `VAPID_CLAIMS_EMAIL`), subscription status (Settings), geofence link notification toggles, low battery threshold, cooldown period.
*   **Map Issues:** Clear cache, check internet, check browser console (F12).
*   **Docker Permissions:** Ensure host `./data` directory is writable by the container user (often UID/GID 1000). Use `sudo chown -R 1000:1000 ./data` or Docker volumes.
*   **VAPID Seed Failure:** If logs mention "scalar... outside the valid range", use a *different* random string for `VAPID_SEED` and restart.
*   **Updating:** Follow instructions for Local, Docker Compose, or Portainer based on your setup method. Always pull latest code (`git pull`), potentially rebuild image (`docker compose build`), and redeploy (`docker compose up -d` or Portainer "Update the stack").
*   **Data Storage:** User data is in JSON files within the `data/` directory (mapped to `/app/data` in container).
*   **Scanner Not Working / Not Finding Devices:**
    *   **Platform Support:** Web Bluetooth scanning is **NOT supported on iOS (iPhone/iPad)**. It requires Chrome/Edge or a compatible browser on Android, Windows, macOS, Linux, or ChromeOS.
    *   **Permissions:** Did you grant Bluetooth scanning permission to the website in your browser?
    *   **Bluetooth Enabled:** Is Bluetooth turned ON on your computer/phone?
    *   **Device Type & Firmware:** The scanner can only reliably *identify* devices configured via `.keys` files (using an experimental reconstruction method) OR devices using modified firmware (like some OpenHaystack forks) that broadcast their full public key via Service Data UUID `0xFD6F`. It **cannot reliably identify** official AirTags or devices configured via `.plist` using the standard time-rolling advertisement protocol due to browser privacy limitations hiding the real MAC address.
    *   **Device Nearby & Powered On?** Is the device physically close and turned on?
    *   **Check Console:** Open the browser's developer console (F12) while scanning. Look for errors related to `Bluetooth`, `requestLEScan`, or `advertisementreceived`. Look for `[Scanner Ad Process]` logs to see if packets are being detected.

## Contributing

Contributions are welcome! Please open an issue or submit a Pull Request. Consider adding tests and following existing code style.

## Future Improvements / Roadmap

See [TODO.md](TODO.md) for a detailed list of planned features and improvements. Key areas include:

*   Database backend migration (SQLite/PostgreSQL)
*   Play Sound / Lost Mode features
*   API/Performance optimizations
*   Enhanced security (Rate Limiting, CSP)
*   UI/UX Polish (Clustering, Loaders)
*   Improved Offline Cache
*   Custom Map Layers
*   Battery level history tracking
*   Scanner improving Device Identification for .plist files

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.

## Credits & Acknowledgements

*(This section remains accurate)*

## Contact

For questions, feedback, or support, please open an issue on the [GitHub Repository](https://github.com/Ghodmode/findmy-multiuser/issues).

---

> **Disclaimer:** This project is not affiliated with or endorsed by Apple Inc. Use responsibly and respect privacy laws. Intended for personal, educational use.