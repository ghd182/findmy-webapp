# File: app/main/api.py
# Purpose: Defines main API endpoints requiring user session authentication.

import logging
import time
import re
import os
import threading
import traceback
import shutil
import uuid
from pathlib import Path
from werkzeug.utils import secure_filename
import json
import base64
import secrets

from werkzeug.exceptions import HTTPException

from typing import List, Optional, Dict, Any, Tuple, Set
from datetime import datetime, timezone, timedelta
from app.scheduler.tasks import run_fetch_for_user_task
from app.utils.json_utils import (
    load_json_file,
)
from app.utils.helpers import get_potential_mac_from_public_key

# --- REMOVE token_required and get_current_api_user imports if no longer used HERE ---
# from app.utils.auth_utils import token_required, get_current_api_user

from findmy.accessory import FindMyAccessory
from findmy.keys import KeyPair

import secrets
from werkzeug.security import (
    check_password_hash,
)

from flask import (
    Blueprint,
    jsonify,
    request,
    current_app,
    abort,
    Response,
    send_file,
    session,
    url_for,
    g,  # Keep g if used by session auth
)

# --- Keep flask_login import for @login_required ---
from flask_login import login_required, current_user

# --- Keep limiter AND CSRF from app ---
from app import limiter, csrf

from app.models import (
    Geofence,
    Share,
    Device,
    User,
)  # Removed ApiToken unless needed elsewhere

# Import Services
from app.services.user_data_service import UserDataService
from app.services.notification_service import NotificationService
from app.services.apple_data_service import AppleDataService

from findmy.reports import (
    AppleAccount,
    LoginState,
    RemoteAnisetteProvider,
    SmsSecondFactorMethod,
    TrustedDeviceSecondFactorMethod,
)

# Import necessary utils
from app.utils.helpers import (
    generate_geofence_id,
    getDefaultColorForId,
    generate_device_icon_svg,
    get_available_anisette_server,
    encrypt_password,
)
from app.utils.data_formatting import (
    format_latest_report_for_api,
    _parse_battery_info,
)

log = logging.getLogger(__name__)

bp = Blueprint("api", __name__)

@bp.app_errorhandler(HTTPException)
def handle_http_exception(e):
    """Return JSON instead of HTML for HTTP errors handled by abort."""
    response = e.get_response()
    # Replace the body with JSON
    response.data = json.dumps({
        "code": e.code,
        "name": e.name,
        "error": e.description, # Use 'error' for consistency with other manual error responses
    })
    response.content_type = "application/json"
    log.error(f"HTTP Exception: {e.code} {e.name} - {e.description}", exc_info=e if e.code == 500 else False)
    return response

# --- File Upload API ---
ALLOWED_EXTENSIONS = {"plist", "keys"}
ALLOWED_CONFIG_EXTENSIONS = {"json"}


def allowed_file(filename, allowed_set=ALLOWED_EXTENSIONS):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed_set


# --- get_current_advertisement_keys Route (Keep as is) ---
@bp.route("/user/current_advertisement_keys", methods=["GET"])
@login_required
def get_current_advertisement_keys():
    user_id = current_user.id
    log.info(f"API GET /user/current_advertisement_keys requested by '{user_id}'")
    uds = UserDataService(current_app.config)
    expected_keys_and_macs = []
    processed_device_ids = set()
    try:
        user_data_dir = uds._get_user_data_dir(user_id)
        if not user_data_dir:
            return jsonify({"error": "User data directory not found."}), 500
        devices_config = uds.load_devices_config(user_id)
        now = datetime.now(timezone.utc)
        log.debug(f"[API Keys] Processing .plist files for user '{user_id}'...")
        creds_filename = uds.config.get(
            "USER_APPLE_CREDS_FILENAME", "apple_credentials.json"
        )
        creds_stem = Path(creds_filename).stem
        for plist_file in user_data_dir.glob("*.plist"):
            device_id = plist_file.stem
            if not device_id or device_id == creds_stem:
                continue
            if device_id in processed_device_ids:
                continue
            log.debug(
                f"[API Keys] -- Found plist: {plist_file.name} (Device ID: {device_id})"
            )
            try:
                with plist_file.open("rb") as f:
                    accessory = FindMyAccessory.from_plist(f)
                time_window_past = now - timedelta(days=7)
                time_window_future = now + timedelta(days=1)
                current_keys: set[KeyPair] = accessory.keys_between(
                    time_window_past, time_window_future
                )
                device_display_name = devices_config.get(device_id, {}).get(
                    "name", device_id
                )
                log.debug(
                    f"[API Keys] -- Generated {len(current_keys)} potential keys for '{device_id}' around {now.isoformat()}"
                )
                for key_pair in current_keys:
                    adv_key_bytes = key_pair.adv_key_bytes
                    adv_key_b64 = (
                        base64.urlsafe_b64encode(adv_key_bytes)
                        .decode("ascii")
                        .rstrip("=")
                    )
                    potential_mac = get_potential_mac_from_public_key(adv_key_bytes)
                    log.debug(
                        f"[API Keys] ---- Device: {device_id} | Type: {key_pair.key_type.name} | KeyB64: {adv_key_b64} | MAC: {potential_mac}"
                    )
                    expected_keys_and_macs.append(
                        {
                            "device_id": device_id,
                            "name": device_display_name,
                            "adv_key_b64": adv_key_b64,
                            "key_type": key_pair.key_type.name,
                            "potential_mac": potential_mac,
                        }
                    )
                processed_device_ids.add(device_id)
            except Exception as e:
                log.warning(
                    f"User '{user_id}': Error processing plist {plist_file.name} for keys: {e}",
                    exc_info=True,
                )
        log.debug(f"[API Keys] Processing .keys files for user '{user_id}'...")

        for keys_file in user_data_dir.glob("*.keys"):
            device_id = keys_file.stem
            if not device_id or device_id == creds_stem:
                continue
            if device_id in processed_device_ids:
                continue
            log.debug(
                f"[API Keys] -- Found keys file: {keys_file.name} (Device ID: {device_id})"
            )
            try:
                private_keys_b64 = UserDataService._load_private_keys_from_keys_file(keys_file)
                if not private_keys_b64:
                    continue
                device_display_name = devices_config.get(device_id, {}).get(
                    "name", device_id
                )
                keys_added_count = 0
                for key_b64_string in private_keys_b64:
                    try:
                        key_pair = KeyPair.from_b64(key_b64_string)
                        adv_key_bytes = key_pair.adv_key_bytes
                        adv_key_b64_urlsafe = (
                            base64.urlsafe_b64encode(adv_key_bytes)
                            .decode("ascii")
                            .rstrip("=")
                        )
                        potential_mac = get_potential_mac_from_public_key(adv_key_bytes)
                        # log.debug(
                        #     f"[API Keys] ---- Device: {device_id} | Type: STATIC_KEYS_FILE | KeyB64: {adv_key_b64_urlsafe} | MAC: {potential_mac}"
                        # )
                        expected_keys_and_macs.append(
                            {
                                "device_id": device_id,
                                "name": device_display_name,
                                "adv_key_b64": adv_key_b64_urlsafe,
                                "key_type": "STATIC_KEYS_FILE",
                                "potential_mac": potential_mac,
                            }
                        )
                        keys_added_count += 1
                    except Exception as kp_err:
                        log.warning(
                            f"User '{user_id}': Failed to process private key from {keys_file.name}: {kp_err}"
                        )
                if keys_added_count > 0:
                    processed_device_ids.add(device_id)
            except Exception as e:
                log.warning(
                    f"User '{user_id}': Error processing keys file {keys_file.name} for scanner: {e}"
                )
        log.info(
            f"User '{user_id}': Providing {len(expected_keys_and_macs)} potential keys/MACs."
        )
        return jsonify({"keys_and_macs": expected_keys_and_macs})
    except Exception as e:
        log.exception(f"Error fetching current keys/MACs for user '{user_id}'")
        return jsonify({"error": "Server error fetching expected keys."}), 500


