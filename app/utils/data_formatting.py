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
    all_user_geofences: Dict[str, Dict[str, Any]],  # Pass loaded geofences
    low_battery_threshold: int = 15,  # Pass threshold from config
) -> Dict[str, Any]:
    """
    Formats the latest device report and configuration into a structure suitable for the API response.
    Includes the generated SVG icon.
    """
    config = config or {}  # Ensure config is a dict

    # Extract display info from config with defaults
    display_name = config.get("name", device_id) or device_id
    display_label = config.get("label", "❓") or "❓"
    display_color = config.get("color")
    model_name = config.get("model", "Accessory/Tag") or "Accessory/Tag"
    icon_name = (
        config.get("icon", "tag") or "tag"
    )  # Keep icon name if needed by frontend

    final_color = display_color if display_color else getDefaultColorForId(device_id)

    # --- Generate SVG Icon ---
    try:
        # Call the updated helper function
        device_svg_icon = generate_device_icon_svg(display_label, final_color)
    except Exception as e:
        log.error(f"Failed to generate SVG for device {device_id}: {e}")
        device_svg_icon = None  # Handle error case
    # --- ----------------- ---

    # Resolve linked geofences using the provided all_user_geofences map
    resolved_geofences = []
    linked_geofence_info = config.get("linked_geofences", [])
    if isinstance(linked_geofence_info, list):
        for link_info in linked_geofence_info:
            gf_id = link_info.get("id")
            if gf_id and gf_id in all_user_geofences:
                gf_def = all_user_geofences[gf_id]
                # Combine definition with link-specific notification flags
                resolved_gf = {
                    **gf_def,  # Includes id, name, lat, lng, radius from definition
                    "notify_on_entry": link_info.get("notify_entry", False),
                    "notify_on_exit": link_info.get("notify_exit", False),
                }
                resolved_geofences.append(resolved_gf)
            elif gf_id:
                log.warning(
                    f"User '{user_id}', Device '{device_id}': Linked geofence ID '{gf_id}' not found in loaded definitions."
                )

    # Base structure for the device, including resolved config and SVG
    base_info = {
        "id": device_id,
        "name": display_name,
        "model": model_name,
        "icon": icon_name,  # Frontend might use this name
        "label": display_label,
        "color": final_color,
        "svg_icon": device_svg_icon,  # <-- Include SVG in response
        "geofences": resolved_geofences,  # Include resolved geofences linked to this device
        "reports": [],  # Will be populated later if needed by the caller
    }

    # If no report is available, return base info with unknown status
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
            "rawLocation": None,  # Add rawLocation field even if null
        }

    # Process the report data
    lat, lng = report.get("lat"), report.get("lon")
    battery_level_raw = report.get("battery")
    raw_status_code = report.get("status")
    timestamp_iso = report.get("timestamp")
    horizontal_accuracy = report.get("horizontalAccuracy")

    status_parts = []
    timestamp_str = None
    address_str = "Location Unavailable"  # Default address string
    relative_time_desc = "Unknown Time"  # Default relative time

    # Format timestamp and relative time
    if timestamp_iso:
        try:
            # Handle potential 'Z' for UTC and ensure timezone awareness
            timestamp_dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
            if timestamp_dt.tzinfo is None:
                timestamp_dt = timestamp_dt.replace(tzinfo=timezone.utc)
            else:
                timestamp_dt = timestamp_dt.astimezone(timezone.utc)

            now = datetime.now(timezone.utc)
            delta = now - timestamp_dt
            delta = max(delta, timedelta(seconds=0))  # Ensure delta is not negative

            # Generate relative time description
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

    # Process battery information using helper
    mapped_battery_level, battery_status_str = _parse_battery_info(
        battery_level_raw, raw_status_code, low_battery_threshold
    )

    # Add battery info to status string
    if mapped_battery_level is not None:
        try:
            status_parts.append(
                f"Batt: {mapped_battery_level:.0f}% ({battery_status_str})"
            )
        except (ValueError, TypeError):
            status_parts.append(f"Batt: {battery_status_str}")
    elif battery_status_str != "Unknown":
        status_parts.append(f"Batt: {battery_status_str}")

    # Combine status parts
    final_status = " - ".join(filter(None, status_parts)) or "Status Unknown"

    # Assemble the final dictionary, including the raw report data
    return {
        **base_info,
        "status": final_status,
        "batteryLevel": mapped_battery_level,
        "batteryStatus": battery_status_str,
        "lat": lat,
        "lng": lng,
        "locationTimestamp": timestamp_str,
        "address": address_str,
        "rawLocation": report,  # Include the original report data
    }


def _parse_battery_info(
    battery_level_raw: Any, raw_status_code: Any, low_battery_threshold: int
) -> Tuple[Optional[float], str]:
    """Helper to parse battery level and status from report fields."""
    mapped_battery_level: Optional[float] = None
    battery_status_str: str = "Unknown"

    # Try parsing battery status code first
    if raw_status_code is not None:
        try:
            status_int = int(raw_status_code)
            if status_int == 0:
                mapped_battery_level, battery_status_str = 100.0, "Full"
            elif status_int == 32:
                mapped_battery_level, battery_status_str = 90.0, "High"
            elif status_int == 64:
                mapped_battery_level, battery_status_str = 50.0, "Medium"
            elif status_int == 128:
                mapped_battery_level, battery_status_str = 30.0, "Low"
            elif status_int == 192:
                mapped_battery_level, battery_status_str = 10.0, "Very Low"
        except (ValueError, TypeError):
            log.debug(
                f"Could not parse raw_status_code '{raw_status_code}' as integer."
            )
            pass  # Fall through

    # If status code didn't give a level, check the battery field
    if mapped_battery_level is None:
        if isinstance(battery_level_raw, (int, float)):
            mapped_battery_level = float(battery_level_raw)
            # Status string determined later based on final level
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
                # Handle unknown string values by just displaying them
                battery_status_str = battery_level_raw.capitalize()
                log.debug(f"Unknown string battery level: '{battery_level_raw}'")

    # Final check: Determine status string based on calculated level
    if mapped_battery_level is not None:
        # Override status string based on threshold if level exists
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
