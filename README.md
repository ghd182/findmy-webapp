# FindMy WebApp - A Multi-User Find My Alternative

[![License: MIT](https://img.shields.io/badge/License-MIT-119900.svg?style=flat-square)](https://opensource.org/licenses/MIT)  
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-donate-yellow.svg?style=flat-square&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/ghd182)

A self-hosted, multi-user web application designed as an alternative to Apple's Find My service. It tracks Apple devices (e.g., AirTags, iPhones, MacBooks) using [FindMy.py](https://github.com/malmeloo/FindMy.py) and features a modern Material 3 interface.

| Interactive Map View | Device Management Dashboard |
|:--------------------:|:---------------------------:|
| <img src="app/static/img/screenshot_map.png" alt="Map Tab Interface" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> | <img src="app/static/img/screenshot_devices.png" alt="Devices Management Interface" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> |

---

## Overview

This project provides a self-hosted web interface to locate Apple devices. It periodically fetches location data using [FindMy.py](https://github.com/malmeloo/FindMy.py) and displays it on an interactive map powered by [OpenStreetMap](https://www.openstreetmap.org/) and [Leaflet.js](https://leafletjs.com/).

### Key Features

- **Multi-User Support**: Each user manages their own Apple credentials and devices.
- **Apple Device Tracking**: Supports `.plist` or `.keys` files (e.g., OpenHaystack) for device association.
- **Interactive Map**: Displays device locations with dynamic icons, popups, and history trails.
- **Geofencing**: Create zones and receive entry/exit notifications.
- **Push Notifications**: Alerts for geofence events, low battery, and more.
- **Device Sharing**: Generate secure, time-limited revocable public links for live location sharing.
- **Material 3 Design**: Responsive UI with light/dark modes and dynamic theming.
- **PWA Support**: Installable as a Progressive Web App with offline caching.
- **Dockerized Deployment**: Easy setup with Docker and Docker Compose.

---

## Technology Stack

- **Backend**: Python 3.11+, Flask, Waitress (WSGI), APScheduler
- **Device Interaction**: [FindMy.py](https://github.com/malmeloo/FindMy.py)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Mapping**: [Leaflet.js](https://leafletjs.com/)
- **Styling**: Material 3 Design, [Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
- **Push Notifications**: `pywebpush`, `Web Push API`, `VAPID`
- **Deployment**: Docker, Docker Compose

---

## Getting Started

### Prerequisites

- **Python**: 3.11 or higher
- **Docker & Docker Compose**: For deployment
- **Apple ID**: Must have Two-Factor Authentication (2FA) enabled and previously signed into an Apple device or a virtual one (e.g., [Docker-OSX](https://github.com/sickcodes/Docker-OSX)).

### Installation

1. Clone the repository:  
   ```bash
   git clone https://github.com/ghd182/findmy-webapp.git && cd findmy-webapp
   ```

#### Local Development (Not Recommended for Full Functionality)

2. Create a virtual environment and install dependencies:  
   ```bash
   python -m venv venv && source venv/bin/activate
   pip install -r requirements.txt
   ```
3. Configure environment variables in a `.env` file (see `.env.example`).
4. Run the app:  
   ```bash
   python run.py
   ```
5. Access the app at `http://localhost:5000`.

#### Docker Deployment (Recommended)

2. Configure `docker-compose.yml`:
   - Set environment variables (e.g., `SECRET_SEED`, `FERNET_SEED`, `VAPID_SEED`).
   - Adjust optional variables as needed.
3. Build and run the containers:  
   ```bash
   docker compose up -d
   ```
4. Access the app at `http://<your-docker-host-ip>:5000`.

---


## Usage

1.  **Access & Register/Login:** Open the app URL. Create an account or log in.
2.  **Set Apple Credentials:** Navigate `☰ Menu` ➔ `Apple Credentials`. Enter your Apple ID email and **your regular Apple ID password**. Save. (An initial data fetch is triggered).
3.  **Upload Device Files:** Navigate `☰ Menu` ➔ `Settings` ➔ `Manage Device Files`. Upload `.plist` or `.keys` files. (Another fetch is triggered).
4.  **View Map:** Go to `Map` tab. Devices appear after background fetch. Use controls (Zoom, My Location, Show All, History Toggle/Slider). Click markers for info popups.
5.  **View Devices:** Go to `Devices` tab for list. Click item to center map. Use `⋮` menu (Edit, Share, Geofences, Test Notifications, Remove). Toggle map visibility (eye icon).
6.  **Manage Geofences:** Go to `Geofences` tab. Create global areas ("+" button). Link/unlink devices and configure notifications per link in device cards.
7.  **View Alerts:** Go to `Alerts` tab for notification history. Manage read/unread/delete.
8.  **Configure Settings:** Go to `Settings` tab. Manage theme/color, map defaults, notification permissions, import/export, manage active shares, delete account.



---

## Gallery

### Main Features
| Map View | Devices List | Navigation Menu |
|:--------:|:------------:|:---------------:|
| <img src="app/static/img/screenshot_map.png" alt="Map Tab" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> | <img src="app/static/img/screenshot_devices.png" alt="Devices Tab" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> | <img src="app/static/img/screenshot_drawer.png" alt="Drawer" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> |

### Device Management
| Device Options | Share Creation | Shared View |
|:-------------:|:--------------:|:-----------:|
| <img src="app/static/img/screenshot_device.png" alt="Device Options" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> | <img src="app/static/img/screenshot_share.png" alt="Device Sharing" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> | <img src="app/static/img/screenshot_shared.png" alt="Shared Device" width="200" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);"/> |

---

## Troubleshooting / FAQ

<details>
<summary>See details</summary>
<ul>
    <li><b>Login Failed / Background Fetch Errors / 2FA Required:</b>
        <ul>
            <li><b>Cause:</b> Authentication with Apple failed.</li>
            <li><b>Solution:</b>
                <ol>
                    <li>Ensure you entered your <b>correct Apple ID email and REGULAR password</b> (not an App-Specific Password).</li>
                    <li>Verify <b>2FA is ENABLED</b> on the Apple ID account.</li>
                    <li>Confirm the Apple ID has been <b>previously used on an Apple device</b> (iPhone, Mac, etc.) or signed into iCloud within a <b>macOS virtual machine</b> (e.g., using <a href="https://github.com/sickcodes/Docker-OSX">Docker-OSX</a>) to establish trust.</li>
                    <li>Check the <b>Anisette server</b> status (<code>docker compose logs anisette</code>). If it's crashing or showing errors, the authentication process will fail. Ensure it's running and <code>ANISETTE_SERVERS</code> points to it.</li>
                    <li>Check the <code>findmyapp</code> logs (<code>docker compose logs findmyapp</code>) for specific error messages from <code>FindMy.py</code>.</li>
                </ol>
            </li>
        </ul>
    </li>
    <li><b>No Devices Showing:</b> Check credentials, file uploads, wait for fetch interval, trigger manual refresh (<code>Devices</code> ➔ <code>Update Status</code>), check server logs (<code>findmyapp</code> and <code>anisette</code>).</li>
    <li><b>Notifications Not Working:</b> Check browser permission, VAPID setup (<code>VAPID_SEED</code>, <code>VAPID_CLAIMS_EMAIL</code>), subscription status (Settings), geofence link notification toggles, low battery threshold, cooldown period.</li>
    <li><b>Map Issues:</b> Clear cache, check internet, check browser console (F12).</li>
    <li><b>Docker Permissions:</b> Ensure host <code>./data</code> directory is writable by the container user (often UID/GID 1000). Use <code>sudo chown -R 1000:1000 ./data</code> or Docker volumes.</li>
    <li><b>VAPID Seed Failure:</b> If logs mention "scalar... outside the valid range", use a <i>different</i> random string for <code>VAPID_SEED</code> and restart.</li>
    <li><b>Updating:</b> Pull latest code (<code>git pull</code>), rebuild images (<code>docker compose build</code>), redeploy (<code>docker compose up -d</code> or Portainer "Update the stack" with "Re-pull image").</li>
    <li><b>Data Storage:</b> User data in <code>data/</code> (mapped to <code>/app/data</code> in container).</li>            <li><b>Important:</b> If you delete the container, this data is lost unless you use Docker volumes.</li>
            <li><b>Anisette Server:</b> If you are using the Anisette server, ensure it is running and accessible.</li>
            <li><b>Web Bluetooth Scanner:</b> The scanner tab is experimental and has limitations. It cannot reliably identify standard Find My packets from <code>.plist</code>/official devices due to Web Bluetooth MAC address obfuscation. It only works for OpenHaystack devices with Haystack Service Data UUID or static <code>.keys</code> files.</li>
        </ul>
    </li>
</ul>
</details>

---

## Future Improvements / Roadmap

See [TODO.md](TODO.md) for a detailed list. Key areas include database migration, Play Sound/Lost Mode, performance tuning, enhanced security, and UI polishing.

---

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

---

## Credits & Acknowledgements

This project uses the following third-party libraries and tools:

- **[FindMy.py](https://github.com/malmeloo/FindMy.py)** (MIT License): Core library for interacting with Apple's Find My network.
- **[OpenHaystack](https://github.com/seemoo-lab/openhaystack)** (AGPL-3.0 License): Firmware and tools for custom tracking tags.
- **[Dadoum/anisette-v3-server](https://github.com/Dadoum/anisette-v3-server)**: Anisette server for authentication.
- **[Material Color Utilities](https://github.com/material-foundation/material-color-utilities)** (Apache-2.0 License): Dynamic theming utilities.
- **[Leaflet.js](https://leafletjs.com/)** (BSD-2-Clause License): Interactive map library.
- **[OpenStreetMap](https://www.openstreetmap.org/)** (ODbL 1.0): Map data source.

Please refer to the respective repositories for detailed license information.

---

## Contributing / Contact

Contributions are welcome! For questions, feedback, or support, please open an [Issue Repository](https://github.com/ghd182/findmy-webapp/issues) or submit a [Pull Request](https://github.com/ghd182/findmy-webapp/pulls). Consider adding tests and following existing code style.

> **Disclaimer:** This project relies on unofficial methods to interact with Apple's services. These methods may change or break without notice. Using your Apple ID credentials in third-party applications carries inherent security risks. This project is intended for personal, educational purposes and is not affiliated with or endorsed by Apple Inc. Use responsibly and at your own risk. Respect privacy laws.