# --- /files/upload Route (Keep as is) ---
@bp.route("/files/upload", methods=["POST"])
@login_required
@limiter.limit("200 per hour")  # Rate limit file uploads
def upload_device_file():
    user_id = current_user.id
    log.info(f"API POST /files/upload called by user '{user_id}'")
    uploaded_files = request.files.getlist("device_file")
    if not uploaded_files or all(f.filename == "" for f in uploaded_files):
        log.warning(f"User '{user_id}' upload attempt: No files selected.")
        return jsonify({"error": "No files selected."}), 400
    uds = UserDataService(current_app.config)
    user_data_dir = uds._get_user_data_dir(user_id)
    if not user_data_dir:
        log.error(f"User '{user_id}' upload error: Could not get user data directory.")
        return (
            jsonify({"error": "Server error: Could not access user data storage."}),
            500,
        )

    results = {
        "success": [],
        "errors": [],
        "fetch_triggered": None,
        "fetch_error": None,
    }
    config_needs_reload = False
    trigger_fetch = False
    for file_storage in uploaded_files:
        original_filename = file_storage.filename
        if not original_filename:
            log.debug(f"User '{user_id}' upload: Skipping empty file part.")
            continue

        if not allowed_file(original_filename, ALLOWED_EXTENSIONS):
            msg = f"File type not allowed: '{original_filename}'. Only .plist and .keys are permitted."
            log.warning(f"User '{user_id}' upload attempt: {msg}")
            results["errors"].append({"filename": original_filename, "error": msg})
            continue

        filename = secure_filename(original_filename)
        if not filename:
            msg = f"Invalid filename provided: '{original_filename}'."
            log.warning(f"User '{user_id}' upload attempt: {msg}")
            results["errors"].append({"filename": original_filename, "error": msg})
            continue

        save_path = user_data_dir / filename
        log.info(
            f"User '{user_id}': Saving uploaded '{original_filename}' as '{filename}'"
        )
        try:
            file_storage.save(save_path)
            log.info(f"User '{user_id}': Successfully saved '{filename}'.")
            results["success"].append(
                {
                    "filename": filename,
                    "original_filename": original_filename,
                    "device_id": Path(filename).stem,
                }
            )
            config_needs_reload = True
            trigger_fetch = True
        except Exception as e:
            log.exception(f"User '{user_id}': Failed to save '{original_filename}'.")
            results["errors"].append(
                {"filename": original_filename, "error": f"Failed to save file: {e}"}
            )

    if config_needs_reload:
        try:
            uds.load_devices_config(user_id)  # Trigger DB merge
            log.info(f"User '{user_id}': Devices config checked/merged after uploads.")

            if trigger_fetch and not results["errors"]:
                log.info(
                    f"Triggering immediate fetch for user '{user_id}' after file upload."
                )
                try:
                    apple_id, apple_password, _ = uds.load_apple_credentials_and_state(
                        user_id
                    )
                    if apple_id and apple_password:
                        app_context = current_app._get_current_object()
                        immediate_fetch_thread = threading.Thread(
                            target=run_fetch_for_user_task,
                            args=(app_context, user_id),
                            name=f"ImmediateFetchUpload-{user_id}",
                            daemon=True,
                        )
                        immediate_fetch_thread.start()
                        results["fetch_triggered"] = True
                        log.info(f"User '{user_id}': Immediate fetch thread started.")
                    else:
                        log.warning(
                            f"User '{user_id}': Cannot trigger fetch after upload, creds missing or invalid."
                        )
                        results["fetch_triggered"] = False
                        results["fetch_error"] = "Credentials missing or invalid"
                except Exception as fetch_trigger_err:
                    log.error(
                        f"Failed to start immediate fetch for '{user_id}': {fetch_trigger_err}",
                        exc_info=True,
                    )
                    results["fetch_triggered"] = False
                    results["fetch_error"] = str(fetch_trigger_err)
        except Exception as post_upload_err:
            log.error(
                f"Error post-upload config reload/merge for {user_id}: {post_upload_err}"
            )
            results["errors"].append(
                {
                    "filename": "N/A",
                    "error": f"Server error during config reload: {post_upload_err}. Devices might not appear immediately.",
                }
            )

    status_code = 200
    response_message = ""
    if not results["success"] and not results["errors"]:
        response_message = "No valid files processed."
        status_code = 400
    elif not results["errors"]:
        response_message = f"Successfully uploaded {len(results['success'])} file(s)."
        status_code = 201
    elif not results["success"]:
        response_message = f"Failed to upload {len(results['errors'])} file(s)."
        status_code = 400
    else:
        response_message = f"Upload complete: {len(results['success'])} succeeded, {len(results['errors'])} failed."
        status_code = 207  # Multi-status for partial success

    if results.get("fetch_triggered") is True:
        response_message += " Background fetch initiated."
    elif results.get("fetch_triggered") is False:
        response_message += f" Background fetch NOT initiated ({results.get('fetch_error', 'unknown reason')})."

    return jsonify({"message": response_message, "details": results}), status_code


# --- Android API Endpoints ---
@bp.route("/android/devices", methods=["GET"])
@login_required
def get_android_devices():
    user_id = current_user.id
    log.info(f"API GET /android/devices requested by '{user_id}'")
    uds = UserDataService(current_app.config)
    devices_output = []
    processed_device_ids = set()

    try:
        user_data_dir = uds._get_user_data_dir(user_id)
        if not user_data_dir:
            return jsonify({"error": "User data directory not found."}), 500

        # Load device configurations from DB
        devices_config_db = uds.load_devices_config(user_id) # This gets Device objects via UDS

        now = datetime.now(timezone.utc)
        creds_filename = uds.config.get("USER_APPLE_CREDS_FILENAME", "apple_credentials.json")
        creds_stem = Path(creds_filename).stem

        # Process .plist files for keys
        for plist_file in user_data_dir.glob("*.plist"):
            device_id = plist_file.stem
            if not device_id or device_id == creds_stem or device_id in processed_device_ids:
                continue

            device_db_config = devices_config_db.get(device_id)
            if not device_db_config:
                log.warning(f"User '{user_id}': Device '{device_id}' from plist not found in DB config. Skipping for Android API.")
                continue

            current_keys_for_device = []
            try:
                with plist_file.open("rb") as f:
                    accessory = FindMyAccessory.from_plist(f)
                time_window_past = now - timedelta(days=7)
                time_window_future = now + timedelta(days=1)
                accessory_keys = accessory.keys_between(time_window_past, time_window_future)
                for key_pair in accessory_keys:
                    adv_key_bytes = key_pair.adv_key_bytes
                    adv_key_b64 = base64.urlsafe_b64encode(adv_key_bytes).decode("ascii").rstrip("=")
                    current_keys_for_device.append({
                        "adv_key_b64": adv_key_b64,
                        "key_type": key_pair.key_type.name,
                        "potential_mac": get_potential_mac_from_public_key(adv_key_bytes)
                    })
            except Exception as e:
                log.warning(f"User '{user_id}': Error processing plist {plist_file.name} for Android keys: {e}")

            devices_output.append({
                "id": device_id,
                "name": device_db_config.get("name", device_id),
                "label": device_db_config.get("label", "❓"),
                "color": device_db_config.get("color"),
                "model": device_db_config.get("model", "Accessory/Tag"),
                "icon": device_db_config.get("icon", "tag"),
                "last_battery_status": device_db_config.get("last_battery_status"),
                "android_battery_level": device_db_config.get("android_battery_level"),
                "android_device_status": device_db_config.get("android_device_status"),
                "last_seen_by_android": device_db_config.get("last_seen_by_android"),
                "last_seen_local": device_db_config.get("last_seen_local"),
                "linked_geofences": device_db_config.get("linked_geofences", []),
                "keys": current_keys_for_device,
                "current_battery_info": _get_consolidated_battery_info(device_db_config)
            })
            processed_device_ids.add(device_id)

        # Process .keys files
        for keys_file in user_data_dir.glob("*.keys"):
            device_id = keys_file.stem
            if not device_id or device_id == creds_stem or device_id in processed_device_ids:
                continue

            device_db_config = devices_config_db.get(device_id)
            if not device_db_config:
                log.warning(f"User '{user_id}': Device '{device_id}' from .keys file not found in DB config. Skipping for Android API.")
                continue

            current_keys_for_device = []
            try:
                private_keys_b64 = UserDataService._load_private_keys_from_keys_file(keys_file)
                for key_b64_string in private_keys_b64:
                    key_pair = KeyPair.from_b64(key_b64_string)
                    adv_key_bytes = key_pair.adv_key_bytes
                    adv_key_b64_urlsafe = base64.urlsafe_b64encode(adv_key_bytes).decode("ascii").rstrip("=")
                    current_keys_for_device.append({
                        "adv_key_b64": adv_key_b64_urlsafe,
                        "key_type": "STATIC_KEYS_FILE",
                        "potential_mac": get_potential_mac_from_public_key(adv_key_bytes)
                    })
            except Exception as e:
                log.warning(f"User '{user_id}': Error processing .keys file {keys_file.name} for Android keys: {e}")

            devices_output.append({
                "id": device_id,
                "name": device_db_config.get("name", device_id),
                "label": device_db_config.get("label", "❓"),
                "color": device_db_config.get("color"),
                "model": device_db_config.get("model", "Accessory/Tag"),
                "icon": device_db_config.get("icon", "tag"),
                "last_battery_status": device_db_config.get("last_battery_status"),
                "android_battery_level": device_db_config.get("android_battery_level"),
                "android_device_status": device_db_config.get("android_device_status"),
                "last_seen_by_android": device_db_config.get("last_seen_by_android"),
                "last_seen_local": device_db_config.get("last_seen_local"),
                "linked_geofences": device_db_config.get("linked_geofences", []),
                "keys": current_keys_for_device,
                "current_battery_info": _get_consolidated_battery_info(device_db_config)
            })
            processed_device_ids.add(device_id)

        # Add devices from DB that might not have .plist or .keys files
        for device_id, config_from_db in devices_config_db.items():
            if device_id not in processed_device_ids: # Ensure this device hasn't been processed via plist/keys
                devices_output.append({
                    "id": device_id,
                    "name": config_from_db.get("name", device_id),
                    "label": config_from_db.get("label", "❓"),
                    "color": config_from_db.get("color"),
                    "model": config_from_db.get("model", "Accessory/Tag"),
                    "icon": config_from_db.get("icon", "tag"),
                    "last_battery_status": config_from_db.get("last_battery_status"),
                    "android_battery_level": config_from_db.get("android_battery_level"),
                    "android_device_status": config_from_db.get("android_device_status"),
                    "last_seen_by_android": config_from_db.get("last_seen_by_android"),
                    "last_seen_local": config_from_db.get("last_seen_local"),
                    "linked_geofences": config_from_db.get("linked_geofences", []),
                    "keys": [], # No keys from files for these
                    "current_battery_info": _get_consolidated_battery_info(config_from_db)
                })

        log.info(f"User '{user_id}': Providing {len(devices_output)} devices for Android API.")
        return jsonify({"devices": devices_output})

    except Exception as e:
        log.exception(f"Error fetching Android devices for user '{user_id}'")
        return jsonify({"error": "Server error fetching devices."}), 500

