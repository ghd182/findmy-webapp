# app/main/api.py
import logging
import time
import re
import os
import threading
import traceback
import shutil
import uuid  # Added for share IDs
from pathlib import Path
from werkzeug.utils import secure_filename
import json
from datetime import datetime, timezone, timedelta  # Ensure timedelta is imported
from app.scheduler.tasks import run_fetch_for_user_task
from app.utils.json_utils import save_json_atomic, load_json_file  # Import JSON helpers

from flask import (
    Blueprint,
    jsonify,
    request,
    current_app,
    abort,
    Response,
    send_file,
    session,  # Import session for logout
    url_for,  # Added for generating share URLs
)
from flask_login import login_required, current_user  # Import logout_user

# Import Services
from app.services.user_data_service import UserDataService
from app.services.notification_service import NotificationService
from app.services.apple_data_service import AppleDataService  # Needs AppleDataService

# Import necessary utils
from app.utils.helpers import (
    generate_geofence_id,
    getDefaultColorForId,
    generate_device_icon_svg,
)

from app.utils.data_formatting import (
    format_latest_report_for_api,
    _parse_battery_info,
)

log = logging.getLogger(__name__)

bp = Blueprint("api", __name__)

# --- File Upload API ---
ALLOWED_EXTENSIONS = {"plist", "keys"}
ALLOWED_CONFIG_EXTENSIONS = {"json"}


def allowed_file(filename, allowed_set=ALLOWED_EXTENSIONS):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed_set


