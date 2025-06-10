# app/utils/data_formatting.py
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, Tuple

# Import helpers needed
from .helpers import getDefaultColorForId, generate_device_icon_svg  # Correct import

log = logging.getLogger(__name__)


def format_latest_report_for_api(
    user_id: str,
    device_id: str,
    report: Optional[Dict[str, Any]],
    config: Dict[str, Any],
    all_user_geofences: Dict[
        str, Dict[str, Any]
    ],  # Pass loaded geofences (Dict of Dicts)
    low_battery_threshold: int = 15,
) -> Dict[str, Any]:
    """
    Formats the latest device report and configuration into a structure suitable for the API response.
    Includes the generated SVG icon and correctly formats linked geofences with notification flags.
    """
    config = config or {}  # Ensure config is a dict
    log.debug(f"[Formatter - {device_id}] Starting format. Input config: {config}")
    log.debug(f"[Formatter - {device_id}] Input report: {report}")

    # Extract display info from config with defaults
    display_name = config.get("name", device_id) or device_id
    display_label = config.get("label", "❓") or "❓"
    display_color = config.get("color")
    model_name = config.get("model", "Accessory/Tag") or "Accessory/Tag"
    icon_name = config.get("icon", "tag") or "tag"
    final_color = display_color if display_color else getDefaultColorForId(device_id)

    # Generate SVG Icon
    try:
        device_svg_icon = generate_device_icon_svg(display_label, final_color)
    except Exception as e:
        log.error(f"Failed to generate SVG for device {device_id}: {e}")
        device_svg_icon = None

    # --- REVISED Geofence Linking Logic ---
    resolved_geofences = []
    linked_geofence_info = config.get(
        "linked_geofences", []
    )  # This should come correctly from load_devices_config now
    log.debug(
        f"[Formatter - {device_id}] Processing linked_geofences from config: {linked_geofence_info}"
    )

    if isinstance(linked_geofence_info, list):
        for link_data_from_config in linked_geofence_info:
            gf_id = link_data_from_config.get("id")
            log.debug(
                f"[Formatter - {device_id}]  Processing link data: {link_data_from_config}"
            )

            if not gf_id:
                log.warning(
                    f"[Formatter - {device_id}]  Skipping link data with missing ID: {link_data_from_config}"
                )
                continue

            # Get the main geofence definition (already loaded)
            gf_def = all_user_geofences.get(gf_id)
            if not gf_def:
                log.warning(
                    f"[Formatter - {device_id}]  Geofence definition not found for linked ID '{gf_id}'. Skipping link."
                )
                continue

            # *** Explicitly extract flags from the link_data_from_config ***
            notify_entry = link_data_from_config.get("notify_on_entry", False)
            notify_exit = link_data_from_config.get("notify_on_exit", False)
            log.debug(
                f"[Formatter - {device_id}]   Extracted flags for GF '{gf_id}': Entry={notify_entry}, Exit={notify_exit}"
            )

            # *** Build the final dictionary explicitly ***
            resolved_gf = {
                "id": gf_def.get("id"),  # Get ID from definition
                "name": gf_def.get("name"),
                "lat": gf_def.get("lat"),
                "lng": gf_def.get("lng"),
                "radius": gf_def.get("radius"),
                "notify_on_entry": bool(notify_entry),  # Ensure boolean
                "notify_on_exit": bool(notify_exit),  # Ensure boolean
            }
            resolved_geofences.append(resolved_gf)
            log.debug(
                f"[Formatter - {device_id}]   Appended resolved geofence: {resolved_gf}"
            )

    else:
        log.warning(
            f"[Formatter - {device_id}] linked_geofences in config was not a list: {type(linked_geofence_info)}"
        )

    # --- End REVISED Geofence Linking Logic ---

    # Base structure for the device
    base_info = {
        "id": device_id,
        "name": display_name,
        "model": model_name,
        "icon": icon_name,
        "label": display_label,
        "color": final_color,
        "svg_icon": device_svg_icon,
        "geofences": resolved_geofences,  # Use the explicitly built list
        "reports": [],  # Populated by caller if needed
    }

    # If no report, return base info with unknowns
    if not report:
        return {
            **base_info,
            "status": "Location Unknown",
            "batteryLevel": None,
            "batteryStatus": "Unknown",
            "lat": None,
            "lng": None,
            "locationTimestamp": None,
            "address": "Location Unavailable",
            "rawLocation": None,
        }

    # Process report data (keep existing logic)
    lat, lng = report.get("lat"), report.get("lon")
    battery_level_raw = report.get("battery")
    raw_status_code = report.get("status")
    timestamp_iso = report.get("timestamp")
    horizontal_accuracy = report.get("horizontalAccuracy")
    status_parts = []
    timestamp_str = None
    address_str = "Location Unavailable"
    relative_time_desc = "Unknown Time"
    if timestamp_iso:
        try:
            timestamp_dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
            if timestamp_dt.tzinfo is None:
                timestamp_dt = timestamp_dt.replace(tzinfo=timezone.utc)
            else:
                timestamp_dt = timestamp_dt.astimezone(timezone.utc)
            now = datetime.now(timezone.utc)
            delta = max(now - timestamp_dt, timedelta(seconds=0))
            if delta < timedelta(minutes=2):
                relative_time_desc = "Just now"
            elif delta < timedelta(hours=1):
                relative_time_desc = f"{int(delta.total_seconds() / 60)} min ago"
            elif delta < timedelta(days=1):
                relative_time_desc = f"{int(delta.total_seconds() / 3600)} hr ago"
            else:
                relative_time_desc = (
                    f"{delta.days} day{'s' if delta.days > 1 else ''} ago"
                )
            timestamp_str = timestamp_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
            address_str = f"Located {relative_time_desc}"
            status_parts.append(f"Located {relative_time_desc}")
            if horizontal_accuracy is not None:
                try:
                    address_str += f" (±{horizontal_accuracy:.0f}m)"
                except (ValueError, TypeError):
                    log.warning(
                        f"Invalid horizontalAccuracy format '{horizontal_accuracy}' for {device_id}"
                    )
        except Exception as time_err:
            log.warning(
                f"Error formatting report timestamp {timestamp_iso} for {device_id}: {time_err}"
            )
            timestamp_str = "Invalid Timestamp"
            address_str = "Location Available (Time Error)"
            status_parts.append("Location Available (Time Error)")
    else:
        status_parts.append("Location Unknown (No Time)")
    mapped_battery_level, battery_status_str = _parse_battery_info(
        battery_level_raw, raw_status_code, low_battery_threshold
    )
    if mapped_battery_level is not None:
        try:
            status_parts.append(
                f"Batt: {mapped_battery_level:.0f}% ({battery_status_str})"
            )
        except (ValueError, TypeError):
            status_parts.append(f"Batt: {battery_status_str}")
    elif battery_status_str != "Unknown":
        status_parts.append(f"Batt: {battery_status_str}")
    final_status = " - ".join(filter(None, status_parts)) or "Status Unknown"

    # Assemble final dictionary
    final_data = {
        **base_info,
        "status": final_status,
        "batteryLevel": mapped_battery_level,
        "batteryStatus": battery_status_str,
        "lat": lat,
        "lng": lng,
        "locationTimestamp": timestamp_str,
        "address": address_str,
        "rawLocation": report,
    }
    log.debug(
        f"[Formatter - {device_id}] Final formatted data: {final_data}"
    )  # Log final output for this device
    return final_data


