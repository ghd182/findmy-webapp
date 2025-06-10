# File: app/public_api/routes.py
# Purpose: Defines routes for scanner configuration and reporting (token-authenticated).

import logging
from flask import request, jsonify, current_app, url_for, g, Blueprint
from app.models import User
from app.services.user_data_service import UserDataService
from app.utils.auth_utils import token_required, get_current_api_user


from app import limiter, csrf



from . import bp

log = logging.getLogger(__name__)


# --- Scanner Configuration Endpoint ---
@bp.route("/config", methods=["GET"])
@token_required
@limiter.limit("500 per hour")
def get_scanner_config():
    """
    Provides configuration needed by the native scanner app.
    Authenticated via Bearer token. Accessible via /api/public/scanner/config
    """
    user = get_current_api_user()
    if not user:
        log.error("Token verification passed but no user found in g context!")
        return jsonify({"error": "Authentication context error"}), 500

    user_id = user.username
    log.info(
        f"API GET /api/public/scanner/config requested by user '{user_id}' (via token)"
    )
    uds = UserDataService(current_app.config)
    scan_interval_seconds = current_app.config.get("NATIVE_SCAN_INTERVAL_SECONDS", 300)

    try:
        raw_device_files = uds.get_raw_device_data(user_id)
        config_data = {
            "scan_interval_seconds": scan_interval_seconds,
            "device_files": raw_device_files,
            "report_endpoint": url_for(
                "public_api.report_scanner_status", _external=True
            ),
            "user_id": user_id,
        }
        log.info(
            f"Scanner config provided for user '{user_id}' with {len(raw_device_files)} device files."
        )
        return jsonify(config_data), 200
    except Exception as e:
        log.exception(f"Error generating scanner config for user '{user_id}': {e}")
        return jsonify({"error": "Server error generating scanner configuration."}), 500


# --- Scanner Reporting Endpoint ---
@bp.route("/report", methods=["POST"])
@token_required
@limiter.limit("500 per minute")

@csrf.exempt

def report_scanner_status():
    """
    Receives device status updates from the native scanner app.
    Authenticated via Bearer token. Accessible via /api/public/scanner/report
    """
    user = get_current_api_user()
    if not user:
        log.error("Token verification passed but no user found in g context!")
        return jsonify({"error": "Authentication context error"}), 500

    user_id = user.username
    data = request.get_json()

    if not data or not isinstance(data, dict):
        log.warning(
            f"Scanner Report: Invalid payload received from user '{user_id}'. Body: {request.data[:200]}"
        )
        return jsonify({"error": "Invalid payload format. Expecting JSON object."}), 400

    device_reports = data.get("reports")
    if not device_reports or not isinstance(device_reports, list):
        log.warning(
            f"Scanner Report: Missing or invalid 'reports' array in payload from user '{user_id}'."
        )
        return (
            jsonify({"error": "Invalid payload format. Expecting 'reports' array."}),
            400,
        )

    log.info(
        f"Scanner Report: Received {len(device_reports)} status report(s) from user '{user_id}'"
    )
    uds = UserDataService(current_app.config)
    success_count = 0
    fail_count = 0

    for (
        report_item
    ) in device_reports:  # Renamed 'report' to 'report_item' to avoid conflict
        if not isinstance(report_item, dict):
            log.warning(
                f"Scanner Report: Skipping invalid report item (not a dict) from user '{user_id}'."
            )
            fail_count += 1
            continue

        device_id = report_item.get("device_id")
        timestamp_iso = report_item.get("timestamp")
        battery_status = report_item.get(
            "battery_status"
        )  # This is the string like "Full", "Low"

        if not device_id or not timestamp_iso:
            log.warning(
                f"Scanner Report: Skipping report with missing device_id or timestamp from user '{user_id}'. Report: {report_item}"
            )
            fail_count += 1
            continue

        # Pass the string battery_status directly
        updated = uds.update_device_local_status(
            user_id, device_id, timestamp_iso, battery_status
        )
        if updated:
            success_count += 1
        else:
            fail_count += 1

    log.info(
        f"Scanner Report Processing Complete for user '{user_id}'. Success: {success_count}, Failed/Skipped: {fail_count}"
    )

    if fail_count > 0 and success_count == 0:
        return (
            jsonify(
                {
                    "message": "Processing failed for all reports.",
                    "processed": success_count,
                    "failed": fail_count,
                }
            ),
            400,
        )
    elif fail_count > 0:
        return (
            jsonify(
                {
                    "message": "Processing partially successful.",
                    "processed": success_count,
                    "failed": fail_count,
                }
            ),
            207,
        )
    else:
        return (
            jsonify(
                {
                    "message": "Reports processed successfully.",
                    "processed": success_count,
                }
            ),
            200,
        )
