# app/public/routes.py

import logging
import os
from flask import (
    render_template,
    current_app,
    send_from_directory,
    abort,
    make_response,
    jsonify
)

# ADD Service and Helper imports needed by the API function
from app.services.user_data_service import UserDataService
from app.utils.helpers import getDefaultColorForId
from app.utils.data_formatting import _parse_battery_info
from datetime import datetime, timezone # <<< ADD datetime imports

# Use the blueprint defined in app/public/__init__.py
from . import bp

log = logging.getLogger(__name__)

# --- Publicly Accessible Routes ---

# --- Route for the HTML page ---
@bp.route("/shared/<string:share_id>")
def view_shared_device(share_id):
    """Renders the public map page for a shared device."""
    log.info(f"Serving public share page for ID: {share_id}")
    return render_template("share_map.html", share_id=share_id)

# --- Route for the Public API Data ---
# Changed path to match JS and removed the conflicting one from main/api.py
@bp.route("/api/shared/<string:share_id>")
def get_public_share_data_new(share_id):
    """API endpoint to fetch data for a specific public share."""
    log.debug(f"Public API request via /public/api/shared: {share_id}")
    uds = UserDataService(current_app.config)

    try:
        share_info = uds.get_share(share_id)

        # Validate share (copied validation from main/api.py)
        if not share_info:
            log.warning(f"Public API: Share ID '{share_id}' not found.")
            abort(404, description="Share not found.") # Abort directly with 404
        if not share_info.get("active", False):
            log.info(f"Public API: Share ID '{share_id}' is inactive.")
            abort(410, description="Share has been revoked.")
        now_utc = datetime.now(timezone.utc)
        expires_at_str = share_info.get("expires_at")
        if expires_at_str:
            try:
                expires_at_dt = datetime.fromisoformat(
                    expires_at_str.replace("Z", "+00:00")
                )
                if expires_at_dt.tzinfo is None:
                    expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
                if expires_at_dt < now_utc:
                    log.info(f"Public API: Share ID '{share_id}' has expired.")
                    abort(410, description="Share has expired.")
            except ValueError:
                log.error(f"Public API: Invalid expires_at format for share {share_id}")
                abort(500, description="Invalid share data.") # Abort 500 for server config issue

        owner_id = share_info.get("user_id")
        device_id = share_info.get("device_id")
        if not owner_id or not device_id:
            log.error(f"Public API: Share {share_id} is missing owner or device ID.")
            abort(500, description="Invalid share data.") # Abort 500

        owner_cache = uds.load_cache_from_file(owner_id)
        if (
            not owner_cache
            or "data" not in owner_cache
            or not isinstance(owner_cache["data"], dict)
        ):
            log.warning(
                f"Public API: Cache for owner '{owner_id}' (share '{share_id}') not available."
            )
            abort(503, description="Device location data is temporarily unavailable.")

        device_data_from_cache = owner_cache["data"].get(device_id)
        if not device_data_from_cache:
            log.warning(
                f"Public API: No data structure found for device '{device_id}' in owner '{owner_id}' cache (share '{share_id}'). Might be syncing."
            )
            abort(
                503,
                description="Device data not yet available. Please try again shortly.",
            )

        reports_list = device_data_from_cache.get("reports", [])
        latest_report = (reports_list[0] if reports_list else None)

        owner_devices_config = uds.load_devices_config(owner_id)
        device_config = owner_devices_config.get(device_id, {})

        device_name = device_config.get("name", device_id) or device_id
        device_label = device_config.get("label", "❓") or "❓"
        device_color_hex = device_config.get("color")
        final_device_color = (
            device_color_hex if device_color_hex else getDefaultColorForId(device_id)
        )

        lat = latest_report.get("lat") if latest_report else None
        lng = latest_report.get("lon") if latest_report else None
        timestamp_iso = latest_report.get("timestamp") if latest_report else None
        battery_level_raw = latest_report.get("battery") if latest_report else None
        raw_status_code = latest_report.get("status") if latest_report else None

        battery_level, battery_status = _parse_battery_info(
            battery_level_raw,
            raw_status_code,
            current_app.config.get("LOW_BATTERY_THRESHOLD", 15),
        )

        response = {
            "device_name": device_name,
            "device_label": device_label,
            "device_color": final_device_color,
            "lat": lat,
            "lng": lng,
            "timestamp": timestamp_iso,
            "battery_level": battery_level,
            "battery_status": battery_status,
            "last_updated": owner_cache.get("timestamp"),
            "share_note": share_info.get("note", ""),
        }
        log.info(
            f"Public API (/public/api/shared): Served data for share '{share_id}' (Report found: {latest_report is not None})"
        )
        return jsonify(response)
    except Exception as e:
        log.exception(f"Error fetching public share data for '{share_id}'")
        abort(500, description="An error occurred while retrieving shared location data.")


@bp.route("/sw.js")
def service_worker():
    log.debug("Serving sw.js request from /public/sw.js...")
    static_dir = current_app.static_folder
    sw_path = os.path.join(static_dir, "sw.js")
    log.info(f"Attempting to send service worker from: {sw_path}")

    if not os.path.exists(sw_path):
        log.error(f"Service worker file not found at: {sw_path}")
        abort(404)

    try:
        response = make_response(
            send_from_directory(
                os.path.dirname(sw_path),
                os.path.basename(sw_path),
                mimetype="application/javascript",
            )
        )
        response.headers["Service-Worker-Allowed"] = "/" # Keep scope as root
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    except Exception as e:
        log.exception("Error serving sw.js")
        abort(500)

@bp.route("/manifest.json")
def manifest():
    log.debug("Serving manifest.json request from /public/manifest.json...")
    static_dir = current_app.static_folder
    manifest_path = os.path.join(static_dir, "manifest.json")
    log.info(f"Attempting to send manifest from calculated path: {manifest_path}") # ADD THIS LOG
    if not os.path.exists(manifest_path):
         log.error(f"Manifest file not found at: {manifest_path}")
         abort(404)
    try:
         log.info(">>> Sending manifest file now...") # ADD THIS LOG
         return send_from_directory(
             os.path.dirname(manifest_path),
             os.path.basename(manifest_path),
             mimetype="application/manifest+json"
         )
    except Exception as e:
         log.exception("Error serving manifest.json")
         abort(500)

@bp.route("/favicon.ico")
def favicon():
    log.debug("Serving favicon.ico request from /public/favicon.ico...")
    try:
        # Use static_folder which should resolve correctly
        return send_from_directory(
            current_app.static_folder,
            "favicon.ico",
            mimetype="image/vnd.microsoft.icon",
        )
    except Exception as e:
        log.error(f"favicon.ico not found. Error: {e}")
        abort(404)