@bp.route("/files/upload", methods=["POST"])
@login_required
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

    results = {"success": [], "errors": []}
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
            uds.load_devices_config(user_id)
            log.info(f"User '{user_id}': Devices config reloaded after uploads.")
            if trigger_fetch and not results["errors"]:
                log.info(
                    f"Triggering immediate fetch for user '{user_id}' after file upload."
                )
                try:
                    apple_id, apple_password = uds.load_apple_credentials(user_id)
                    if apple_id and apple_password:
                        immediate_fetch_thread = threading.Thread(
                            target=run_fetch_for_user_task,
                            args=(
                                user_id,
                                apple_id,
                                apple_password,
                                current_app.config,
                            ),
                            name=f"ImmediateFetchUpload-{user_id}",
                            daemon=True,
                        )
                        immediate_fetch_thread.start()
                        results["fetch_triggered"] = True
                    else:
                        log.warning(
                            f"User '{user_id}': Cannot trigger fetch after upload, creds missing."
                        )
                        results["fetch_triggered"] = False
                        results["fetch_error"] = "Credentials missing"
                except ImportError:
                    log.error(
                        "Cannot import run_fetch_for_user_task for immediate trigger."
                    )
                    results["fetch_triggered"] = False
                    results["fetch_error"] = "Server cannot trigger immediate fetch."
                except Exception as fetch_trigger_err:
                    log.error(
                        f"Failed to start immediate fetch for '{user_id}': {fetch_trigger_err}"
                    )
                    log.error(traceback.format_exc())
                    results["fetch_triggered"] = False
                    results["fetch_error"] = str(fetch_trigger_err)
        except Exception as post_upload_err:
            log.error(
                f"Error post-upload config reload for {user_id}: {post_upload_err}"
            )
            results["errors"].append(
                {
                    "filename": "N/A",
                    "error": f"Server error during config reload: {post_upload_err}. Devices might not appear.",
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
        status_code = 200
    if results.get("fetch_triggered") is True:
        response_message += " Background fetch initiated."
    elif results.get("fetch_triggered") is False:
        response_message += f" Background fetch NOT initiated ({results.get('fetch_error', 'unknown reason')})."

    return jsonify({"message": response_message, "details": results}), status_code


# --- Device API ---
@bp.route("/devices", methods=["GET"])
@login_required
def get_devices():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    response_data = {"devices": [], "last_updated": None, "fetch_errors": None, "code": "UNKNOWN"}
    status_code = 200
    try:
        current_user_devices_config = uds.load_devices_config(user_id)
        all_user_geofences = uds.load_geofences_config(user_id)
        user_cache = uds.load_cache_from_file(user_id)
        # --- Use the NEWLY ADDED method ---
        active_shared_device_ids = uds.get_active_shared_device_ids_for_user(user_id)
        # --- --------------------------- ---

        if not user_cache or "data" not in user_cache or not isinstance(user_cache.get("data"), dict):
            error_detail = user_cache.get("error", "Cache is empty or invalid.") if user_cache else "Cache file not found or empty."
            log.warning(f"User '{user_id}' /api/devices: Cache empty/invalid. Error: {error_detail}")
            response_data["error"] = "Device data not available yet. Waiting for next background fetch."
            response_data["code"] = "CACHE_EMPTY"
            response_data["last_updated"] = user_cache.get("timestamp") if user_cache else None
            response_data["fetch_errors"] = error_detail
            for device_id, config_from_file in current_user_devices_config.items():
                formatted_device = format_latest_report_for_api(user_id, device_id, None, config_from_file, all_user_geofences, current_app.config["LOW_BATTERY_THRESHOLD"])
                formatted_device["is_shared"] = device_id in active_shared_device_ids
                formatted_device["reports"] = []
                response_data["devices"].append(formatted_device)
            response_data["devices"].sort(key=lambda d: d.get("name", d.get("id", "")).lower())
            response_data["code"] = "CACHE_EMPTY_CONFIG_RETURNED"
            return jsonify(response_data), 200

        devices_list = []
        device_data_dict_from_cache = user_cache.get("data", {})
        processed_ids_from_cache = set()

        for device_id, device_info_from_cache in device_data_dict_from_cache.items():
            if device_id not in current_user_devices_config:
                continue
            processed_ids_from_cache.add(device_id)
            fresh_config = current_user_devices_config.get(device_id)
            all_reports_for_device = device_info_from_cache.get("reports", [])
            latest_report = all_reports_for_device[0] if all_reports_for_device else None
            formatted_device = format_latest_report_for_api(user_id, device_id, latest_report, fresh_config, all_user_geofences, current_app.config["LOW_BATTERY_THRESHOLD"])
            formatted_device["is_shared"] = device_id in active_shared_device_ids
            formatted_device["reports"] = all_reports_for_device
            devices_list.append(formatted_device)

        for device_id, config_from_file in current_user_devices_config.items():
            if device_id not in processed_ids_from_cache:
                formatted_device = format_latest_report_for_api(user_id, device_id, None, config_from_file, all_user_geofences, current_app.config["LOW_BATTERY_THRESHOLD"])
                formatted_device["is_shared"] = device_id in active_shared_device_ids
                formatted_device["reports"] = []
                devices_list.append(formatted_device)

        devices_list.sort(key=lambda d: d.get("name", d.get("id", "")).lower())
        response_data["devices"] = devices_list
        response_data["last_updated"] = user_cache.get("timestamp")
        response_data["fetch_errors"] = user_cache.get("error")
        response_data["code"] = "OK"
        return jsonify(response_data), status_code

    except Exception as e:
        log.exception(f"Error in GET /api/devices for '{user_id}'")
        return jsonify({"error": "Server Error", "message": "Error fetching devices."}), 500


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
        config_data = uds.load_devices_config(user_id)
        all_user_geofences = uds.load_geofences_config(user_id)
        if device_id not in config_data:
            log.warning(f"User '{user_id}' PUT /devices/{device_id}: Device not found.")
            abort(404, description="Device not found.")
        device_config = config_data[device_id]
        updated_fields_count = 0
        allowed_fields = ["name", "label", "color"]
        if "name" in data:
            new_name = str(data["name"]).strip() if data["name"] else device_id
            if new_name != device_config.get("name"):
                device_config["name"] = new_name
                updated_fields_count += 1
        if "label" in data:
            new_label = str(data["label"]).strip()[:2] if data["label"] else "❓"
            if new_label != device_config.get("label", "❓"):
                device_config["label"] = new_label
                updated_fields_count += 1
        if "color" in data:
            new_color = data["color"]
            if new_color == "":
                new_color = None
            elif isinstance(new_color, str) and not re.match(
                r"^#[0-9a-fA-F]{6}$", new_color
            ):
                abort(400, description="Invalid color format.")
            if new_color != device_config.get("color"):
                device_config["color"] = new_color
                updated_fields_count += 1

        ignored_fields = [k for k in data if k not in allowed_fields]
        if ignored_fields:
            log.warning(
                f"User '{user_id}', Device '{device_id}': PUT ignored fields: {ignored_fields}."
            )

        if updated_fields_count > 0:
            uds.save_devices_config(user_id, config_data)
            log.info(f"User '{user_id}': Saved display config for '{device_id}'.")
            config_data = uds.load_devices_config(user_id)
            device_config = config_data.get(device_id, device_config)
        else:
            log.debug(
                f"User '{user_id}', Device '{device_id}': No display changes detected."
            )

        latest_report_from_cache = None
        user_cache = uds.load_cache_from_file(user_id)
        if user_cache and user_cache.get("data"):
            cached_device_data = user_cache["data"].get(device_id)
            if cached_device_data and cached_device_data.get("reports"):
                latest_report_from_cache = cached_device_data["reports"][0]

        is_shared = uds.is_device_shared(user_id, device_id)
        formatted_device = format_latest_report_for_api(
            user_id,
            device_id,
            latest_report_from_cache,
            device_config,
            all_user_geofences,
            current_app.config["LOW_BATTERY_THRESHOLD"],
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


@bp.route("/devices/<string:device_id>/geofence_links", methods=["PUT"])
@login_required
def update_device_geofence_links(device_id):
    user_id = current_user.id
    log.debug(f"API PUT /devices/{device_id}/geofence_links by '{user_id}'")
    data = request.get_json()
    uds = UserDataService(current_app.config)
    if (
        not data
        or "linked_geofences" not in data
        or not isinstance(data["linked_geofences"], list)
        or not device_id
    ):
        abort(400, description="Invalid payload: 'linked_geofences' array required.")
    try:
        devices_config = uds.load_devices_config(user_id)
        all_user_geofences_map = uds.load_geofences_config(user_id)
        if device_id not in devices_config:
            abort(404, description="Device not found.")
        device_config = devices_config[device_id]
        all_user_geofences_ids = set(all_user_geofences_map.keys())
        validated_new_links = []
        linked_ids_in_payload = set()
        for link_data in data["linked_geofences"]:
            if not isinstance(link_data, dict) or "id" not in link_data:
                raise ValueError("Invalid link structure")
            gf_id = link_data.get("id")
            if (
                not isinstance(gf_id, str)
                or not gf_id
                or gf_id not in all_user_geofences_ids
            ):
                raise ValueError(f"Invalid or unknown geofence ID '{gf_id}'.")
            if gf_id in linked_ids_in_payload:
                log.warning(f"Duplicate geofence ID '{gf_id}' in payload")
                continue
            validated_link = {
                "id": gf_id,
                "notify_entry": bool(link_data.get("notify_entry", False)),
                "notify_exit": bool(link_data.get("notify_exit", False)),
            }
            validated_new_links.append(validated_link)
            linked_ids_in_payload.add(gf_id)
        device_config["linked_geofences"] = validated_new_links
        try:
            uds.save_devices_config(user_id, devices_config)
            log.info(
                f"User '{user_id}': Updated geofence links for '{device_id}'. Links: {validated_new_links}"
            )
        except Exception as e:
            log.exception(
                f"User '{user_id}', Device '{device_id}': Error saving device config after updating links."
            )
            abort(500, description="Failed to save device config.")
        resolved_response_links = []
        for link in validated_new_links:
            gf_definition = all_user_geofences_map.get(link["id"])
            if gf_definition:
                resolved_response_links.append(
                    {
                        **gf_definition,
                        "notify_on_entry": link["notify_entry"],
                        "notify_on_exit": link["notify_exit"],
                    }
                )
        return jsonify({"linked_geofences": resolved_response_links}), 200
    except ValueError as ve:
        abort(400, description=str(ve))
    except IOError as ioe:
        log.error(
            f"IOError processing PUT /devices/{device_id}/geofence_links for '{user_id}': {ioe}"
        )
        abort(500, description="Server error saving config.")
    except Exception as e:
        log.exception(
            f"Error in PUT /api/devices/{device_id}/geofence_links for '{user_id}'"
        )
        abort(500, description="Unexpected error.")


@bp.route("/devices/<string:device_id>", methods=["DELETE"])
@login_required
def delete_device(device_id):
    user_id = current_user.id
    log.warning(f"API DELETE /devices/{device_id} requested by user '{user_id}'")
    uds = UserDataService(current_app.config)
    try:
        success, message = uds.delete_device_and_data(user_id, device_id)
        status_code = 200 if success else 500
        if not success and (
            "Could not access data directory" in message
            or "Path or lock not found" in message
        ):
            status_code = 500
        response_data = {"message": message}
        if not success:
            response_data["error"] = "Deletion failed or completed with errors."
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


# --- Geofence CRUD ---
@bp.route("/geofences", methods=["GET"])
@login_required
def get_all_geofences():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        all_user_geofences = uds.load_geofences_config(user_id)
        geofences_list = sorted(list(all_user_geofences.values()), key=lambda g: g.get("name", "").lower())
        return jsonify(geofences_list or []) # Return [] if no geofences
    except Exception as e:
        log.exception(f"Error loading geofences for '{user_id}'")
        return jsonify({"error": "Server Error", "message": "Failed to load geofences."}), 500

@bp.route("/geofences", methods=["POST"])
@login_required
def create_geofence():
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
        all_user_geofences = uds.load_geofences_config(user_id)
        if any(
            gf["name"].lower() == new_name.lower() for gf in all_user_geofences.values()
        ):
            abort(409, description=f"Geofence name '{new_name}' already exists.")
        new_id = generate_geofence_id()
        new_gf_data_for_save = {
            "name": new_name,
            "lat": new_lat,
            "lng": new_lng,
            "radius": new_radius,
        }
        all_user_geofences[new_id] = {**new_gf_data_for_save, "id": new_id}
        uds.save_geofences_config(user_id, all_user_geofences)
        created_gf_with_id = {**new_gf_data_for_save, "id": new_id}
        log.info(f"User '{user_id}': Created new geofence: {created_gf_with_id}")
        return jsonify(created_gf_with_id), 201
    except ValueError as ve:
        abort(400, description=f"Invalid data: {ve}")
    except Exception as e:
        log.exception(f"User '{user_id}': Error creating geofence")
        return (
            jsonify({"error": "Server Error", "message": "Internal server error."}),
            500,
        )


@bp.route("/geofences/<string:geofence_id>", methods=["PUT"])
@login_required
def update_geofence(geofence_id):
    user_id = current_user.id
    log.debug(f"API PUT /geofences/{geofence_id} by '{user_id}'")
    data = request.get_json()
    uds = UserDataService(current_app.config)
    if not data:
        abort(400, description="Request body empty.")
    try:
        all_user_geofences = uds.load_geofences_config(user_id)
        if geofence_id not in all_user_geofences:
            abort(404, description="Geofence not found.")
        original_gf = all_user_geofences[geofence_id]
        updated_gf_data = original_gf.copy()
        updated_fields_count = 0
        if "name" in data:
            new_name = str(data["name"]).strip()
            if not new_name:
                raise ValueError("Name cannot be empty.")
            if new_name.lower() != original_gf["name"].lower() and any(
                gf["name"].lower() == new_name.lower() and gf_id != geofence_id
                for gf_id, gf in all_user_geofences.items()
            ):
                abort(409, description=f"Geofence name '{new_name}' already exists.")
            if new_name != original_gf.get("name"):
                updated_gf_data["name"] = new_name
                updated_fields_count += 1
        if "lat" in data:
            new_lat = float(data["lat"])
            if not (-90 <= new_lat <= 90):
                raise ValueError("Invalid latitude.")
            if new_lat != original_gf.get("lat"):
                updated_gf_data["lat"] = new_lat
                updated_fields_count += 1
        if "lng" in data:
            new_lng = float(data["lng"])
            if not (-180 <= new_lng <= 180):
                raise ValueError("Invalid longitude.")
            if new_lng != original_gf.get("lng"):
                updated_gf_data["lng"] = new_lng
                updated_fields_count += 1
        if "radius" in data:
            new_radius = float(data["radius"])
            if new_radius <= 0:
                raise ValueError("Radius must be positive.")
            if new_radius != original_gf.get("radius"):
                updated_gf_data["radius"] = new_radius
                updated_fields_count += 1

        if updated_fields_count > 0:
            all_user_geofences[geofence_id] = updated_gf_data
            uds.save_geofences_config(user_id, all_user_geofences)
            log.info(f"User '{user_id}': Updated geofence {geofence_id}")
        else:
            log.debug(
                f"User '{user_id}', Geofence '{geofence_id}': No changes detected."
            )

        # Return the potentially updated geofence data including its ID
        final_gf_data = {**updated_gf_data, "id": geofence_id}
        return jsonify(final_gf_data), 200
    except ValueError as ve:
        abort(400, description=f"Invalid data: {ve}")
    except Exception as e:
        log.exception(f"User '{user_id}': Error updating geofence {geofence_id}")
        return (
            jsonify({"error": "Server Error", "message": "Internal server error."}),
            500,
        )


@bp.route("/geofences/<string:geofence_id>", methods=["DELETE"])
@login_required
def delete_geofence(geofence_id):
    user_id = current_user.id
    log.debug(f"API DELETE /geofences/{geofence_id} by '{user_id}'")
    uds = UserDataService(current_app.config)
    notifier = NotificationService(current_app.config, uds)
    try:
        all_user_geofences = uds.load_geofences_config(user_id)
        if geofence_id not in all_user_geofences:
            abort(404, description="Geofence not found.")
        deleted_name = all_user_geofences[geofence_id].get("name", geofence_id)
        log.info(
            f"User '{user_id}': Deleting geofence '{deleted_name}' ({geofence_id})"
        )
        del all_user_geofences[geofence_id]
        uds.save_geofences_config(user_id, all_user_geofences)
        devices_config = uds.load_devices_config(user_id)
        updated_devices = False
        for device_id, config in devices_config.items():
            original_links = config.get("linked_geofences", [])
            updated_links = [
                link for link in original_links if link.get("id") != geofence_id
            ]
            if len(updated_links) < len(original_links):
                config["linked_geofences"] = updated_links
                updated_devices = True
                log.info(
                    f"User '{user_id}': Unlinked '{geofence_id}' from '{device_id}'."
                )
        if updated_devices:
            uds.save_devices_config(user_id, devices_config)
        notifier.cleanup_stale_geofence_states_for_geofence(user_id, geofence_id)
        notifier.cleanup_stale_notification_times_for_geofence(user_id, geofence_id)
        log.info(
            f"User '{user_id}': Deleted geofence '{deleted_name}' ({geofence_id}) and cleaned up state/links."
        )
        return (
            jsonify({"message": f"Geofence '{deleted_name}' deleted successfully."}),
            200,
        )
    except ValueError as ve:
        abort(400, description=f"Invalid data: {ve}")
    except Exception as e:
        log.exception(f"User '{user_id}': Error deleting geofence {geofence_id}")
        return (
            jsonify({"error": "Server Error", "message": "Internal server error."}),
            500,
        )


# --- Push Subscription API ---
@bp.route("/vapid_public_key", methods=["GET"])
@login_required  # Require login to get the key? Or make public? Let's keep it logged in for now.
def get_vapid_public_key():
    log.debug("API GET /vapid_public_key called.")
    if (
        not current_app.config["VAPID_ENABLED"]
        or not current_app.config["VAPID_PUBLIC_KEY"]
    ):
        log.error("VAPID public key requested but not configured.")
        abort(503, description="Push notifications not configured.")
    return jsonify({"publicKey": current_app.config["VAPID_PUBLIC_KEY"]})


@bp.route("/subscribe", methods=["POST"])
@login_required
def subscribe():
    user_id = current_user.id
    log.debug(f"API POST /subscribe by '{user_id}'")
    uds = UserDataService(current_app.config)
    notifier = NotificationService(current_app.config, uds)
    if not current_app.config["VAPID_ENABLED"]:
        abort(503, description="Push notifications disabled.")
    subscription_data = request.get_json()
    if not notifier.is_valid_subscription(subscription_data):
        abort(400, description="Invalid subscription data.")
    endpoint = subscription_data["endpoint"]
    new_subscription = False
    try:
        user_subscriptions = uds.load_subscriptions(user_id)
        if endpoint not in user_subscriptions:
            log.info(f"User '{user_id}': New push subscription: {endpoint[:50]}...")
            user_subscriptions[endpoint] = subscription_data
            uds.save_subscriptions(user_id, user_subscriptions)
            new_subscription = True
        else:
            log.info(f"User '{user_id}': Subscription exists: {endpoint[:50]}...")
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
                {"error": "Server Error", "message": "Failed to process subscription."}
            ),
            500,
        )


@bp.route("/unsubscribe", methods=["POST"])
@login_required
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


# --- Utils API ---
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


# --- Config Export/Import API ---
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
def config_import_apply():
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
    if "geofences" in parts_to_import:
        geofence_data = parts_to_import["geofences"]
        log.debug(f"User '{user_id}': Found 'geofences' part for import.")
        if isinstance(geofence_data, dict):
            try:
                num_geofences = len(geofence_data)
                log.info(
                    f"User '{user_id}': Attempting to save {num_geofences} imported geofences."
                )
                uds.save_geofences_config(user_id, geofence_data)
                results["success"].append(f"Imported {num_geofences} geofences.")
                config_changed = True
                log.info(f"User '{user_id}': Successfully imported geofences.")
            except Exception as e:
                log.error(
                    f"User '{user_id}': Error importing geofences: {e}", exc_info=True
                )
                results["errors"].append(
                    f"Failed to import geofences: {str(e)[:100]}..."
                )
        else:
            log.warning(
                f"User '{user_id}': Invalid format for geofences data (not dict)."
            )
            results["errors"].append("Invalid format for geofences data.")
    if "devices" in parts_to_import:
        device_data = parts_to_import["devices"]
        log.debug(f"User '{user_id}': Found 'devices' part for import.")
        if isinstance(device_data, dict):
            try:
                num_devices = len(device_data)
                log.info(
                    f"User '{user_id}': Attempting to save {num_devices} imported device configurations."
                )
                uds.save_devices_config(user_id, device_data)
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


# --- Test Notification API ---
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
            notification_specific_type = "geofence"
        elif notification_type == "geofence_exit":
            test_gf_name = "Test Area"
            title = f"{device_name} Exited {test_gf_name} (Test)"
            body = f"This is a test notification for exiting '{test_gf_name}'."
            data_payload["geofenceName"] = test_gf_name
            data_payload["eventType"] = "exit"
            notification_specific_type = "geofence"
        elif notification_type == "battery_low":
            test_level = current_app.config["LOW_BATTERY_THRESHOLD"] - 1
            title = f"{device_name} Battery Low (Test)"
            body = f"Test: Battery is low ({test_level}%)."
            data_payload["level"] = test_level
            notification_specific_type = "battery"
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


# --- Notification History API ---
@bp.route("/notifications/history", methods=["GET"])
@login_required
def get_notification_history():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        history = uds.load_notification_history(user_id)
        return jsonify(history or []) # Ensure list is returned
    except Exception as e:
        log.exception(f"Error getting notification history for user '{user_id}'")
        return jsonify({"error": "Server Error", "message": "Failed to load notification history."}), 500


@bp.route("/notifications/history/<string:notification_id>/read", methods=["PUT"])
@login_required
def mark_notification_read(notification_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    log.info(f"API PUT /notifications/history/{notification_id}/read by '{user_id}'")
    try:
        success = uds.update_notification_read_status(user_id, notification_id, True)
        if success:
            return jsonify({"message": "Notification marked as read."}), 200
        else:
            return (
                jsonify(
                    {
                        "error": "Not Found",
                        "message": "Notification not found or update failed.",
                    }
                ),
                404,
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
        if success:
            return jsonify({"message": "Notification marked as unread."}), 200
        else:
            return (
                jsonify(
                    {
                        "error": "Not Found",
                        "message": "Notification not found or update failed.",
                    }
                ),
                404,
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
        if success:
            return jsonify({"message": "Notification deleted."}), 200
        else:
            # If the specific ID wasn't found, it's still a "successful" deletion from the user's perspective
            log.warning(
                f"Attempted to delete non-existent notification {notification_id} for user {user_id}."
            )
            return (
                jsonify({"message": "Notification not found or already deleted."}),
                200,
            )  # Change to 200 maybe? Or keep 404? Let's try 200.
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
        success = uds.delete_notification_history(
            user_id, None
        )  # Pass None to delete all
        if success:
            return jsonify({"message": "All notification history cleared."}), 200
        else:
            # This case likely means the file didn't exist or was invalid, but the outcome is cleared history
            return (
                jsonify(
                    {
                        "message": "Notification history already clear or file issue occurred."
                    }
                ),
                200,
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


# --- User Preferences API ---
@bp.route("/user/preferences", methods=["GET"])
@login_required
def get_user_preferences():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        prefs = uds.load_user_preferences(user_id)
        return jsonify(prefs) # Should already return {} if not found
    except Exception as e:
        log.exception(f"Error getting preferences for user '{user_id}'")
        return jsonify({"error": "Server Error", "message": "Failed to load user preferences."}), 500


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
        if theme_mode not in ["system", "light", "dark"]:
            raise ValueError("Invalid theme_mode.")
        if not re.match(r"^#[0-9a-fA-F]{6}$", theme_color):
            raise ValueError("Invalid theme_color format.")
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
                {
                    "error": "Conflict",
                    "message": "Server error saving preferences (conflict).",
                }
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


# --- Force Refresh API Endpoint ---
# --- NEW Force Refresh API Endpoint ---
@bp.route("/user/refresh", methods=["POST"])
@login_required
def force_user_refresh():
    user_id = current_user.id
    log.info(f"API POST /user/refresh triggered for user '{user_id}'")
    uds = UserDataService(current_app.config)

    try:
        apple_id, apple_password = uds.load_apple_credentials(user_id)
        if not apple_id or not apple_password:
            log.warning(f"User '{user_id}': Cannot force refresh, credentials missing.")
            return (
                jsonify(
                    {
                        "error": "Credentials Required",
                        "message": "Apple credentials are not set.",
                    }
                ),
                403,
            )

        log.info(f"Spawning immediate fetch task for user '{user_id}' via API request.")
        immediate_fetch_thread = threading.Thread(
            target=run_fetch_for_user_task,
            args=(user_id, apple_id, apple_password, current_app.config),
            name=f"ApiForceFetch-{user_id}",
            daemon=True,
        )
        immediate_fetch_thread.start()

        return jsonify({"message": "Background refresh initiated."}), 202  # Accepted

    except Exception as e:
        log.exception(f"Error initiating force refresh for user '{user_id}'")
        return (
            jsonify(
                {
                    "error": "Server Error",
                    "message": "Failed to initiate background refresh.",
                }
            ),
            500,
        )


# --- Account Deletion API ---
@bp.route("/user/delete", methods=["DELETE"])
@login_required
def delete_account():
    user_id = current_user.id
    log.warning(f"Received DELETE request for account '{user_id}'")
    uds = UserDataService(current_app.config)
    try:
        delete_successful = uds.delete_user_data(user_id)
        if delete_successful:
            log.info(f"Account data deletion successful for '{user_id}'.")
            # --- REMOVED BACKEND LOGOUT ---
            return jsonify({
                "message": f"Account '{user_id}' deletion process initiated successfully.",
                "action": "redirect_to_login" # Hint for frontend
            }), 200
        else:
            log.error(f"Account deletion failed for '{user_id}' during data removal.")
            return jsonify({
                "error": "Account deletion failed.",
                "message": "Failed to remove user data. Check server logs."
            }), 500
    except Exception as e:
        log.exception(f"Unexpected error during account deletion API call for '{user_id}'")
        return jsonify({"error": "Server Error", "message": "An unexpected error occurred."}), 500

# --- Share Management API Endpoints ---
@bp.route("/devices/<string:device_id>/share", methods=["POST"])
@login_required
def create_device_share(device_id):
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    devices_config = uds.load_devices_config(user_id)
    if device_id not in devices_config:
        abort(404, description="Device not found.")
    data = request.get_json() or {}
    duration_str = data.get("duration", "24h")
    note = data.get("note", "")[:100]
    duration_hours = None
    if duration_str == "indefinite": duration_hours = 0
    elif duration_str.endswith("h"):
        try: duration_hours = int(duration_str[:-1])
        except ValueError: abort(400, description="Invalid duration number.")
    elif duration_str.endswith("d"):
        try: duration_hours = int(duration_str[:-1]) * 24
        except ValueError: abort(400, description="Invalid duration number.")
    else: abort(400, description="Invalid duration unit ('h', 'd', 'indefinite').")

    if (duration_hours is not None and (duration_hours < 0 or duration_hours > 30 * 24) and duration_hours != 0):
        abort(400, description="Duration out of range (1h-30d or indefinite).")

    log.info(f"User '{user_id}' request share for '{device_id}' (Duration: {duration_str})")
    try:
        new_share = uds.add_share(user_id, device_id, duration_hours, note)
        if new_share:
            share_url = url_for('public.view_shared_device', share_id=new_share["share_id"], _external=True)
            return jsonify({**new_share, "share_url": share_url}), 201
        else:
             # Assuming add_share returns None on internal failure
             return jsonify({"error": "Server Error", "message": "Failed to create share link."}), 500
    except Exception as e:
        log.exception(f"Error creating share for {device_id}")
        return jsonify({"error": "Server Error", "message": f"Server error: {e}"}), 500
    

@bp.route("/shares", methods=["GET"])
@login_required
def get_my_shares():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    try:
        user_shares = uds.get_user_shares(user_id) # Note: Renamed variable from active_shares
        devices_config = uds.load_devices_config(user_id)
        for share in user_shares:
            device_conf = devices_config.get(share.get("device_id"))
            share["device_name"] = device_conf.get("name", share.get("device_id", "Unknown")) if device_conf else "Unknown Device"
            try: share["share_url"] = url_for('public.view_shared_device', share_id=share["share_id"], _external=True)
            except Exception: share["share_url"] = None
        return jsonify(user_shares or []) # Ensure JSON list return
    except Exception as e:
        log.exception(f"Error fetching shares for user '{user_id}'")
        return jsonify({"error": "Server Error", "message": "Failed to retrieve shares."}), 500


@bp.route("/shares/<string:share_id>/status", methods=["PUT"])
@login_required
def set_share_status(share_id):
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
                devices_config = uds.load_devices_config(user_id)
                device_conf = devices_config.get(updated_share.get("device_id"))
                updated_share["device_name"] = (
                    device_conf.get("name", updated_share.get("device_id", "Unknown"))
                    if device_conf
                    else "Unknown Device"
                )
                try:
                    updated_share["share_url"] = url_for(
                        "public.view_shared_device", share_id=share_id, _external=True
                    )
                except Exception:
                    updated_share["share_url"] = None
                updated_share["share_id"] = share_id
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

    duration_hours = None
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

    if (
        duration_hours is not None
        and (duration_hours < 0 or duration_hours > 30 * 24)
        and duration_hours != 0
    ):
        abort(400, description="Duration out of range.")

    log.info(
        f"User '{user_id}' attempting to update duration for share '{share_id}' to {duration_str}"
    )

    try:
        updated_share = uds.update_share_expiry(share_id, user_id, duration_hours)
        if updated_share:
            if note is not None:
                all_shares = uds.load_shares()
                if (
                    share_id in all_shares
                    and all_shares[share_id].get("user_id") == user_id
                ):
                    all_shares[share_id]["note"] = note
                    uds.save_shares(all_shares)
                    updated_share["note"] = note
                    log.info(
                        f"User '{user_id}' also updated note for share '{share_id}'."
                    )

            devices_config = uds.load_devices_config(user_id)
            device_conf = devices_config.get(updated_share.get("device_id"))
            updated_share["device_name"] = (
                device_conf.get("name", updated_share.get("device_id", "Unknown"))
                if device_conf
                else "Unknown Device"
            )
            try:
                updated_share["share_url"] = url_for(
                    "public.view_shared_device", share_id=share_id, _external=True
                )
            except Exception:
                updated_share["share_url"] = None
            updated_share["share_id"] = share_id

            return jsonify(updated_share), 200
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
                    "message": "Failed to update share duration/note.",
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
