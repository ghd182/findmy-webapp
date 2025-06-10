# File: app/public/routes.py

import logging
import os
from flask import (
    render_template,
    current_app,
    send_from_directory,
    abort,
    make_response,
    jsonify,
)

# ADD Service and Helper imports needed by the API function
from app.services.user_data_service import UserDataService
from app.utils.helpers import getDefaultColorForId
from app.utils.data_formatting import _parse_battery_info

from datetime import datetime, timezone

# Use the blueprint defined in app/public/__init__.py
from . import bp

log = logging.getLogger(__name__)

# --- Publicly Accessible Routes ---


# --- Route for the HTML page ---
@bp.route("/shared/<string:share_id>")
def view_shared_device(share_id):
    """Renders the public map page for a shared device or an error message."""
    log.info(f"Serving public share page for ID: {share_id}")
    uds = UserDataService(current_app.config)
    share_info = uds.get_share(share_id)  # Uses DB

    # --- Check if share exists and is valid ---
    share_is_valid = False
    error_message = "This share link is invalid or has expired." # Default error

    if share_info and share_info.get("active"):
        expires_at_str = share_info.get("expires_at")
        if not expires_at_str:
            share_is_valid = True  # Indefinite shares are valid
        else:
            try:
                expires_at_dt = datetime.fromisoformat(
                    expires_at_str.replace("Z", "+00:00")
                )
                if expires_at_dt.tzinfo is None:
                    expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)

                if expires_at_dt >= datetime.now(timezone.utc):
                    share_is_valid = True
                else:
                    log.warning(f"Share link {share_id} is expired.")
                    error_message = "This share link has expired." # Specific message
            except ValueError:
                log.error(
                    f"Invalid expires_at format '{expires_at_str}' for share {share_id}."
                )
                error_message = "Share link data is invalid (server error)." # Internal error message

    elif not share_info:
         error_message = "This share link does not exist." # Specific message

    elif not share_info.get("active"):
         error_message = "This share link has been deactivated." # Specific message

    if not share_is_valid:
        log.warning(
            f"Share link {share_id} is invalid/inactive/expired. Rendering share_map template with error message."
        )
        # Render the share_map template itself, but pass the error message
        # Return 410 Gone status code to indicate the resource is intentionally unavailable
        response = make_response(render_template("share_map.html", share_id=share_id, error_message=error_message))
        response.status_code = 410
        return response

    # --- End Check ---

    # If valid, render the normal share map template without an error message
    return render_template("share_map.html", share_id=share_id, error_message=None)

# --- Route for the Public API Data ---
@bp.route("/api/shared/<string:share_id>")
def get_public_share_data_new(share_id):
    """API endpoint to fetch data for a specific public share."""
    log.debug(f"Public API request via /public/api/shared: {share_id}")
    uds = UserDataService(current_app.config)

    try:
        share_info = uds.get_share(share_id)  # Uses DB

        # Validate share existence and status
        if not share_info:
            log.warning(f"Public API: Share ID '{share_id}' not found in DB.")
            abort(404, description="Share not found.")
        if not share_info.get("active", False):
            log.info(f"Public API: Share ID '{share_id}' is inactive.")
            abort(410, description="Share has been revoked.")  # 410 Gone

        # Validate expiry (handle timezone correctly)
        expires_at_str = share_info.get("expires_at")
        if expires_at_str:
            try:
                # Ensure correct parsing and timezone comparison
                expires_at_dt = datetime.fromisoformat(
                    expires_at_str.replace("Z", "+00:00")
                )
                if expires_at_dt.tzinfo is None:
                    expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)

                if expires_at_dt < datetime.now(timezone.utc):
                    log.info(f"Public API: Share ID '{share_id}' has expired.")
                    abort(410, description="Share has expired.")  # 410 Gone
            except ValueError:
                log.error(f"Public API: Invalid expires_at format for share {share_id}")
                abort(500, description="Invalid share data (server error).")

        owner_id = share_info.get("user_id")
        device_id = share_info.get("device_id")
        if not owner_id or not device_id:
            log.error(f"Public API: Share {share_id} is missing owner or device ID.")
            abort(500, description="Invalid share data (server error).")

        # Fetch owner's cache and device config
        owner_cache = uds.load_cache_from_file(owner_id)  # Cache still from file
        owner_devices_config = uds.load_devices_config(owner_id)  # Config from DB

        if not owner_devices_config or device_id not in owner_devices_config:
            log.warning(
                f"Public API: Device config '{device_id}' not found for owner '{owner_id}' (share '{share_id}')."
            )
            abort(503, description="Device configuration is unavailable.")

        device_config = owner_devices_config[device_id]

        # Get latest report from cache
        latest_report = None
        if owner_cache and isinstance(owner_cache.get("data"), dict):
            device_data_from_cache = owner_cache["data"].get(device_id)
            if (
                device_data_from_cache
                and isinstance(device_data_from_cache.get("reports"), list)
                and device_data_from_cache["reports"]
            ):
                latest_report = device_data_from_cache["reports"][0]
            else:
                log.warning(
                    f"Public API: No reports found for device '{device_id}' in owner '{owner_id}' cache (share '{share_id}')."
                )
                # Don't abort here, just means no location data yet
        else:
            log.warning(
                f"Public API: Cache for owner '{owner_id}' (share '{share_id}') not available or invalid."
            )
            # Don't abort, proceed without location

        # Format data for response
        device_name = device_config.get("name", device_id) or device_id
        device_label = device_config.get("label", "❓") or "❓"
        final_device_color = device_config.get("color") or getDefaultColorForId(
            device_id
        )

        lat, lng, timestamp_iso, battery_level_raw, raw_status_code = (
            None,
            None,
            None,
            None,
            None,
        )
        if latest_report:
            lat = latest_report.get("lat")
            lng = latest_report.get("lon")
            timestamp_iso = latest_report.get("timestamp")
            battery_level_raw = latest_report.get("battery")
            raw_status_code = latest_report.get("status")

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
            "last_updated": owner_cache.get("timestamp") if owner_cache else None,
            "share_note": share_info.get("note", ""),
        }
        log.info(
            f"Public API (/public/api/shared): Served data for share '{share_id}' (Report found: {latest_report is not None})"
        )
        return jsonify(response)

    except Exception as e:
        # Catch specific aborts vs other errors
        if hasattr(e, "code") and e.code in [404, 410, 503]:
            raise  # Re-raise aborts to let Flask handle the response
        log.exception(f"Error fetching public share data for '{share_id}'")
        abort(
            500, description="An error occurred while retrieving shared location data."
        )


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
        response.headers["Service-Worker-Allowed"] = "/"
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
        )
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
    log.info(f"Attempting to send manifest from calculated path: {manifest_path}")
    if not os.path.exists(manifest_path):
        log.error(f"Manifest file not found at: {manifest_path}")
        abort(404)
    try:
        log.info(">>> Sending manifest file now...")
        return send_from_directory(
            os.path.dirname(manifest_path),
            os.path.basename(manifest_path),
            mimetype="application/manifest+json",
        )
    except Exception as e:
        log.exception("Error serving manifest.json")
        abort(500)


@bp.route("/favicon.ico")
def favicon():
    log.debug("Serving favicon.ico request from /public/favicon.ico...")
    try:
        return send_from_directory(
            current_app.static_folder,
            "favicon.ico",
            mimetype="image/vnd.microsoft.icon",
        )
    except Exception as e:
        log.error(f"favicon.ico not found. Error: {e}")
        abort(404)