def _parse_battery_info(
    battery_level_raw: Any, raw_status_code: Any, low_battery_threshold: int
) -> Tuple[Optional[float], str]:
    """Helper to parse battery level and status from report fields."""
    mapped_battery_level: Optional[float] = None
    battery_status_str: str = "Unknown"

    # Try status code first
    if raw_status_code is not None:
        try:
            status_int = int(raw_status_code)
            if status_int == 0:
                mapped_battery_level, battery_status_str = 100.0, "Full"
            elif status_int == 16:
                mapped_battery_level, battery_status_str = 100.0, "Charged"
            elif status_int == 32:
                mapped_battery_level, battery_status_str = 90.0, "High"
            elif status_int == 64:
                mapped_battery_level, battery_status_str = 50.0, "Medium"
            elif status_int == 96:
                mapped_battery_level, battery_status_str = 10.0, "Critical"
            elif status_int == 128:
                mapped_battery_level, battery_status_str = 30.0, "Low"
            elif status_int == 192:
                mapped_battery_level, battery_status_str = 20.0, "Very Low"
            # Note: Status 96 (0x60) is not explicitly handled here
        except (ValueError, TypeError):
            log.debug(
                f"Could not parse raw_status_code '{raw_status_code}' as integer."
            )

    # If status code didn't give level, check battery field
    if mapped_battery_level is None:
        if isinstance(battery_level_raw, (int, float)):
            mapped_battery_level = float(battery_level_raw)
        elif isinstance(battery_level_raw, str):
            level_lower = battery_level_raw.lower()
            if level_lower == "very low":
                mapped_battery_level, battery_status_str = 10.0, "Very Low"
            elif level_lower == "low":
                mapped_battery_level, battery_status_str = 25.0, "Low"
            elif level_lower == "medium":
                mapped_battery_level, battery_status_str = 50.0, "Medium"
            elif level_lower == "high":
                mapped_battery_level, battery_status_str = 85.0, "High"
            elif level_lower == "full":
                mapped_battery_level, battery_status_str = 100.0, "Full"
            else:
                # If it's a string but not one of the above, capture it as the status string.
                # Don't try to parse it as a percentage unless it's explicitly numeric.
                battery_status_str = battery_level_raw.capitalize()
                log.debug(
                    f"Unknown string battery level: '{battery_level_raw}' captured as status string."
                )
                # mapped_battery_level remains None if it's just a generic string

    # Final check: Determine status string based on level if a numeric level was determined
    if mapped_battery_level is not None:
        if mapped_battery_level < low_battery_threshold:
            battery_status_str = "Very Low"
        elif mapped_battery_level < 30:
            battery_status_str = "Low"
        elif mapped_battery_level < 70:
            battery_status_str = "Medium"
        elif mapped_battery_level < 95:
            battery_status_str = "High"
        else:
            battery_status_str = "Full"
    return mapped_battery_level, battery_status_str