def _get_consolidated_battery_info(device_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Consolidates battery information from Find My network and Android app.
    Prefers Android app's battery level if available.
    """
    android_battery_level = device_config.get("android_battery_level")
    findmy_battery_status = device_config.get("last_battery_status") # e.g., "Low", "Medium", "High", "Full"

    # Timestamps could be used for recency logic in the future
    # last_seen_android_iso = device_config.get("last_seen_by_android")
    # last_seen_local_iso = device_config.get("last_seen_local") # FindMy network last seen

    battery_info = {"level_percentage": None, "status_text": None, "source": "unknown"}

    if android_battery_level is not None:
        battery_info["level_percentage"] = android_battery_level
        battery_info["source"] = "android_app"
        if android_battery_level <= 5: # Adjusted thresholds slightly
            battery_info["status_text"] = "Very Low"
        elif android_battery_level <= 20:
            battery_info["status_text"] = "Low"
        elif android_battery_level <= 80: # Broader medium range
            battery_info["status_text"] = "Medium"
        elif android_battery_level < 100:
            battery_info["status_text"] = "High"
        elif android_battery_level == 100:
            battery_info["status_text"] = "Full"
        else: # Should not happen if battery_level is capped at 100
            battery_info["status_text"] = "Unknown"


    elif findmy_battery_status: # If no Android level, use FindMy status
        battery_info["status_text"] = findmy_battery_status
        battery_info["source"] = "findmy_network"
        # Attempt to map FindMy status to a pseudo-percentage
        if findmy_battery_status == "Very Low":
            battery_info["level_percentage"] = 5
        elif findmy_battery_status == "Low":
            battery_info["level_percentage"] = 20
        elif findmy_battery_status == "Medium":
            battery_info["level_percentage"] = 50
        elif findmy_battery_status == "High":
            battery_info["level_percentage"] = 80
        elif findmy_battery_status == "Full":
            battery_info["level_percentage"] = 100

    # If no data from either source, status_text remains None or "unknown" if preferred.
    if battery_info.get("level_percentage") is None and battery_info.get("status_text") is None:
        battery_info["status_text"] = "Unknown"


    return battery_info

@bp.route("/android/scan_result", methods=["POST"])
@login_required
def post_android_scan_result():
    from app import db # Required for db.session.commit()

    user_id = current_user.id
    data = request.get_json()
    log.info(f"API POST /android/scan_result from '{user_id}'. Data: {data}")

    if not data or "device_id" not in data or "timestamp" not in data:
        return jsonify({"error": "Missing device_id or timestamp"}), 400

    device_id = data.get("device_id")
    timestamp_str = data.get("timestamp")
    battery_level = data.get("battery_level") # Optional

    try:
        # Validate timestamp
        try:
            # Assuming timestamp is ISO 8601 format from Android
            scan_timestamp = datetime.fromisoformat(timestamp_str)
            # Ensure it's timezone-aware, defaulting to UTC if not specified
            if scan_timestamp.tzinfo is None:
                scan_timestamp = scan_timestamp.replace(tzinfo=timezone.utc)
        except ValueError:
            log.warning(f"User '{user_id}', Device '{device_id}': Invalid timestamp format '{timestamp_str}'")
            return jsonify({"error": "Invalid timestamp format. Use ISO 8601."}), 400

        device = Device.query.filter_by(id=device_id, user_username=user_id).first()
        if not device:
            return jsonify({"error": "Device not found or not owned by user"}), 404

        device.last_seen_by_android = scan_timestamp
        if battery_level is not None:
            try:
                device.android_battery_level = int(battery_level)
            except ValueError:
                log.warning(f"User '{user_id}', Device '{device_id}': Invalid battery_level format '{battery_level}'")
                # Don't fail the whole request, just skip battery update

        db.session.commit()
        log.info(f"User '{user_id}', Device '{device_id}': Updated scan_result successfully.")
        return jsonify({"message": "Scan result processed"}), 200

    except Exception as e:
        db.session.rollback()
        log.exception(f"Error processing Android scan result for user '{user_id}', device '{device_id}'")
        return jsonify({"error": "Server error processing scan result."}), 500


@bp.route("/android/device_status", methods=["POST"])
@login_required
def post_android_device_status():
    from app import db # Required for db.session.commit()

    user_id = current_user.id
    data = request.get_json()
    log.info(f"API POST /android/device_status from '{user_id}'. Data: {data}")

    if not data or "device_id" not in data or "status" not in data:
        return jsonify({"error": "Missing device_id or status"}), 400

    device_id = data.get("device_id")
    new_status = data.get("status")

    # Basic validation for status (e.g., "nearby", "lost", "unknown")
    allowed_statuses = ["nearby", "lost", "unknown"]
    if new_status not in allowed_statuses:
        return jsonify({"error": f"Invalid status. Allowed values: {', '.join(allowed_statuses)}"}), 400

    try:
        device = Device.query.filter_by(id=device_id, user_username=user_id).first()
        if not device:
            return jsonify({"error": "Device not found or not owned by user"}), 404

        device.android_device_status = new_status
        # Potentially update last_seen_by_android as well if status implies presence
        device.last_seen_by_android = datetime.now(timezone.utc)

        db.session.commit()
        log.info(f"User '{user_id}', Device '{device_id}': Updated android_device_status to '{new_status}'.")
        return jsonify({"message": "Device status updated"}), 200

    except Exception as e:
        db.session.rollback()
        log.exception(f"Error processing Android device status for user '{user_id}', device '{device_id}'")
        return jsonify({"error": "Server error processing device status."}), 500


# --- /devices Route (Keep as is) ---
@bp.route("/devices", methods=["GET"])
@login_required
def get_devices():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    response_data = {
        "devices": [],
        "last_updated": None,
        "fetch_errors": None,
        "code": "UNKNOWN",
    }
    status_code = 200
    try:
        current_user_devices_config = uds.load_devices_config(user_id)
        all_user_geofences = uds.load_geofences_config(user_id)
        user_cache = uds.load_cache_from_file(user_id)

        cache_has_data = user_cache and isinstance(user_cache.get("data"), dict)
        cache_error_detail = (
            user_cache.get("error") if user_cache else None
        ) or "Cache missing or empty."

        if not current_user_devices_config:
            response_data["error"] = "No devices configured for this user."
            response_data["code"] = "NO_DEVICES_CONFIGURED"
            log.debug(
                f"[API /devices Response Log - No Devices] User '{user_id}': {response_data}"
            )
            return jsonify(response_data), 404

        devices_list = []
        processed_ids_from_config = set()

        for device_id, config_from_db in current_user_devices_config.items():
            processed_ids_from_config.add(device_id)
            latest_report = None
            all_reports_for_device = []
            if cache_has_data:
                device_data_from_cache = user_cache["data"].get(device_id)
                if device_data_from_cache:
                    all_reports_for_device = device_data_from_cache.get("reports", [])
                    if all_reports_for_device:
                        latest_report = all_reports_for_device[0]

            # Format using config from DB (which now includes last_seen_local)
            formatted_device = format_latest_report_for_api(
                user_id,
                device_id,
                latest_report,
                config_from_db,
                all_user_geofences,
                current_app.config["LOW_BATTERY_THRESHOLD"],
            )
            # Add 'last_seen_local' directly from the config dict loaded from DB
            formatted_device["last_seen_local"] = config_from_db.get(
                "last_seen_local"
            )  # Already ISO string or None
            formatted_device["is_shared"] = uds.is_device_shared(user_id, device_id)
            formatted_device["reports"] = all_reports_for_device

            log.debug(
                f"[API /devices Formatting Log] Device '{device_id}': Formatted linked_geofences: {formatted_device.get('geofences')}"
            )
            devices_list.append(formatted_device)

        devices_list.sort(key=lambda d: d.get("name", d.get("id", "")).lower())
        response_data["devices"] = devices_list
        response_data["last_updated"] = (
            user_cache.get("timestamp") if user_cache else None
        )
        response_data["fetch_errors"] = (
            user_cache.get("error") if user_cache else cache_error_detail
        )
        response_data["code"] = (
            "OK" if cache_has_data else "CACHE_EMPTY_CONFIG_RETURNED"
        )

        log.debug(
            f"[API /devices Response Log] User '{user_id}': Sending final data structure:"
        )
        log.debug(
            f"  Response Keys: {list(response_data.keys())}, Device Count: {len(response_data.get('devices', []))}"
        )
        if response_data.get("devices"):
            log.debug(
                f"  First Device Keys: {list(response_data['devices'][0].keys()) if response_data['devices'] else 'N/A'}"
            )
            log.debug(
                f"  First Device last_seen_local: {response_data['devices'][0].get('last_seen_local') if response_data['devices'] else 'N/A'}"
            )
        return jsonify(response_data), status_code

    except Exception as e:
        log.exception(f"Error in GET /api/devices for '{user_id}'")
        error_response = {
            "error": "Server Error",
            "message": f"Error fetching devices: {e}",
        }
        log.debug(
            f"[API /devices Response Log - Error] User '{user_id}': {error_response}"
        )
        return jsonify(error_response), 500


# --- /devices/<id> PUT Route (Keep as is) ---
@bp.route("/devices/<string:device_id>", methods=["PUT"])
@login_required
def update_device_display_config(device_id):
    user_id = current_user.id
    log.debug(f"API PUT /devices/{device_id} by '{user_id}'")
    data = request.get_json()
    uds = UserDataService(current_app.config)
    if not data or not device_id:
        log.warning(f"User '{user_id}' PUT /devices/{device_id}: Invalid request.")
        abort(400, description="Invalid request data.")
    try:
        devices_config = uds.load_devices_config(user_id)
        if device_id not in devices_config:
            log.warning(f"User '{user_id}' PUT /devices/{device_id}: Device not found.")
            abort(404, description="Device not found.")
        existing_config = devices_config.get(device_id, {})
        payload_to_save = {}
        updated_fields_count = 0
        allowed_fields = ["name", "label", "color"]

        if "name" in data:
            new_name = str(data["name"]).strip() if data["name"] else device_id
            if new_name != existing_config.get("name"):
                payload_to_save["name"] = new_name
                updated_fields_count += 1
        if "label" in data:
            new_label = str(data["label"]).strip()[:5] if data["label"] else "❓"
            if new_label != existing_config.get("label", "❓"):
                payload_to_save["label"] = new_label
                updated_fields_count += 1
        if "color" in data:
            new_color = data["color"]
            if new_color == "":
                new_color = None
            elif isinstance(new_color, str) and not re.match(
                r"^#[0-9a-fA-F]{6}$", new_color
            ):
                abort(400, description="Invalid color format.")
            if new_color != existing_config.get("color"):
                payload_to_save["color"] = new_color
                updated_fields_count += 1

        if updated_fields_count > 0:
            uds.save_devices_config(user_id, {device_id: payload_to_save})
            log.info(f"User '{user_id}': Saved display config for '{device_id}'.")
            updated_device_config = uds.load_devices_config(user_id).get(device_id)
            if not updated_device_config:
                raise RuntimeError("Failed to reload device config after save.")
        else:
            log.debug(
                f"User '{user_id}', Device '{device_id}': No display changes detected."
            )
            updated_device_config = existing_config

        latest_report_from_cache = None
        user_cache = uds.load_cache_from_file(user_id)
        if user_cache and user_cache.get("data"):
            cached_device_data = user_cache["data"].get(device_id)
            if cached_device_data and cached_device_data.get("reports"):
                latest_report_from_cache = cached_device_data["reports"][0]

        is_shared = uds.is_device_shared(user_id, device_id)
        all_user_geofences = uds.load_geofences_config(user_id)
        formatted_device = format_latest_report_for_api(
            user_id,
            device_id,
            latest_report_from_cache,
            updated_device_config,
            all_user_geofences,
            current_app.config["LOW_BATTERY_THRESHOLD"],
        )
        formatted_device["last_seen_local"] = updated_device_config.get(
            "last_seen_local"
        )
        formatted_device["is_shared"] = is_shared
        if user_cache and user_cache.get("data") and user_cache["data"].get(device_id):
            formatted_device["reports"] = user_cache["data"][device_id].get(
                "reports", []
            )
        else:
            formatted_device["reports"] = []
        return jsonify(formatted_device), 200
    except ValueError as ve:
        abort(400, description=str(ve))
    except IOError as ioe:
        log.error(f"IOError processing PUT /devices/{device_id} for '{user_id}': {ioe}")
        abort(500, description="Server error saving config.")
    except Exception as e:
        log.exception(f"Error in PUT /api/devices/{device_id} for '{user_id}'")
        abort(500, description="Unexpected error.")


# --- /devices/<id>/geofence_links PUT Route (Keep as is) ---
@bp.route("/devices/<string:device_id>/geofence_links", methods=["PUT"])
@login_required
def update_device_geofence_links(device_id):
    from app import db  # Keep db import if used directly, though UDS abstracts most

    user_id = current_user.id
    # +++ ADDED PAYLOAD LOGGING +++
    data = request.get_json()
    log.debug(
        f"API PUT /devices/{device_id}/geofence_links by '{user_id}'. Received payload: {data}"
    )
    # +++ ----------------------- +++
    uds = UserDataService(current_app.config)

    if (
        not data  # Check if data itself is None or empty
        or "linked_geofences" not in data
        or not isinstance(data["linked_geofences"], list)
        or not device_id
    ):
        log.warning(
            f"User '{user_id}': Invalid payload for PUT /devices/{device_id}/geofence_links. Raw data: {request.data[:200]}"  # Log raw data on error
        )
        abort(400, description="Invalid payload: 'linked_geofences' array required.")
    try:
        device_exists = (
            db.session.query(Device.id)
            .filter_by(id=device_id, user_username=user_id)
            .first()
        )
        if not device_exists:
            log.warning(
                f"User '{user_id}': Attempted to update links for non-existent device '{device_id}'."
            )
            abort(404, description="Device not found.")

        # Construct the config part to save, only including linked_geofences
        config_to_save = {device_id: {"linked_geofences": data["linked_geofences"]}}
        uds.save_devices_config(
            user_id, config_to_save
        )  # This will now use the modified UDS

        log.info(
            f"User '{user_id}': Successfully initiated save for geofence links for '{device_id}'."
        )

        # Reload the full device config to get the final state for the response
        updated_full_config = uds.load_devices_config(user_id)
        device_config_for_response = updated_full_config.get(device_id)

        if not device_config_for_response:
            log.error(
                f"Failed to reload config for device {device_id} after saving links!"
            )
            return (
                jsonify(
                    {"message": "Links saved, but failed to confirm updated state."}
                ),
                207,
            )

        resolved_response_links = device_config_for_response.get("linked_geofences", [])
        return jsonify({"linked_geofences": resolved_response_links}), 200

    except ValueError as ve:
        log.warning(
            f"User '{user_id}' PUT /devices/{device_id}/geofence_links: Validation error: {ve}"
        )
        abort(400, description=str(ve))
    except Exception as e:
        log.exception(
            f"Error in PUT /api/devices/{device_id}/geofence_links for '{user_id}'"
        )
        abort(500, description="Unexpected error saving links.")


# --- /devices/<id> DELETE Route (Keep as is) ---
@bp.route("/devices/<string:device_id>", methods=["DELETE"])
@login_required
def delete_device(device_id):
    user_id = current_user.id
    log.warning(f"API DELETE /devices/{device_id} requested by user '{user_id}'")
    uds = UserDataService(current_app.config)
    try:
        success, message = uds.delete_device_and_data(user_id, device_id)
        status_code = 200 if success else 500
        if not success and "not found" in message:
            status_code = 404
        elif not success:
            status_code = 500
        response_data = {"message": message}
        if not success:
            response_data["error"] = "Deletion failed or item not found."
        log.info(
            f"API DELETE /devices/{device_id} result for '{user_id}': Status={status_code}, Msg={message}"
        )
        return jsonify(response_data), status_code
    except Exception as e:
        log.exception(
            f"Unexpected error during DELETE /api/devices/{device_id} for '{user_id}'"
        )
        return (
            jsonify(
                {
                    "error": "An unexpected server error occurred during deletion.",
                    "message": str(e),
                }
            ),
            500,
        )


# --- Geofence Routes (Keep as is) ---
@bp.route("/geofences", methods=["GET"])
@login_required
def get_all_geofences():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        all_user_geofences = uds.load_geofences_config(user_id)
        geofences_list = sorted(
            list(all_user_geofences.values()), key=lambda g: g.get("name", "").lower()
        )
        return jsonify(geofences_list or [])
    except Exception as e:
        log.exception(f"Error loading geofences for '{user_id}'")
        return (
            jsonify({"error": "Server Error", "message": "Failed to load geofences."}),
            500,
        )


@bp.route("/geofences", methods=["POST"])
@login_required
def create_geofence():
    from app import db

    user_id = current_user.id
    log.debug(f"API POST /geofences by '{user_id}'")
    data = request.get_json()
    uds = UserDataService(current_app.config)
    required_fields = ["name", "lat", "lng", "radius"]
    if not data or not all(k in data for k in required_fields):
        abort(
            400, description=f"Missing required fields: {', '.join(required_fields)}."
        )
    try:
        new_name = str(data["name"]).strip()
        new_lat = float(data["lat"])
        new_lng = float(data["lng"])
        new_radius = float(data["radius"])
        if (
            not new_name
            or new_radius <= 0
            or not (-90 <= new_lat <= 90)
            or not (-180 <= new_lng <= 180)
        ):
            raise ValueError("Invalid data: Check name, radius (>0), lat/lng.")
        conflict = db.session.execute(
            db.select(Geofence.id).filter_by(user_username=user_id, name=new_name)
        ).first()
        if conflict:
            abort(409, description=f"Geofence name '{new_name}' already exists.")
        new_id = generate_geofence_id()
        new_gf_obj = Geofence(
            id=new_id,
            user_username=user_id,
            name=new_name,
            latitude=new_lat,
            longitude=new_lng,
            radius=new_radius,
        )
        db.session.add(new_gf_obj)
        db.session.commit()
        created_gf_with_id = {
            "id": new_id,
            "name": new_name,
            "lat": new_lat,
            "lng": new_lng,
            "radius": new_radius,
        }
        log.info(f"User '{user_id}': Created new geofence: {created_gf_with_id}")
        return jsonify(created_gf_with_id), 201
    except ValueError as ve:
        abort(400, description=f"Invalid data: {ve}")
    except Exception as e:
        db.session.rollback()
        log.exception(f"User '{user_id}': Error creating geofence")
        return (
            jsonify({"error": "Server Error", "message": "Internal server error."}),
            500,
        )


@bp.route("/geofences/<string:geofence_id>", methods=["PUT"])
@login_required
def update_geofence(geofence_id):
    from app import db

    user_id = current_user.id
    log.debug(f"API PUT /geofences/{geofence_id} by '{user_id}'")
    data = request.get_json()
    if not data:
        abort(400, description="Request body empty.")
    try:
        geofence = db.session.execute(
            db.select(Geofence).filter_by(id=geofence_id, user_username=user_id)
        ).scalar_one_or_none()
        if not geofence:
            abort(404, description="Geofence not found.")
        updated_fields_count = 0
        if "name" in data:
            new_name = str(data["name"]).strip()
            if not new_name:
                raise ValueError("Name cannot be empty.")
            conflict = db.session.execute(
                db.select(Geofence.id).filter(
                    Geofence.user_username == user_id,
                    Geofence.id != geofence_id,
                    Geofence.name == new_name,
                )
            ).first()
            if conflict:
                abort(409, description=f"Geofence name '{new_name}' already exists.")
            if new_name != geofence.name:
                geofence.name = new_name
                updated_fields_count += 1
        if "lat" in data:
            new_lat = float(data["lat"])
            if not (-90 <= new_lat <= 90):
                raise ValueError("Invalid latitude.")
            if new_lat != geofence.latitude:
                geofence.latitude = new_lat
                updated_fields_count += 1
        if "lng" in data:
            new_lng = float(data["lng"])
            if not (-180 <= new_lng <= 180):
                raise ValueError("Invalid longitude.")
            if new_lng != geofence.longitude:
                geofence.longitude = new_lng
                updated_fields_count += 1
        if "radius" in data:
            new_radius = float(data["radius"])
            if new_radius <= 0:
                raise ValueError("Radius must be positive.")
            if new_radius != geofence.radius:
                geofence.radius = new_radius
                updated_fields_count += 1
        if updated_fields_count > 0:
            db.session.commit()
            log.info(f"User '{user_id}': Updated geofence {geofence_id}")
        else:
            log.debug(
                f"User '{user_id}', Geofence '{geofence_id}': No changes detected."
            )
        final_gf_data = {
            "id": geofence.id,
            "name": geofence.name,
            "lat": geofence.latitude,
            "lng": geofence.longitude,
            "radius": geofence.radius,
        }
        return jsonify(final_gf_data), 200
    except ValueError as ve:
        db.session.rollback()
        abort(400, description=f"Invalid data: {ve}")
    except Exception as e:
        db.session.rollback()
        log.exception(f"User '{user_id}': Error updating geofence {geofence_id}")
        return (
            jsonify({"error": "Server Error", "message": "Internal server error."}),
            500,
        )


@bp.route("/geofences/<string:geofence_id>", methods=["DELETE"])
@login_required
def delete_geofence(geofence_id):
    from app import db

    user_id = current_user.id
    log.debug(f"API DELETE /geofences/{geofence_id} by '{user_id}'")
    uds = UserDataService(current_app.config)
    try:
        geofence = db.session.execute(
            db.select(Geofence).filter_by(id=geofence_id, user_username=user_id)
        ).scalar_one_or_none()
        if not geofence:
            abort(404, description="Geofence not found.")
        deleted_name = geofence.name
        log.info(
            f"User '{user_id}': Deleting geofence '{deleted_name}' ({geofence_id}) from DB"
        )
        uds._handle_geofence_deletion_dependencies(user_id, {geofence_id})
        db.session.delete(geofence)
        db.session.commit()
        log.info(
            f"User '{user_id}': Deleted geofence '{deleted_name}' ({geofence_id}) and cleaned up state/links."
        )
        return (
            jsonify({"message": f"Geofence '{deleted_name}' deleted successfully."}),
            200,
        )
    except ValueError as ve:
        db.session.rollback()
        abort(400, description=f"Invalid data during delete: {ve}")
    except Exception as e:
        db.session.rollback()
        log.exception(f"User '{user_id}': Error deleting geofence {geofence_id}")
        return (
            jsonify({"error": "Server Error", "message": "Internal server error."}),
            500,
        )


# --- VAPID/Push Routes (Keep as is) ---
@bp.route("/vapid_public_key", methods=["GET"])
@login_required
def get_vapid_public_key():
    log.debug("API GET /vapid_public_key called.")
    if (
        not current_app.config["VAPID_ENABLED"]
        or not current_app.config["VAPID_PUBLIC_KEY"]
    ):
        log.error("VAPID public key requested but not configured.")
        abort(503, description="Push notifications not configured.")
    return jsonify({"publicKey": current_app.config["VAPID_PUBLIC_KEY"]})


# --- /subscribe Route (Keep as is - Note CSRF Exempt) ---
@bp.route("/subscribe", methods=["POST"])
@login_required
@limiter.limit("500 per hour")
@csrf.exempt  # Keep exempt
def subscribe():
    user_id = current_user.id
    log.debug(f"API POST /subscribe by '{user_id}' (CSRF Exempt)")
    uds = UserDataService(current_app.config)
    notifier = NotificationService(current_app.config, uds)

    if not current_app.config["VAPID_ENABLED"]:
        log.warning(f"User '{user_id}': Subscription attempt failed - VAPID disabled.")
        abort(503, description="Push notifications disabled.")

    request_payload = request.get_json()
    if not request_payload or not isinstance(request_payload, dict):
        log.warning(
            f"User '{user_id}': Subscription attempt failed - Invalid JSON payload: {request.data[:100]}"
        )
        abort(400, description="Invalid request payload format. Expecting JSON object.")

    # --- Extract subscription and fcm_token from payload ---
    subscription_data = request_payload.get("subscription")
    fcm_token = request_payload.get("fcm_token")  # Optional FCM token
    log.debug(
        f"User '{user_id}': Received subscription data: {str(subscription_data)[:100]}..., FCM Token: {'Present' if fcm_token else 'None'}"
    )
    # --- ----------------------------------------------- ---

    # --- Validate the *extracted* subscription_data ---
    if not notifier.is_valid_subscription(subscription_data):
        log.warning(
            f"User '{user_id}': Subscription attempt failed - Invalid subscription object structure in payload."
        )
        abort(400, description="Invalid subscription data.")
    # --- ------------------------------------------ ---

    endpoint = subscription_data["endpoint"]
    new_subscription = False
    try:
        # Load existing subscriptions
        user_subscriptions = uds.load_subscriptions(user_id)

        # --- Save extracted subscription_data ---
        if endpoint not in user_subscriptions:
            log.info(f"User '{user_id}': New push subscription: {endpoint[:50]}...")
            user_subscriptions[endpoint] = subscription_data
            new_subscription = True
        else:
            log.info(
                f"User '{user_id}': Subscription exists: {endpoint[:50]}... Updating."
            )
            user_subscriptions[endpoint] = subscription_data
        # --- ---------------------------------- ---

        # --- TODO: Save FCM Token if present and valid ---
        if fcm_token and isinstance(fcm_token, str) and len(fcm_token) > 10:
            log.info(
                f"User '{user_id}': Received FCM token: {fcm_token[:10]}... (Save logic TODO)"
            )
            # Example DB save logic would go here (e.g., in PushSubscription model or separate table)
        # --- ----------------------------------------- ---

        uds.save_subscriptions(user_id, user_subscriptions)

        if new_subscription:
            notifier.send_welcome_notification(user_id, subscription_data)

        status_code = 201 if new_subscription else 200
        log.info(f"API POST /subscribe for '{user_id}': Responding {status_code}.")
        return jsonify({"message": "Subscription received."}), status_code
    except Exception as e:
        log.exception(
            f"Error processing subscription for '{user_id}', {endpoint[:50]}..."
        )
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to process subscription.",
                }
            ),
            500,
        )


# --- /unsubscribe Route (Keep as is) ---
@bp.route("/unsubscribe", methods=["POST"])
@login_required
@limiter.limit("500 per hour")
def unsubscribe():
    user_id = current_user.id
    log.debug(f"API POST /unsubscribe by '{user_id}'")
    uds = UserDataService(current_app.config)
    data = request.get_json()
    endpoint = data.get("endpoint") if isinstance(data, dict) else None
    if not endpoint or not isinstance(endpoint, str):
        abort(400, description="Invalid request: 'endpoint' (string) required.")
    removed = False
    try:
        user_subscriptions = uds.load_subscriptions(user_id)
        if endpoint in user_subscriptions:
            log.info(
                f"User '{user_id}': Removing subscription via API: {endpoint[:50]}..."
            )
            del user_subscriptions[endpoint]
            uds.save_subscriptions(user_id, user_subscriptions)
            removed = True
            log.info(f"User '{user_id}': Successfully removed {endpoint[:50]}...")
        else:
            log.info(
                f"User '{user_id}': Unsubscribe for non-existent endpoint: {endpoint[:50]}..."
            )
        response_message = (
            "Unsubscription successful" if removed else "Subscription not found"
        )
        log.info(
            f"API POST /unsubscribe for '{user_id}': Responding 200. Msg: {response_message}"
        )
        return jsonify({"message": response_message}), 200
    except Exception as e:
        log.exception(f"Error during unsubscribe for '{user_id}', {endpoint[:50]}...")
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to process unsubscription.",
                }
            ),
            500,
        )


# --- /utils/generate_icon Route (Keep as is) ---
@bp.route("/utils/generate_icon", methods=["GET"])
@login_required
def generate_icon():
    label = request.args.get("label", "?")
    color = request.args.get("color", None)
    size = request.args.get("size", 36, type=int)
    if not color:
        color = getDefaultColorForId(label)
    elif not re.match(r"^#[0-9a-fA-F]{6}$", color):
        log.warning(f"Invalid color '{color}' requested, using default.")
        color = "#70757a"
    try:
        svg_content = generate_device_icon_svg(label, color, size)
        return Response(svg_content, mimetype="image/svg+xml")
    except Exception as e:
        log.error(f"Error generating SVG icon via API: {e}")
        abort(500, "Failed to generate icon")


# --- Config Routes (Keep as is) ---
@bp.route("/config/get_part/<string:part_name>", methods=["GET"])
@login_required
def get_config_part(part_name):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    data_to_return = None
    try:
        if part_name == "geofences":
            data_to_return = uds.load_geofences_config(user_id)
        elif part_name == "devices":
            devices_conf = uds.load_devices_config(user_id)
            data_to_return = {
                dev_id: {k: v for k, v in conf.items() if k != "svg_icon"}
                for dev_id, conf in devices_conf.items()
            }
        else:
            abort(404, description=f"Unknown config part: {part_name}")
        log.info(f"User '{user_id}': Providing config part '{part_name}'.")
        return jsonify(data_to_return)
    except Exception as e:
        log.exception(f"Error providing config part '{part_name}' for user '{user_id}'")
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": f"Error retrieving configuration part: {part_name}",
                }
            ),
            500,
        )


@bp.route("/config/import_apply", methods=["POST"])
@login_required
@limiter.limit("500 per hour")
def config_import_apply():
    from app import db

    user_id = current_user.id
    uds = UserDataService(current_app.config)
    data = request.get_json()
    if not data or not isinstance(data.get("parts"), dict):
        log.warning(f"User '{user_id}' import apply: Invalid request body.")
        abort(400, description="Invalid request: 'parts' dictionary required.")

    parts_to_import = data["parts"]
    results = {"success": [], "errors": []}
    config_changed = False
    log.info(
        f"User '{user_id}': Applying imported server config parts: {list(parts_to_import.keys())}"
    )

    try:  # Wrap processing in a single transaction
        # --- Geofences ---
        if "geofences" in parts_to_import:
            geofence_data = parts_to_import["geofences"]
            log.debug(f"User '{user_id}': Found 'geofences' part for import.")
            if isinstance(geofence_data, dict):
                try:
                    num_geofences = len(geofence_data)
                    log.info(
                        f"User '{user_id}': Attempting to save {num_geofences} imported geofences."
                    )
                    uds.save_geofences_config(
                        user_id, geofence_data
                    )  # Uses DB, commits internally
                    results["success"].append(f"Imported {num_geofences} geofences.")
                    config_changed = True
                    log.info(f"User '{user_id}': Successfully imported geofences.")
                except Exception as e:
                    log.error(
                        f"User '{user_id}': Error importing geofences: {e}",
                        exc_info=True,
                    )
                    results["errors"].append(
                        f"Failed to import geofences: {str(e)[:100]}..."
                    )
            else:
                log.warning(
                    f"User '{user_id}': Invalid format for geofences data (not dict)."
                )
                results["errors"].append("Invalid format for geofences data.")

        # --- Devices ---
        if "devices" in parts_to_import:
            device_data = parts_to_import["devices"]
            log.debug(f"User '{user_id}': Found 'devices' part for import.")
            if isinstance(device_data, dict):
                try:
                    num_devices = len(device_data)
                    log.info(
                        f"User '{user_id}': Attempting to save {num_devices} imported device configurations."
                    )
                    uds.save_devices_config(
                        user_id, device_data
                    )  # Uses DB, commits internally
                    results["success"].append(
                        f"Imported {num_devices} device configurations."
                    )
                    config_changed = True
                    log.info(
                        f"User '{user_id}': Successfully imported device configurations."
                    )
                except Exception as e:
                    log.error(
                        f"User '{user_id}': Error importing devices config: {e}",
                        exc_info=True,
                    )
                    results["errors"].append(
                        f"Failed to import device configurations: {str(e)[:100]}..."
                    )
            else:
                log.warning(
                    f"User '{user_id}': Invalid format for devices data (not dict)."
                )
                results["errors"].append("Invalid format for devices data.")

        # --- Shares (Stages changes, needs commit) ---
        if "shares" in parts_to_import:
            shares_data_list = parts_to_import["shares"]
            log.debug(
                f"User '{user_id}': Found 'shares' part for import ({len(shares_data_list) if isinstance(shares_data_list, list) else 'N/A'} items)."
            )
            if isinstance(shares_data_list, list):
                try:
                    num_shares_imported = uds.import_user_shares(
                        user_id, shares_data_list
                    )
                    results["success"].append(
                        f"Imported {num_shares_imported} shared links."
                    )
                    config_changed = True
                    log.info(
                        f"User '{user_id}': Successfully STAGED {num_shares_imported} shared links for commit."
                    )
                except Exception as e:
                    log.error(
                        f"User '{user_id}': Error importing/staging shared links: {e}",
                        exc_info=True,
                    )
                    results["errors"].append(
                        f"Failed to import shared links: {str(e)[:100]}..."
                    )
            else:
                log.warning(
                    f"User '{user_id}': Invalid format for shares data (not a list)."
                )
                results["errors"].append(
                    "Invalid format for shares data (expected list)."
                )

        # --- FINAL COMMIT (Needed for shares and potentially other changes) ---
        if not results["errors"]:
            db.session.commit()
            log.info(f"User '{user_id}': Final commit successful for config import.")
        else:
            db.session.rollback()
            log.error(
                f"User '{user_id}': Config import encountered errors. Rolling back staged changes."
            )

    except Exception as e:
        # Catch any broader errors during the process
        db.session.rollback()
        log.exception(
            f"User '{user_id}': Unexpected error during config import processing."
        )
        results["errors"].append(f"Unexpected server error: {str(e)[:100]}...")

    # --- Response Logic (Keep existing) ---
    if config_changed and not results["errors"]:
        log.info(f"User '{user_id}': Import successful, configuration changed.")

    if not results["errors"]:
        log.info(f"User '{user_id}': Config import apply finished successfully.")
        return (
            jsonify(
                {
                    "message": "Server configuration imported successfully.",
                    "details": results,
                }
            ),
            200,
        )
    elif results["success"]:
        log.warning(f"User '{user_id}': Config import apply finished with some errors.")
        return (
            jsonify(
                {
                    "message": "Server configuration imported with some errors.",
                    "details": results,
                }
            ),
            207,
        )
    else:
        log.error(f"User '{user_id}': Config import apply failed completely.")
        return (
            jsonify(
                {"error": "Failed to import server configuration.", "details": results}
            ),
            500,
        )


# --- Test Notification Route (Keep as is) ---
@bp.route(
    "/devices/<string:device_id>/test_notification/<string:notification_type>",
    methods=["POST"],
)
@login_required
def test_device_notification(device_id, notification_type):
    user_id = current_user.id
    log.info(
        f"API POST /devices/{device_id}/test_notification/{notification_type} by '{user_id}'"
    )
    uds = UserDataService(current_app.config)
    notifier = NotificationService(current_app.config, uds)
    try:
        device_config = uds.load_devices_config(user_id).get(device_id)
        if not device_config:
            abort(404, description="Device configuration not found.")
        device_name = device_config.get("name", device_id)
        device_label = device_config.get("label", "❓")
        device_color = device_config.get("color", getDefaultColorForId(device_id))
        title = f"Test: {device_name}"
        body = ""
        data_payload = {
            "type": "test",
            "deviceId": device_id,
            "testType": notification_type,
        }
        notification_specific_type = "test"
        if notification_type == "geofence_entry":
            test_gf_name = "Test Area"
            title = f"{device_name} Entered {test_gf_name} (Test)"
            body = f"This is a test notification for entering '{test_gf_name}'."
            data_payload["geofenceName"] = test_gf_name
            data_payload["eventType"] = "entry"
            notification_specific_type = "geofence_entry"
        elif notification_type == "geofence_exit":
            test_gf_name = "Test Area"
            title = f"{device_name} Exited {test_gf_name} (Test)"
            body = f"This is a test notification for exiting '{test_gf_name}'."
            data_payload["geofenceName"] = test_gf_name
            data_payload["eventType"] = "exit"
            notification_specific_type = "geofence_exit"
        elif notification_type == "battery_low":
            test_level = current_app.config["LOW_BATTERY_THRESHOLD"] - 1
            title = f"{device_name} Battery Low (Test)"
            body = f"Test: Battery is low ({test_level}%)."
            data_payload["level"] = test_level
            notification_specific_type = "battery_low"
        elif notification_type == "generic_test":
            title = f"Test Notification for {device_name}"
            body = "This is a generic test push message."
        else:
            abort(
                400,
                description=f"Invalid notification type for testing: {notification_type}",
            )
        log.info(
            f"User '{user_id}': Triggering test notification (type: {notification_type}) for device {device_id}"
        )
        notifier.send_user_notifications(
            user_id=user_id,
            title=title,
            body=body,
            tag=f"test-{device_id}-{notification_type}-{int(time.time())}",
            data_payload=data_payload,
            device_label=device_label,
            device_color=device_color,
            notification_type=notification_specific_type,
        )
        return (
            jsonify(
                {
                    "message": f"Test notification '{notification_type}' sent for {device_name}."
                }
            ),
            200,
        )
    except Exception as e:
        log.exception(
            f"Error sending test notification for {device_id}, type {notification_type}, user '{user_id}'"
        )
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to send test notification.",
                }
            ),
            500,
        )


# --- Notification History Routes (Keep as is) ---
@bp.route("/notifications/history", methods=["GET"])
@login_required
def get_notification_history():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        history = uds.load_notification_history(user_id)
        return jsonify(history or [])
    except Exception as e:
        log.exception(f"Error getting notification history for user '{user_id}'")
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to load notification history.",
                }
            ),
            500,
        )


@bp.route("/notifications/history/<string:notification_id>/read", methods=["PUT"])
@login_required
def mark_notification_read(notification_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    log.info(f"API PUT /notifications/history/{notification_id}/read by '{user_id}'")
    try:
        success = uds.update_notification_read_status(user_id, notification_id, True)
        return jsonify({"message": "Notification marked as read."}), (
            200
            if success
            else (
                jsonify(
                    {
                        "error": "Not Found",
                        "message": "Notification not found or update failed.",
                    }
                ),
                404,
            )
        )
    except Exception as e:
        log.exception(
            f"Error marking notification read for user '{user_id}', id {notification_id}"
        )
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to update notification status.",
                }
            ),
            500,
        )


@bp.route("/notifications/history/<string:notification_id>/unread", methods=["PUT"])
@login_required
def mark_notification_unread(notification_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    log.info(f"API PUT /notifications/history/{notification_id}/unread by '{user_id}'")
    try:
        success = uds.update_notification_read_status(user_id, notification_id, False)
        return jsonify({"message": "Notification marked as unread."}), (
            200
            if success
            else (
                jsonify(
                    {
                        "error": "Not Found",
                        "message": "Notification not found or update failed.",
                    }
                ),
                404,
            )
        )
    except Exception as e:
        log.exception(
            f"Error marking notification unread for user '{user_id}', id {notification_id}"
        )
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to update notification status.",
                }
            ),
            500,
        )


@bp.route("/notifications/history/<string:notification_id>", methods=["DELETE"])
@login_required
def delete_notification(notification_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    log.info(f"API DELETE /notifications/history/{notification_id} by '{user_id}'")
    try:
        success = uds.delete_notification_history(user_id, notification_id)
        return jsonify({"message": "Notification deleted."}), (
            200
            if success
            else (
                jsonify({"message": "Notification not found or already deleted."}),
                200,
            )
        )
    except Exception as e:
        log.exception(
            f"Error deleting notification for user '{user_id}', id {notification_id}"
        )
        return (
            jsonify(
                {"error": "Server Error", "message": "Failed to delete notification."}
            ),
            500,
        )


@bp.route("/notifications/history", methods=["DELETE"])
@login_required
def delete_all_notifications():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    log.warning(f"API DELETE /notifications/history (ALL) by '{user_id}'")
    try:
        success = uds.delete_notification_history(user_id, None)
        return jsonify({"message": "All notification history cleared."}), (
            200
            if success
            else (
                jsonify(
                    {"message": "Notification history already clear or issue occurred."}
                ),
                200,
            )
        )
    except Exception as e:
        log.exception(f"Error clearing notification history for user '{user_id}'")
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to clear notification history.",
                }
            ),
            500,
        )


# --- User Preference Routes (Keep as is) ---
@bp.route("/user/preferences", methods=["GET"])
@login_required
def get_user_preferences():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        prefs = uds.load_user_preferences(user_id)
        return jsonify(prefs)
    except Exception as e:
        log.exception(f"Error getting preferences for user '{user_id}'")
        return (
            jsonify(
                {"error": "Server Error", "message": "Failed to load user preferences."}
            ),
            500,
        )


@bp.route("/user/preferences", methods=["PUT"])
@login_required
def update_user_preferences():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    data = request.get_json()
    if not data or "theme_mode" not in data or "theme_color" not in data:
        log.warning(
            f"User '{user_id}' PUT /user/preferences: Invalid data payload: {data}"
        )
        abort(400, description="Missing 'theme_mode' or 'theme_color' in request.")
    theme_mode = data.get("theme_mode")
    theme_color = data.get("theme_color")
    try:
        uds.save_user_preferences(user_id, theme_mode, theme_color)
        log.info(f"API PUT /user/preferences successful for '{user_id}'")
        return jsonify({"message": "Preferences updated successfully."}), 200
    except ValueError as ve:
        log.warning(f"User '{user_id}' PUT /user/preferences: Validation error: {ve}")
        abort(400, description=str(ve))
    except RuntimeError as re_err:
        log.error(f"User '{user_id}' PUT /user/preferences: Runtime error: {re_err}")
        return (
            jsonify(
                {"error": "Conflict", "message": "Server error saving preferences."}
            ),
            500,
        )
    except Exception as e:
        log.exception(f"Error updating preferences for user '{user_id}'")
        return (
            jsonify(
                {"error": "Server Error", "message": "Failed to save user preferences."}
            ),
            500,
        )


# --- User Refresh Route (Keep as is) ---
@bp.route("/user/refresh", methods=["POST"])
@login_required
@limiter.limit("500 per hour")
def force_user_refresh():
    user_id = current_user.id
    log.info(f"API POST /user/refresh triggered for user '{user_id}'")
    uds = UserDataService(current_app.config)
    try:
        apple_id, apple_password, _ = uds.load_apple_credentials_and_state(user_id)
        if not apple_id or not apple_password:
            log.warning(
                f"User '{user_id}': Cannot force refresh, credentials missing or decryption failed."
            )
            return (
                jsonify(
                    {
                        "error": "Credentials Required",
                        "message": "Apple credentials are not set or could not be decrypted.",
                    }
                ),
                403,
            )
        log.info(f"Spawning immediate fetch task for user '{user_id}' via API request.")
        app_context = current_app._get_current_object()
        immediate_fetch_thread = threading.Thread(
            target=run_fetch_for_user_task,
            args=(app_context, user_id),
            name=f"ApiForceFetch-{user_id}",
            daemon=True,
        )
        immediate_fetch_thread.start()
        return jsonify({"message": "Background refresh initiated."}), 202
    except Exception as e:
        log.exception(f"Error initiating force refresh for user '{user_id}'")
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": f"Failed to initiate background refresh: {e}",
                }
            ),
            500,
        )


# --- User Delete Route (Keep as is) ---
@bp.route("/user/delete", methods=["DELETE"])
@login_required
@limiter.limit("100 per hour")
def delete_account():
    user_id = current_user.id
    log.warning(f"Received DELETE request for account '{user_id}'")
    uds = UserDataService(current_app.config)
    try:
        delete_successful = uds.delete_user_data(user_id)
        if delete_successful:
            log.info(f"Account data deletion successful for '{user_id}'.")
            return (
                jsonify(
                    {
                        "message": f"Account '{user_id}' deletion process initiated successfully.",
                        "action": "redirect_to_login",
                    }
                ),
                200,
            )
        else:
            log.error(f"Account deletion failed for '{user_id}' during data removal.")
            return (
                jsonify(
                    {
                        "error": "Account deletion failed.",
                        "message": "Failed to remove user data. Check server logs.",
                    }
                ),
                500,
            )
    except Exception as e:
        log.exception(
            f"Unexpected error during account deletion API call for '{user_id}'"
        )
        return (
            jsonify(
                {"error": "Server Error", "message": "An unexpected error occurred."}
            ),
            500,
        )


# --- Share Routes (Keep as is) ---
@bp.route("/devices/<string:device_id>/share", methods=["POST"])
@login_required
def create_device_share(device_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    data = request.get_json() or {}
    duration_str = data.get("duration", "24h")
    note = data.get("note", "")[:100]
    duration_hours: Optional[int] = None
    if duration_str == "indefinite":
        duration_hours = 0
    elif duration_str.endswith("h"):
        try:
            duration_hours = int(duration_str[:-1])
        except ValueError:
            abort(400, description="Invalid duration number.")
    elif duration_str.endswith("d"):
        try:
            duration_hours = int(duration_str[:-1]) * 24
        except ValueError:
            abort(400, description="Invalid duration number.")
    else:
        abort(400, description="Invalid duration unit ('h', 'd', 'indefinite').")
    if duration_hours is not None and (duration_hours < 0 or duration_hours > 30 * 24):
        abort(400, description="Duration out of range (1h-30d or indefinite).")
    log.info(
        f"User '{user_id}' request share for '{device_id}' (Duration: {duration_str})"
    )
    try:
        new_share = uds.add_share(user_id, device_id, duration_hours, note)
        if new_share:
            share_url = url_for(
                "public.view_shared_device",
                share_id=new_share["share_id"],
                _external=True,
            )
            return jsonify({**new_share, "share_url": share_url}), 201
        else:
            return (
                jsonify(
                    {
                        "error": "Server Error",
                        "message": "Failed to create share link (DB error or invalid input).",
                    }
                ),
                500,
            )
    except ValueError as ve:
        log.warning(
            f"Share creation failed for user {user_id}, device {device_id}: {ve}"
        )
        abort(400, description=str(ve))
    except Exception as e:
        log.exception(f"Error creating share for {device_id}")
        return (
            jsonify(
                {"error": "Server Error", "message": f"Unexpected server error: {e}"}
            ),
            500,
        )


@bp.route("/shares", methods=["GET"])
@login_required
def get_my_shares():
    from app import db

    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        user_shares = uds.get_user_shares(user_id)
        for share in user_shares:
            try:
                share["share_url"] = url_for(
                    "public.view_shared_device",
                    share_id=share["share_id"],
                    _external=True,
                )
            except Exception:
                share["share_url"] = None
        return jsonify(user_shares or [])
    except Exception as e:
        log.exception(f"Error fetching shares for user '{user_id}'")
        return (
            jsonify({"error": "Server Error", "message": "Failed to retrieve shares."}),
            500,
        )


@bp.route("/shares/<string:share_id>/status", methods=["PUT"])
@login_required
def set_share_status(share_id):
    from app import db

    user_id = current_user.id
    uds = UserDataService(current_app.config)
    data = request.get_json()
    if data is None or "active" not in data or not isinstance(data["active"], bool):
        abort(
            400, description="Invalid request body. Expecting {'active': true/false}."
        )
    new_status = data["active"]
    log.info(
        f"User '{user_id}' attempting to set share '{share_id}' status to {new_status}"
    )
    try:
        success = uds.toggle_share_status(share_id, user_id, new_status)
        if success:
            updated_share = uds.get_share(share_id)
            if updated_share:
                device_config = uds.load_devices_config(user_id).get(
                    updated_share.get("device_id")
                )
                updated_share["device_name"] = (
                    device_config.get("name", updated_share.get("device_id", "Unknown"))
                    if device_config
                    else "Unknown Device"
                )
                try:
                    updated_share["share_url"] = url_for(
                        "public.view_shared_device", share_id=share_id, _external=True
                    )
                except Exception:
                    updated_share["share_url"] = None
                is_expired_check = False
                expires_at_str = updated_share.get("expires_at")
                if expires_at_str:
                    try:
                        expires_at_dt = datetime.fromisoformat(
                            expires_at_str.replace("Z", "+00:00")
                        )
                        if expires_at_dt.tzinfo is None:
                            expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
                            is_expired_check = expires_at_dt < datetime.now(
                                timezone.utc
                            )
                    except ValueError:
                        pass
                updated_share["is_expired"] = is_expired_check
                return jsonify(updated_share), 200
            else:
                return (
                    jsonify(
                        {
                            "message": f"Share status set to {new_status}, but couldn't retrieve updated details."
                        }
                    ),
                    200,
                )
        else:
            abort(
                404,
                description="Share not found or you do not have permission to modify it.",
            )
    except Exception as e:
        log.exception(
            f"Error setting status for share '{share_id}' by user '{user_id}'"
        )
        return (
            jsonify(
                {"error": "Server Error", "message": "Failed to update share status."}
            ),
            500,
        )


@bp.route("/shares/<string:share_id>/duration", methods=["PUT"])
@login_required
def update_share_duration(share_id):
    from app import db

    user_id = current_user.id
    uds = UserDataService(current_app.config)
    data = request.get_json()
    if data is None or "duration" not in data:
        abort(
            400,
            description="Invalid request body. Expecting {'duration': '1h'/'24h'/'7d'/'indefinite'/etc}.",
        )
    duration_str = data["duration"]
    note = data.get("note", None)
    if note is not None:
        note = note.strip()[:100]
    duration_hours: Optional[int] = None
    if duration_str == "indefinite":
        duration_hours = 0
    elif duration_str.endswith("h"):
        try:
            duration_hours = int(duration_str[:-1])
        except ValueError:
            abort(400, description="Invalid duration format.")
    elif duration_str.endswith("d"):
        try:
            duration_hours = int(duration_str[:-1]) * 24
        except ValueError:
            abort(400, description="Invalid duration format.")
    else:
        abort(400, description="Invalid duration unit.")
    if duration_hours is not None and (duration_hours < 0 or duration_hours > 30 * 24):
        abort(400, description="Duration out of range.")
    log.info(
        f"User '{user_id}' attempting to update duration for share '{share_id}' to {duration_str}"
    )
    try:
        updated_share_data = uds.update_share_expiry(share_id, user_id, duration_hours)
        if updated_share_data:
            if note is not None:
                share_obj = db.session.execute(
                    db.select(Share).filter_by(id=share_id, user_username=user_id)
                ).scalar_one_or_none()
                if share_obj:
                    share_obj.note = note
                    db.session.commit()
                    updated_share_data["note"] = note
                    log.info(
                        f"User '{user_id}' also updated note for share '{share_id}'."
                    )
                else:
                    pass
            device_config = uds.load_devices_config(user_id).get(
                updated_share_data.get("device_id")
            )
            updated_share_data["device_name"] = (
                device_config.get(
                    "name", updated_share_data.get("device_id", "Unknown")
                )
                if device_config
                else "Unknown Device"
            )
            try:
                updated_share_data["share_url"] = url_for(
                    "public.view_shared_device", share_id=share_id, _external=True
                )
            except Exception:
                updated_share_data["share_url"] = None
            return jsonify(updated_share_data), 200
        else:
            abort(
                404,
                description="Share not found or you do not have permission to modify it.",
            )
    except Exception as e:
        log.exception(
            f"Error updating duration/note for share '{share_id}' by user '{user_id}'"
        )
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": f"Failed to update share duration/note: {e}",
                }
            ),
            500,
        )


@bp.route("/shares/<string:share_id>", methods=["DELETE"])
@login_required
def delete_my_share_permanently(share_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    log.warning(f"Permanent DELETE request for share '{share_id}' by user '{user_id}'")
    try:
        success = uds.delete_share_permanently(share_id, user_id)
        if success:
            return jsonify({"message": "Share link permanently deleted."}), 200
        else:
            abort(
                404,
                description="Share not found or you do not have permission to delete it.",
            )
    except Exception as e:
        log.exception(
            f"Error permanently deleting share '{share_id}' for user '{user_id}'"
        )
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to permanently delete share.",
                }
            ),
            500,
        )


# --- 2FA Routes (Keep as is) ---
@bp.route("/auth/2fa/methods", methods=["GET"])
@login_required
def get_2fa_methods():
    user_id = current_user.id
    log.info(f"API GET /auth/2fa/methods requested by user '{user_id}'")
    account = _restore_pending_2fa_account()
    if not account:
        abort(
            409,
            description="No active 2FA process found or account state invalid. Please try logging in again.",
        )
    try:
        methods_raw = account.get_2fa_methods()
        methods_serializable = []
        for index, method in enumerate(methods_raw):
            method_data = {"index": index}
            if isinstance(method, SmsSecondFactorMethod):
                method_data["type"] = "sms"
                method_data["detail"] = method.phone_number
                method_data["id"] = method.phone_number_id
            elif isinstance(method, TrustedDeviceSecondFactorMethod):
                method_data["type"] = "trusted_device"
                method_data["detail"] = "Trusted Device"
                method_data["id"] = None
            else:
                continue
            methods_serializable.append(method_data)
        log.info(
            f"User '{user_id}': Returning {len(methods_serializable)} 2FA methods."
        )
        return jsonify({"methods": methods_serializable})
    except Exception as e:
        log.exception(f"User '{user_id}': Error retrieving 2FA methods.")
        abort(500, description=f"Server error getting 2FA methods: {e}")


@bp.route("/auth/2fa/request_code", methods=["POST"])
@login_required
def request_2fa_code():
    user_id = current_user.id
    data = request.get_json()
    if not data or "method_index" not in data:
        abort(400, description="Missing 'method_index' in request.")
    method_index = data.get("method_index")
    log.info(
        f"API POST /auth/2fa/request_code by user '{user_id}', method index: {method_index}"
    )
    account = _restore_pending_2fa_account()
    if not account:
        abort(
            409, description="No active 2FA process found. Please try logging in again."
        )
    try:
        methods = account.get_2fa_methods()
        if not isinstance(method_index, int) or not (0 <= method_index < len(methods)):
            abort(400, description="Invalid method index.")
        selected_method = methods[method_index]
        log.info(
            f"User '{user_id}': Requesting 2FA code using method type: {type(selected_method).__name__}"
        )
        selected_method.request()
        log.info(
            f"User '{user_id}': 2FA code request sent successfully for method index {method_index}."
        )
        return jsonify({"message": "2FA code requested successfully."}), 200
    except Exception as e:
        log.exception(
            f"User '{user_id}': Error requesting 2FA code for index {method_index}."
        )
        abort(500, description=f"Server error requesting 2FA code: {e}")


@bp.route("/auth/2fa/submit_code", methods=["POST"])
@login_required
def submit_2fa_code():
    user_id = current_user.id
    data = request.get_json()
    if not data or "method_index" not in data or "code" not in data:
        abort(400, description="Missing 'method_index' or 'code' in request.")
    method_index = data.get("method_index")
    code = str(data.get("code", "")).strip()
    log.info(
        f"API POST /auth/2fa/submit_code by user '{user_id}', method index: {method_index}"
    )
    if len(code) != 6 or not code.isdigit():
        abort(400, description="Invalid code format. Must be 6 digits.")
    account = _restore_pending_2fa_account()
    pending_creds = session.get("pending_2fa_creds")
    if not account or not pending_creds:
        abort(
            409,
            description="No active 2FA process or credentials found. Please try logging in again.",
        )
    try:
        methods = account.get_2fa_methods()
        if not isinstance(method_index, int) or not (0 <= method_index < len(methods)):
            abort(400, description="Invalid method index.")
        selected_method = methods[method_index]
        log.info(
            f"User '{user_id}': Submitting 2FA code for method type: {type(selected_method).__name__}"
        )
        final_state = selected_method.submit(code)
        log.info(f"User '{user_id}': State after 2FA code submission: {final_state}")
        if final_state == LoginState.LOGGED_IN:
            log.info(f"User '{user_id}': 2FA verification successful!")
            uds = UserDataService(current_app.config)
            final_account_state = account.export()
            apple_id = pending_creds.get("apple_id")
            unencrypted_password = pending_creds.get("apple_password_unencrypted")
            if not apple_id or not unencrypted_password:
                log.error(
                    f"User '{user_id}': Missing credentials in session after successful 2FA."
                )
                abort(
                    500,
                    description="Internal error: Missing credentials during 2FA completion.",
                )
            uds.save_apple_credentials_and_state(
                user_id, apple_id, unencrypted_password, final_account_state
            )
            session.pop("pending_2fa_account_data", None)
            session.pop("pending_2fa_creds", None)
            log.info(f"User '{user_id}': Cleared pending 2FA session data.")
            log.info(
                f"User '{user_id}': Triggering immediate fetch after successful 2FA."
            )
            try:
                app_context = current_app._get_current_object()
                immediate_fetch_thread = threading.Thread(
                    target=run_fetch_for_user_task,
                    args=(app_context, user_id),
                    name=f"ImmediateFetch2FA-{user_id}",
                    daemon=True,
                )
                immediate_fetch_thread.start()
            except Exception as fetch_trigger_err:
                log.error(
                    f"User '{user_id}': Failed to start immediate fetch after 2FA: {fetch_trigger_err}"
                )
            return (
                jsonify(
                    {
                        "message": "2FA verified successfully. Credentials saved.",
                        "status": "success",
                    }
                ),
                200,
            )
        elif final_state == LoginState.REQUIRE_2FA:
            log.warning(f"User '{user_id}': Invalid 2FA code submitted.")
            abort(401, description="Invalid 2FA code.")
        else:
            log.error(
                f"User '{user_id}': Unexpected state {final_state} after submitting 2FA code."
            )
            session.pop("pending_2fa_account_data", None)
            session.pop("pending_2fa_creds", None)
            abort(
                500,
                description="Verification failed due to an unexpected server state.",
            )
    except Exception as e:
        log.exception(
            f"User '{user_id}': Error submitting 2FA code for index {method_index}."
        )
        session.pop("pending_2fa_account_data", None)
        session.pop("pending_2fa_creds", None)
        if "InvalidCredentialsError" in str(e) or "Invalid 2FA code" in str(e):
            abort(401, description="Invalid 2FA code provided.")
        else:
            abort(500, description=f"Server error submitting 2FA code: {e}")



# --- Helper Function (Keep as is) ---
def _restore_pending_2fa_account() -> Optional[AppleAccount]:
    """Restores a pending AppleAccount object from session data."""
    account_data = session.get("pending_2fa_account_data")
    if not account_data or not isinstance(account_data, dict):
        log.error(
            f"User {current_user.id}: No valid pending 2FA account data found in session."
        )
        return None
    anisette_server_url = get_available_anisette_server(
        current_app.config.get("ANISETTE_SERVERS", [])
    )
    if not anisette_server_url:
        log.error(
            f"User {current_user.id}: No Anisette server for restoring 2FA account."
        )
        return None
    try:
        provider = RemoteAnisetteProvider(anisette_server_url)
        account = AppleAccount(provider)
        account.restore(account_data)
        if account.login_state != LoginState.REQUIRE_2FA:
            log.warning(
                f"User {current_user.id}: Restored account is not in REQUIRE_2FA state ({account.login_state}). Invalidating flow."
            )
            session.pop("pending_2fa_account_data", None)
            session.pop("pending_2fa_creds", None)
            return None
        log.debug(f"User {current_user.id}: Successfully restored pending 2FA account.")
        return account
    except Exception as e:
        log.exception(
            f"User {current_user.id}: Error restoring pending 2FA account from session."
        )
        session.pop("pending_2fa_account_data", None)
        session.pop("pending_2fa_creds", None)
        return None
