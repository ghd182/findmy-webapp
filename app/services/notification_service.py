# app/services/notification_service.py
# Updated the send_user_notifications method as described above.

import logging
import time
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, Tuple, List, Set
from urllib.parse import quote
import uuid
from pywebpush import webpush, WebPushException
from flask import url_for, current_app

from .user_data_service import UserDataService
from app.utils.helpers import (
    haversine,
    getDefaultColorForId,
)
from app.utils.data_formatting import _parse_battery_info

log = logging.getLogger(__name__)


class NotificationService:
    """Handles notification logic (geofence, battery) and sending web push notifications."""

    def __init__(self, config: Dict[str, Any], user_data_service: UserDataService):
        """
        Initializes the service.

        Args:
            config: The Flask app config dictionary.
            user_data_service: An instance of UserDataService.
        """
        self.config = config
        self.uds = user_data_service
        self.vapid_enabled = config.get("VAPID_ENABLED", False)
        self.vapid_public_key_str = config.get("VAPID_PUBLIC_KEY")
        self.vapid_private_key_str = config.get("VAPID_PRIVATE_KEY")
        self.vapid_claims_email_config = config.get("VAPID_CLAIMS_EMAIL")
        self.low_battery_threshold = config.get("LOW_BATTERY_THRESHOLD", 15)
        self.notification_cooldown = config.get("NOTIFICATION_COOLDOWN_SECONDS", 300)

        # Store paths for generating URLs later
        self.default_icon_path = config.get(
            "DEFAULT_NOTIFICATION_ICON_PATH", "icons/favicon.svg"
        )
        self.welcome_icon_path = config.get(
            "WELCOME_NOTIFICATION_ICON_PATH", self.default_icon_path
        )
        self.test_icon_path = config.get(
            "TEST_NOTIFICATION_ICON_PATH", self.default_icon_path
        )
        # Default Badge Path
        self.default_badge_path = config.get(
            "DEFAULT_NOTIFICATION_BADGE_PATH", "icons/badge-icon.png"
        )
        # Specific Badge Paths
        self.geofence_entry_badge_path = config.get(
            "GEOFENCE_ENTRY_BADGE_PATH", "img/input_circle_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png"
        )
        self.geofence_exit_badge_path = config.get(
            "GEOFENCE_EXIT_BADGE_PATH", "img/output_circle_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png"
        )
        self.battery_low_badge_path = config.get(
            "BATTERY_LOW_BADGE_PATH", "img/battery_alert_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png"
        )
        self.test_badge_path = config.get("TEST_BADGE_PATH", "img/labs_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png")
        self.welcome_badge_path = config.get(
            "WELCOME_BADGE_PATH", "img/celebration_64dp_FFFFFF_FILL0_wght500_GRAD200_opsz48.png"
        )

        if not (self.vapid_private_key_str and self.vapid_claims_email_config):
            if self.vapid_enabled:
                log.warning(
                    "VAPID Private Key or Claims Email missing. Disabling push."
                )
                self.vapid_enabled = False
        elif not self.vapid_enabled:
            log.info("VAPID push notifications explicitly disabled.")
        else:
            log.info("VAPID push notifications configured and enabled.")

    # --- Relative Time Helper (Calculated based on UTC) ---
    def _format_time_relative(self, dt: Optional[datetime]) -> str:
        """Formats a datetime object into a relative string (e.g., '5 min ago')."""
        if not dt or not isinstance(dt, datetime):
            return "Unknown Time"
        # Ensure datetime is UTC before calculating difference
        dt_utc = (
            dt.astimezone(timezone.utc)
            if dt.tzinfo
            else dt.replace(tzinfo=timezone.utc)
        )
        now_utc = datetime.now(timezone.utc)
        delta = now_utc - dt_utc

        if delta < timedelta(seconds=0):
            return "Just now"  # Handle slight future timestamps
        seconds = delta.total_seconds()

        if seconds < 5:
            return "Just now"
        if seconds < 60:
            return f"{int(seconds)} sec ago"
        minutes = seconds / 60
        if minutes < 60:
            return f"{int(minutes)} min ago"
        hours = minutes / 60
        if hours < 24:
            return f"{int(hours)} hr ago"
        days = hours / 24
        if days < 7:
            return f"{int(days)} day{'s' if days >= 2 else ''} ago"
        # If older, return simple date (still formatted from UTC)
        try:
            return dt_utc.strftime("%b %d")  # e.g., "Jan 23"
        except Exception:
            return "Long ago"

    # --- Absolute Time Helper (Formats to Local Timezone) ---
    def _format_absolute_time(self, dt: Optional[datetime]) -> str:
        """Formats a datetime object as dd/mm/yyyy HH:MM in the server's local timezone."""
        if not dt or not isinstance(dt, datetime):
            return "Unknown Time"
        try:
            # Ensure we start with a UTC aware object
            dt_utc = (
                dt.astimezone(timezone.utc)
                if dt.tzinfo
                else dt.replace(tzinfo=timezone.utc)
            )
            # Convert UTC time to the server's local time (using TZ env var)
            dt_local = dt_utc.astimezone()
            # Format as dd/mm/yyyy HH:MM (without timezone suffix)
            return dt_local.strftime("%d/%m/%Y %H:%M")
        except Exception as e:
            log.error(f"Error formatting absolute local time {dt}: {e}")
            # Fallback to UTC format if local conversion fails
            try:
                return dt_utc.strftime("%d/%m/%Y %H:%M UTC")
            except:
                return "Invalid Time"

    # --- Timestamp Parts Helper (Returns UTC datetime object and formatted strings) ---
    def _get_formatted_timestamp_parts(
        self, timestamp_iso: Optional[str]
    ) -> Tuple[Optional[datetime], str, str]:
        """Parses ISO string and returns UTC datetime, local absolute string, and relative string."""
        if not timestamp_iso:
            return None, "Unknown Time", "Unknown Time"
        try:
            # Parse ISO string
            dt_obj = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
            # Ensure it's UTC aware
            dt_utc = (
                dt_obj.astimezone(timezone.utc)
                if dt_obj.tzinfo
                else dt_obj.replace(tzinfo=timezone.utc)
            )

            absolute_str = self._format_absolute_time(
                dt_utc
            )  # Format the UTC object to local time string
            relative_str = self._format_time_relative(
                dt_utc
            )  # Calculate relative from UTC object
            return (
                dt_utc,
                absolute_str,
                relative_str,
            )  # Return UTC datetime obj, local time string, relative string
        except (ValueError, TypeError) as e:
            log.warning(f"Could not parse/format timestamp '{timestamp_iso}': {e}")
            return None, "Invalid Time", "Invalid Time"
        except Exception as e:
            log.error(
                f"Unexpected error getting formatted timestamp parts for '{timestamp_iso}': {e}"
            )
            return None, "Error Time", "Error Time"

    # --- Notification Cooldown ---
    def _can_send_notification(
        self, user_id: str, device_id: str, event_key: str
    ) -> bool:
        if not user_id:
            return False
        try:
            last_notification_times = self.uds.load_notification_times(user_id)
            last_time = last_notification_times.get((device_id, event_key))
            now = time.time()
            if last_time and (now - last_time < self.notification_cooldown):
                remaining = self.notification_cooldown - (now - last_time)
                log.info(
                    f"User '{user_id}': Cooldown active for {device_id}/{event_key}. {remaining:.0f}s remaining."
                )
                return False
            log.debug(
                f"User '{user_id}': Cooldown check passed for {device_id}/{event_key}."
            )
            return True
        except Exception as e:
            log.error(
                f"User '{user_id}': Error checking cooldown for {device_id}/{event_key}: {e}"
            )
            return False  # Fail safe

    def _record_notification_sent(self, user_id: str, device_id: str, event_key: str):
        if not user_id:
            return
        try:
            last_notification_times = self.uds.load_notification_times(user_id)
            now = time.time()
            last_notification_times[(device_id, event_key)] = now
            self.uds.save_notification_times(user_id, last_notification_times)
            log.info(
                f"User '{user_id}': Recorded notification time for {device_id}/{event_key} at {now:.0f}"
            )
        except Exception as e:
            log.error(
                f"User '{user_id}': Error recording notification time for {device_id}/{event_key}: {e}"
            )

    # --- Notification Checks (Geofence & Battery) ---
    def check_device_notifications(
        self,
        user_id: str,
        device_id: str,
        latest_report: Optional[Dict],
        device_config: Dict,
    ):
        if not latest_report:
            log.debug(
                f"User '{user_id}', Device '{device_id}': Skipping notification checks, no latest report."
            )
            return
        try:
            all_user_geofences = self.uds.load_geofences_config(user_id)
            current_geofence_state = self.uds.load_geofence_state(user_id)
            current_battery_state = self.uds.load_battery_state(user_id)
        except Exception as e:
            log.error(
                f"User '{user_id}', Device '{device_id}': Failed to load state/config for checks: {e}"
            )
            return

        geofence_state_changed = False
        try:
            updated_geofence_state, gf_changed = self._check_geofences_for_device(
                user_id,
                device_id,
                latest_report,
                device_config,
                all_user_geofences,
                current_geofence_state,
            )
            if gf_changed:
                geofence_state_changed = True
                current_geofence_state = updated_geofence_state
        except Exception as e:
            log.exception(
                f"User '{user_id}', Device '{device_id}': Error during geofence check: {e}"
            )

        battery_state_changed = False
        try:
            updated_battery_state, bat_changed = self._check_low_battery_for_device(
                user_id, device_id, latest_report, device_config, current_battery_state
            )
            if bat_changed:
                battery_state_changed = True
                current_battery_state = updated_battery_state
        except Exception as e:
            log.exception(
                f"User '{user_id}', Device '{device_id}': Error during battery check: {e}"
            )

        try:  # Save states if changed
            if geofence_state_changed:
                self.uds.save_geofence_state(user_id, current_geofence_state)
            if battery_state_changed:
                self.uds.save_battery_state(user_id, current_battery_state)
        except Exception as e:
            log.error(
                f"User '{user_id}', Device '{device_id}': Failed to save updated state: {e}"
            )

    def _check_geofences_for_device(
        self,
        user_id: str,
        device_id: str,
        latest_report: Dict,
        device_config: Dict,
        all_user_geofences: Dict,
        current_geofence_state: Dict,
    ) -> Tuple[Dict, bool]:
        state_changed = False
        lat = latest_report.get("lat")
        lon = latest_report.get("lon")
        if lat is None or lon is None:
            return current_geofence_state, False
        dt_obj, time_absolute, time_relative = self._get_formatted_timestamp_parts(
            latest_report.get("timestamp")
        )  # Get both formats

        device_name = device_config.get("name", device_id)
        device_label = device_config.get("label", "❓")
        device_color = device_config.get("color", getDefaultColorForId(device_id))
        linked_geofences_info = device_config.get("linked_geofences", [])
        if not linked_geofences_info:
            return current_geofence_state, False

        for link_info in linked_geofences_info:
            gf_id = link_info.get("id")
            if not gf_id or gf_id not in all_user_geofences:
                continue
            gf_def = all_user_geofences[gf_id]
            gf_name = gf_def["name"]
            notify_entry = link_info.get("notify_entry", False)
            notify_exit = link_info.get("notify_exit", False)
            if not notify_entry and not notify_exit:
                continue

            try:
                distance = haversine(lat, lon, gf_def["lat"], gf_def["lng"])
                is_inside = distance <= gf_def["radius"]
                current_status_str = "inside" if is_inside else "outside"
                state_key = (device_id, gf_id)
                previous_status_str = current_geofence_state.get(state_key, "unknown")

                if previous_status_str != current_status_str:
                    log.info(
                        f"User '{user_id}': Geofence State Change: {device_id} @ '{gf_name}' ({gf_id}): {previous_status_str} -> {current_status_str}"
                    )
                    current_geofence_state[state_key] = current_status_str
                    state_changed = True
                    notification_title = None
                    notification_body = None
                    notification_tag = None
                    event_type_key = None
                    notification_data_payload = None
                    should_notify = False
                    notification_specific_type = None
                    base_payload = {
                        "type": "geofence",
                        "deviceId": device_id,
                        "geofenceId": gf_id,
                        "geofenceName": gf_name,
                        "lat": lat,
                        "lng": lon,
                        "timestamp_iso": latest_report.get("timestamp"),
                    }

                    if is_inside and notify_entry:
                        event_type_key = f"geofence_{gf_id}_entry"
                        if self._can_send_notification(
                            user_id, device_id, event_type_key
                        ):
                            notification_title = f"{device_name} Entered {gf_name}"
                            notification_body = f"At {time_absolute} ({time_relative}). Loc: {lat:.4f}, {lon:.4f} ({distance:.0f}m from center)"
                            notification_tag = f"geofence-{device_id}-{gf_id}-entry-{int(time.time() / 60)}"
                            notification_data_payload = {
                                **base_payload,
                                "eventType": "entry",
                            }
                            should_notify = True
                            notification_specific_type = "geofence_entry"
                        else:
                            log.info(
                                f"User '{user_id}': Geofence Entry skipped (cooldown)."
                            )

                    elif not is_inside and notify_exit:
                        event_type_key = f"geofence_{gf_id}_exit"
                        if self._can_send_notification(
                            user_id, device_id, event_type_key
                        ):
                            notification_title = f"{device_name} Exited {gf_name}"
                            notification_body = f"At {time_absolute} ({time_relative}). Loc: {lat:.4f}, {lon:.4f} ({distance:.0f}m from center)"
                            notification_tag = f"geofence-{device_id}-{gf_id}-exit-{int(time.time() / 60)}"
                            notification_data_payload = {
                                **base_payload,
                                "eventType": "exit",
                            }
                            should_notify = True
                            notification_specific_type = "geofence_exit"
                        else:
                            log.info(
                                f"User '{user_id}': Geofence Exit skipped (cooldown)."
                            )

                    if (
                        should_notify
                        and event_type_key
                        and notification_title
                        and notification_specific_type
                    ):
                        log.info(
                            f"User '{user_id}': Triggering geofence notification for {event_type_key} (Type: {notification_specific_type})"
                        )
                        self.send_user_notifications(
                            user_id=user_id,
                            title=notification_title,
                            body=notification_body,
                            tag=notification_tag,
                            data_payload=notification_data_payload,
                            device_label=device_label,
                            device_color=device_color,
                            notification_type=notification_specific_type,
                        )
                        self._record_notification_sent(
                            user_id, device_id, event_type_key
                        )

                elif previous_status_str == "unknown":
                    current_geofence_state[state_key] = current_status_str
                    state_changed = True
            except Exception as e:
                log.exception(
                    f"User '{user_id}': Error checking geofence '{gf_name}' ({gf_id}) for {device_id}: {e}"
                )
        return current_geofence_state, state_changed

    def _check_low_battery_for_device(
        self,
        user_id: str,
        device_id: str,
        latest_report: Dict,
        device_config: Dict,
        current_battery_state: Dict,
    ) -> Tuple[Dict, bool]:
        state_changed = False
        dt_obj, time_absolute, time_relative = self._get_formatted_timestamp_parts(
            latest_report.get("timestamp")
        )
        mapped_battery_level, battery_status_str = _parse_battery_info(
            latest_report.get("battery"),
            latest_report.get("status"),
            self.low_battery_threshold,
        )
        if mapped_battery_level is None:
            return current_battery_state, False
        device_name = device_config.get("name", device_id)
        device_label = device_config.get("label", "❓")
        device_color = device_config.get("color", getDefaultColorForId(device_id))
        event_type_key = "battery_low"
        current_logical_status = (
            "low" if mapped_battery_level < self.low_battery_threshold else "normal"
        )
        previous_logical_status = current_battery_state.get(device_id, "unknown")

        if previous_logical_status != current_logical_status:
            log.info(
                f"User '{user_id}': Battery State Change: {device_id} ('{device_name}'): {previous_logical_status} -> {current_logical_status} (Level: {mapped_battery_level:.0f}%)"
            )
            current_battery_state[device_id] = current_logical_status
            state_changed = True

            if current_logical_status == "low":
                if self._can_send_notification(user_id, device_id, event_type_key):
                    title = f"{device_name} Battery Low"
                    lat = latest_report.get("lat")
                    lon = latest_report.get("lon")
                    loc_info = (
                        f"Last at {time_absolute} ({time_relative}). Loc: {lat:.4f}, {lon:.4f}"
                        if lat and lon
                        else "Last location unknown."
                    )
                    body = f"Battery is low ({mapped_battery_level:.0f}%). {loc_info}"
                    tag = f"battery-{device_id}-low-{int(time.time() / 3600)}"
                    data_payload = {
                        "type": "battery",
                        "deviceId": device_id,
                        "level": mapped_battery_level,
                        "lat": lat,
                        "lng": lon,
                        "timestamp_iso": latest_report.get("timestamp"),
                    }
                    log.info(
                        f"User '{user_id}': Triggering low battery notification for {device_id}"
                    )
                    self.send_user_notifications(
                        user_id=user_id,
                        title=title,
                        body=body,
                        tag=tag,
                        data_payload=data_payload,
                        device_label=device_label,
                        device_color=device_color,
                        notification_type="battery_low",
                    )
                    self._record_notification_sent(user_id, device_id, event_type_key)
                else:
                    log.info(
                        f"User '{user_id}': Low Battery notification for {device_id} skipped (cooldown)."
                    )
            else:
                log.info(
                    f"User '{user_id}': Battery level for {device_id} is now normal ({mapped_battery_level}%)."
                )

        elif previous_logical_status == "unknown":
            current_battery_state[device_id] = current_logical_status
            state_changed = True
            log.debug(
                f"User '{user_id}': Initial battery state recorded for {device_id} as '{current_logical_status}'."
            )

        return current_battery_state, state_changed

    # --- VAPID Claims Helper ---
    def _get_vapid_claims(self, user_id: str) -> Optional[Dict[str, str]]:
        user_email = None
        try:
            user_data = self.uds.load_single_user(user_id)
            if user_data and user_data.get("email"):
                user_email = user_data.get("email").strip()
        except Exception as e:
            log.error(f"Error fetching user data for VAPID email for '{user_id}': {e}")
        if not user_email:
            user_email = self.vapid_claims_email_config
            log.debug(f"Using VAPID_CLAIMS_EMAIL from config: {user_email}")
        if not user_email or not isinstance(user_email, str) or not user_email.strip():
            log.error(
                f"Cannot generate VAPID claims for '{user_id}', no valid 'sub' email found."
            )
            return None
        final_email_claim = (
            user_email if user_email.startswith("mailto:") else f"mailto:{user_email}"
        )
        if final_email_claim == "mailto:":
            log.error(
                f"Cannot generate VAPID claims for '{user_id}', final email claim is empty."
            )
            return None
        claims = {"sub": final_email_claim}
        log.debug(f"Generated VAPID claims for {user_id}: {claims}")
        return claims

    # --- Static URL Helper ---
    def _get_static_url(self, static_path: str) -> str:
        try:
            current_app.config
            return url_for("static", filename=static_path, _external=False)
        except RuntimeError:
            log.debug(
                f"No app context for url_for, generating relative path: /static/{static_path}"
            )
            return f"/static/{static_path}"
        except Exception as e:
            log.error(f"Error generating URL for static path '{static_path}': {e}")
            return f"/static/{static_path}"  # Fallback

    # --- Save History ---
    def _save_notification_to_history(
        self, user_id: str, title: str, body: str, data_payload: Optional[Dict] = None
    ):
        if not user_id:
            return
        try:
            notification_id = str(uuid.uuid4())
            timestamp_iso = datetime.now(timezone.utc).isoformat()
            entry = {
                "id": notification_id,
                "timestamp": timestamp_iso,
                "title": title,
                "body": body,
                "data": data_payload or {},
                "is_read": False,
            }
            self.uds.save_notification_history(user_id, entry)
            log.info(
                f"Saved notification {notification_id} to history for user '{user_id}'."
            )
        except Exception as e:
            log.error(
                f"Failed to save notification to history for user '{user_id}': {e}"
            )

    # --- Web Push Sending ---
    def send_user_notifications(
        self,
        user_id: str,
        title: str,
        body: str,
        tag: Optional[str] = None,
        data_payload: Optional[Dict] = None,
        device_label: Optional[str] = None,
        device_color: Optional[str] = None,
        notification_type: Optional[str] = None,
    ):
        self._save_notification_to_history(user_id, title, body, data_payload)

        if not self.vapid_enabled or not self.vapid_private_key_str:
            log.warning(
                f"User '{user_id}': VAPID disabled/key missing. Skip push: {title}"
            )
            return
        if not user_id:
            log.error("send_user_notifications called without user_id.")
            return
        vapid_claims = self._get_vapid_claims(user_id)
        if not vapid_claims:
            log.error(f"User '{user_id}': Failed VAPID claims.")
            return
        try:
            user_subscriptions = self.uds.load_subscriptions(user_id)
        except Exception as e:
            log.error(f"User '{user_id}': Failed subscription load: {e}")
            return
        if not user_subscriptions:
            log.info(f"User '{user_id}': No push subscriptions.")
            return

        # --- Determine Icon and Badge URLs based on type ---
        icon_url = ""
        badge_url = ""
        log.debug(
            f"Determining icon/badge for notification_type: '{notification_type}'"
        )

        # Determine ICON URL
        if (
            notification_type in ["geofence_entry", "geofence_exit", "battery_low"]
            # --- MODIFICATION START ---
            and device_label  # Only require label, color is optional
            # --- MODIFICATION END ---
        ):
            # Use dynamic device icon IF label is available
            # Get default color if device_color is missing
            final_color = device_color or getDefaultColorForId(
                data_payload.get("deviceId", "unknown") if data_payload else "unknown"
            )
            encoded_label = quote(device_label)
            encoded_color = quote(final_color.lstrip("#"))
            icon_url = f"/api/utils/generate_icon?label={encoded_label}&color=%23{encoded_color}"
            log.debug(f"Using dynamic SVG icon URL: {icon_url}")
        elif notification_type == "welcome":
            icon_url = self._get_static_url(self.welcome_icon_path)
        elif notification_type == "test":
            icon_url = self._get_static_url(self.test_icon_path)
        else:  # Fallback for other types OR if label is missing
            icon_url = self._get_static_url(self.default_icon_path)
            log.debug(f"Using default icon path (fallback): {self.default_icon_path}")

        # Determine BADGE URL using match statement
        match notification_type:
            case "geofence_entry":
                badge_url = self._get_static_url(self.geofence_entry_badge_path)
            case "geofence_exit":
                badge_url = self._get_static_url(self.geofence_exit_badge_path)
            case "battery_low":
                badge_url = self._get_static_url(self.battery_low_badge_path)
            case "test":
                badge_url = self._get_static_url(self.test_badge_path)
            case "welcome":
                badge_url = self._get_static_url(self.welcome_badge_path)
            case _:
                badge_url = self._get_static_url(self.default_badge_path)

        log.debug(
            f"Selected URLs - Type: {notification_type}, Icon: {icon_url}, Badge: {badge_url}"
        )
        # --- ----------------------------- ---

        actions = []
        if (
            notification_type in ["geofence_entry", "geofence_exit", "battery_low"]
            and data_payload
            and data_payload.get("deviceId")
        ):
            actions.append({"action": "view_device", "title": "View Device"})

        data_payload = data_payload or {}
        unique_tag = tag or f"notification-{int(time.time())}"
        payload = {
            "notification": {
                "title": title,
                "body": body,
                "icon": icon_url,
                "badge": badge_url,
                "tag": unique_tag,
                "renotify": False,
                "requireInteraction": False,
                "data": data_payload,
                "actions": actions,
            }
        }
        payload["notification"].update(data_payload.get("notification_options", {}))
        try:
            payload_json = json.dumps(payload)
        except Exception as json_err:
            log.error(f"User '{user_id}': Failed payload serialize: {json_err}.")
            return

        log.info(
            f"User '{user_id}': Sending push (Tag: {unique_tag}, Type: {notification_type or 'general'}) to {len(user_subscriptions)} subscribers."
        )
        failed_endpoints = []
        success_count = 0
        current_subs_items = list(user_subscriptions.items())
        for endpoint, sub_info in current_subs_items:
            try:
                webpush(
                    subscription_info=sub_info,
                    data=payload_json,
                    vapid_private_key=self.vapid_private_key_str,
                    vapid_claims=vapid_claims,
                )
                log.debug(f"User '{user_id}': Sent to {endpoint[:50]}...")
                success_count += 1
            except WebPushException as ex:
                status_code = ex.response.status_code if ex.response else "N/A"
                log.error(
                    f"User '{user_id}': WebPush Error {endpoint[:50]}... Status: {status_code}, Msg: {ex}"
                )
                if ex.response and status_code in [400, 404, 410, 403]:
                    failed_endpoints.append(endpoint)
                elif (
                    "unsubscribe" in str(ex).lower()
                    or "expired" in str(ex).lower()
                    or "InvalidToken" in str(ex)
                    or "push service error" in str(ex).lower()
                    or "invalid registration" in str(ex).lower()
                ):
                    failed_endpoints.append(endpoint)
            except Exception as e:
                log.exception(
                    f"User '{user_id}': Unexpected error sending to {endpoint[:50]}...: {e}"
                )
        log.info(
            f"User '{user_id}': Push complete. Success: {success_count}/{len(current_subs_items)}. Failures removed: {len(failed_endpoints)}."
        )
        if failed_endpoints:
            self._remove_failed_subscriptions(user_id, failed_endpoints)

    def send_single_notification(
        self,
        user_id: str,
        subscription_info: Dict,
        title: str,
        body: str,
        tag: Optional[str] = None,
        data_payload: Optional[Dict] = None,
        notification_type: Optional[str] = None,
    ):
        self._save_notification_to_history(user_id, title, body, data_payload)
        if not self.vapid_enabled or not self.vapid_private_key_str:
            log.warning(
                f"User '{user_id}': VAPID disabled/key missing. Skip single: {title}"
            )
            return
        if not user_id or not subscription_info:
            log.error("send_single_notification missing user_id or sub.")
            return
        vapid_claims = self._get_vapid_claims(user_id)
        if not vapid_claims:
            log.error(f"User '{user_id}': Failed VAPID claims.")
            return

        icon_url = ""
        badge_url = ""
        log.debug(
            f"Determining icon/badge for SINGLE notification_type: '{notification_type}'"
        )
        if notification_type == "welcome":
            icon_url = self._get_static_url(self.welcome_icon_path)
        elif notification_type == "test":
            icon_url = self._get_static_url(self.test_icon_path)
        else:
            icon_url = self._get_static_url(self.default_icon_path)
        match notification_type:
            case "test":
                badge_url = self._get_static_url(self.test_badge_path)
            case "welcome":
                badge_url = self._get_static_url(self.welcome_badge_path)
            case _:
                badge_url = self._get_static_url(self.default_badge_path)
        log.debug(
            f"Selected Single URLs - Type: {notification_type}, Icon: {icon_url}, Badge: {badge_url}"
        )

        unique_tag = tag or f"single-notification-{int(time.time())}"
        data_payload = data_payload or {}
        payload = {
            "notification": {
                "title": title,
                "body": body,
                "icon": icon_url,
                "badge": badge_url,
                "tag": unique_tag,
                "data": data_payload,
            }
        }
        payload["notification"].update(data_payload.get("notification_options", {}))
        endpoint = subscription_info.get("endpoint", "N/A")
        try:
            payload_json = json.dumps(payload)
            webpush(
                subscription_info=subscription_info,
                data=payload_json,
                vapid_private_key=self.vapid_private_key_str,
                vapid_claims=vapid_claims,
            )
            log.info(
                f"User '{user_id}': Sent single '{title}' (Type: {notification_type}) to {endpoint[:50]}..."
            )
        except WebPushException as ex:
            status_code = ex.response.status_code if ex.response else "N/A"
            log.error(
                f"User '{user_id}': WebPush Error single {endpoint[:50]}... Status: {status_code}, Msg: {ex}"
            )
            if ex.response and status_code in [400, 404, 410, 403]:
                self._remove_failed_subscription(user_id, endpoint)
            elif (
                "unsubscribe" in str(ex).lower()
                or "expired" in str(ex).lower()
                or "InvalidToken" in str(ex)
                or "push service error" in str(ex).lower()
                or "invalid registration" in str(ex).lower()
            ):
                log.warning(
                    f"User '{user_id}': Sub {endpoint[:50]}... invalid (text) during single send. Removing."
                )
                self._remove_failed_subscription(user_id, endpoint)
        except Exception as e:
            log.exception(
                f"User '{user_id}': Unexpected error sending single notification: {e}"
            )

    def send_welcome_notification(self, user_id: str, subscription_info: Dict):
        log.info(f"User '{user_id}': Sending welcome notification...")
        self.send_single_notification(
            user_id=user_id,
            subscription_info=subscription_info,
            title="Notifications Enabled",
            body=f"Find My alerts enabled for user '{user_id}'.",
            tag="welcome-notification",
            data_payload={"type": "welcome"},
            notification_type="welcome",
        )

    def _remove_failed_subscriptions(self, user_id: str, endpoints: List[str]):
        if not endpoints:
            return
            log.warning(
                f"User '{user_id}': Removing {len(endpoints)} failed subscriptions."
            )
        try:
            current_subs = self.uds.load_subscriptions(user_id)
            updated_subs = {
                ep: si for ep, si in current_subs.items() if ep not in endpoints
            }
            if len(updated_subs) < len(current_subs):
                self.uds.save_subscriptions(user_id, updated_subs)
                log.info(
                    f"User '{user_id}': Saved after removing {len(current_subs) - len(updated_subs)} subscriptions."
                )
            else:
                log.debug(f"User '{user_id}': No subscriptions needed removal.")
        except Exception as e:
            log.error(f"User '{user_id}': Failed to remove failed subscriptions: {e}")

    def _remove_failed_subscription(self, user_id: str, endpoint: Optional[str]):
        if endpoint:
            self._remove_failed_subscriptions(user_id, [endpoint])

    def is_valid_subscription(self, subscription_data: Any) -> bool:
        return (
            isinstance(subscription_data, dict)
            and isinstance(subscription_data.get("endpoint"), str)
            and subscription_data["endpoint"].startswith("https://")
            and isinstance(subscription_data.get("keys"), dict)
            and isinstance(subscription_data["keys"].get("p256dh"), str)
            and isinstance(subscription_data["keys"].get("auth"), str)
        )

    def cleanup_stale_geofence_states_for_geofence(
        self, user_id: str, geofence_id: str
    ):
        log.info(
            f"User '{user_id}': Cleaning up geofence state for deleted geofence ID '{geofence_id}'."
        )
        try:
            current_gf_state = self.uds.load_geofence_state(user_id)
            keys_to_remove = [
                k
                for k in current_gf_state
                if isinstance(k, tuple) and len(k) == 2 and k[1] == geofence_id
            ]
            if keys_to_remove:
                log.info(
                    f"User '{user_id}': Removing {len(keys_to_remove)} state entries for deleted geofence '{geofence_id}'."
                )
                updated_state = {
                    k: v for k, v in current_gf_state.items() if k not in keys_to_remove
                }
                self.uds.save_geofence_state(user_id, updated_state)
            else:
                log.debug(
                    f"User '{user_id}': No geofence state entries found for deleted geofence '{geofence_id}'."
                )
        except Exception as e:
            log.error(
                f"User '{user_id}': Error cleaning up geofence state for geofence '{geofence_id}': {e}"
            )

    def cleanup_stale_notification_times_for_geofence(
        self, user_id: str, geofence_id: str
    ):
        log.info(
            f"User '{user_id}': Cleaning up notification times for deleted geofence ID '{geofence_id}'."
        )
        try:
            current_notify_times = self.uds.load_notification_times(user_id)
            prefix = f"geofence_{geofence_id}_"
            keys_to_remove = [
                k
                for k in current_notify_times
                if isinstance(k, tuple) and len(k) == 2 and k[1].startswith(prefix)
            ]
            if keys_to_remove:
                log.info(
                    f"User '{user_id}': Removing {len(keys_to_remove)} notification time entries for deleted geofence '{geofence_id}'."
                )
                updated_state = {
                    k: v
                    for k, v in current_notify_times.items()
                    if k not in keys_to_remove
                }
                self.uds.save_notification_times(user_id, updated_state)
            else:
                log.debug(
                    f"User '{user_id}': No notification time entries found for deleted geofence '{geofence_id}'."
                )
        except Exception as e:
            log.error(
                f"User '{user_id}': Error cleaning up notification times for geofence '{geofence_id}': {e}"
            )
