# File: app/utils/migration_utils.py

import os
import json
import logging
import threading
import shutil
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, Set, List
from datetime import datetime, timezone, timedelta
import time
from werkzeug.security import generate_password_hash
import uuid
import base64

# --- REMOVE DB Import from here ---
# from app import db 

# --- Import Models (Keep these here) ---
from app.models import (
    User,
    AppleCredentialState,
    Device,
    Geofence,
    PushSubscription,
    NotificationHistory,
    Share,
    GeofenceDeviceStatus,
    NotificationCooldown,
    device_geofence_link,
)

# --- Import Helpers (Keep these here) ---
from .helpers import (
    encrypt_password,
    decrypt_password,  # Needed for Apple creds
    getDefaultColorForId,
    generate_device_icon_svg,
)
from .json_utils import load_json_file  # Use our safe loader for old files

log = logging.getLogger(__name__)

# --- Configuration (Keep as is) ---
MIGRATION_FLAG_FILENAME = ".migration_v2_db_complete.flag"
OLD_JSON_FILES = [  # Files expected in the main data directory
    "users.json",
    "geofences.json",  # Assuming global geofences were stored like this
    "devices.json",  # Assuming global device config map was stored like this
    "shares.json",
]
OLD_USER_JSON_FILES = [  # Files expected within each user's subdirectory
    "apple_credentials.json",
    "cache.json",  # Keep cache.json, don't delete/rename
    "push_subscriptions.json",
    "notification_history.json",
    "geofence_state.json",
    "battery_state.json",
    "notification_times.json",
]

# --- Helper Functions (Keep as is) ---


def _load_old_json(file_path: Path, description: str) -> Optional[Dict | List]:
    """Safely loads JSON data from an old file path."""
    if not file_path.exists():
        log.debug(f"Migration: Old {description} file not found: {file_path}")
        return None
    if file_path.stat().st_size == 0:
        log.warning(f"Migration: Old {description} file is empty: {file_path}")
        return None
    try:
        with file_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        log.info(f"Migration: Successfully loaded old {description} file: {file_path}")
        return data
    except json.JSONDecodeError as e:
        log.error(
            f"Migration: Failed to parse JSON from old {description} file {file_path}: {e}"
        )
    except (IOError, OSError) as e:
        log.error(f"Migration: Failed to read old {description} file {file_path}: {e}")
    except Exception as e:
        log.exception(
            f"Migration: Unexpected error loading old {description} file {file_path}"
        )
    return None


def _rename_old_file(file_path: Path):
    """Renames an old file to .bak, handling potential errors."""
    if file_path.exists():
        try:
            backup_path = file_path.with_suffix(file_path.suffix + ".bak")
            if backup_path.exists():
                backup_path = file_path.with_suffix(
                    f"{file_path.suffix}.{int(time.time())}.bak"
                )  # Add timestamp if .bak exists
            file_path.rename(backup_path)
            log.info(
                f"Migration: Renamed old file {file_path.name} to {backup_path.name}"
            )
        except OSError as e:
            log.error(f"Migration: Failed to rename old file {file_path}: {e}")


def _parse_old_timestamp(ts_str: Optional[str]) -> Optional[datetime]:
    """Parses potentially naive ISO timestamp string into UTC datetime."""
    if not ts_str:
        return None
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)  # Assume UTC if naive
        else:
            return dt.astimezone(timezone.utc)  # Convert to UTC if aware
    except (ValueError, TypeError):
        log.warning(f"Migration: Could not parse old timestamp: {ts_str}")
        return None


# --- Main Migration Function ---


def run_data_migration(app):
    """
    Checks if migration is needed and performs it if necessary.
    Loads data from old JSON files and populates the new database structure.
    """
    
    from app import db

    

    with app.app_context():
        config = app.config
        data_dir = Path(config["DATA_DIRECTORY"])
        migration_flag_path = data_dir / MIGRATION_FLAG_FILENAME
        old_users_file = data_dir / "users.json"  # Use users.json as the primary check

        if migration_flag_path.exists():
            log.info("Database migration flag found. Skipping data migration.")
            return
        elif not old_users_file.exists():
            log.info(
                "Old users.json not found. Assuming fresh install or migration already done manually. Skipping data migration."
            )
            try:
                migration_flag_path.touch()
            except OSError as e:
                log.error(
                    f"Failed to create migration flag file even though no migration was run: {e}"
                )
            return

        log.warning(
            "!!! Starting one-time data migration from old JSON files to database !!!"
        )
        log.warning(
            "!!! It is STRONGLY recommended to back up your 'data' directory before proceeding. !!!"
        )

        # --- Load Old Global Data ---
        old_users_data = _load_old_json(old_users_file, "users")
        old_geofences_data = (
            _load_old_json(data_dir / "geofences.json", "geofences") or {}
        )
        old_devices_data = _load_old_json(data_dir / "devices.json", "devices") or {}
        old_shares_data = _load_old_json(data_dir / "shares.json", "shares") or {}

        if not old_users_data:
            log.error("Migration ABORTED: Cannot proceed without users.json data.")
            return

        # --- Database Transaction ---
        try:
            migrated_users = 0
            migrated_devices = 0
            migrated_geofences = 0
            migrated_links = 0
            migrated_creds = 0
            migrated_subs = 0
            migrated_history = 0
            migrated_shares = 0
            migrated_gf_states = 0
            migrated_batt_states = 0
            migrated_notify_times = 0

            # 1. Migrate Global Geofences (Keep existing logic - currently skips)
            created_geofence_ids = set()
            if isinstance(old_geofences_data, dict):
                for gf_id, gf_data in old_geofences_data.items():
                    if not isinstance(gf_data, dict):
                        continue
                    log.warning(
                        f"Skipping migration of global geofence '{gf_data.get('name', gf_id)}'. Geofences must now belong to a user."
                    )
                    # (Keep commented out add logic if needed later)

            # 2. Migrate Users and Per-User Data
            for user_id, user_data in old_users_data.items():
                if not isinstance(user_data, dict):
                    continue
                log.info(f"Migrating data for user: {user_id}")
                user_dir = data_dir / user_id
                if not user_dir.is_dir():
                    log.warning(
                        f"Migration: Data directory not found for user {user_id}. Skipping."
                    )
                    continue

                # --- Create User ---
                try:
                    existing_user = db.session.execute(
                        db.select(User).filter_by(username=user_id)
                    ).scalar_one_or_none()
                    if existing_user:
                        log.warning(
                            f"Migration: User '{user_id}' already exists in DB. Skipping user creation."
                        )
                        user = existing_user
                    else:
                        user = User(
                            username=user_id,
                            email=user_data.get("email", f"{user_id}@example.com"),
                            password_hash=user_data.get("password_hash"),
                            theme_mode=user_data.get("theme_mode", "system"),
                            theme_color=user_data.get("theme_color")
                            or getDefaultColorForId(user_id),
                        )
                        if not user.password_hash:
                            log.warning(
                                f"Migration: User '{user_id}' had no password hash in users.json. Setting dummy hash."
                            )
                            user.set_password(f"migrated_dummy_password_{uuid.uuid4()}")
                        db.session.add(user)
                        migrated_users += 1
                except Exception as e:
                    log.error(f"Migration: Error creating user {user_id}: {e}")
                    db.session.rollback()  # Rollback this user's changes if user creation fails
                    continue  # Skip this user

                # --- Migrate Apple Credentials ---
                try:
                    old_creds_file = user_dir / "apple_credentials.json"
                    old_creds_data = _load_old_json(
                        old_creds_file, f"Apple creds for {user_id}"
                    )
                    if isinstance(old_creds_data, dict) and old_creds_data.get(
                        "apple_id"
                    ):
                        raw_password = decrypt_password(
                            old_creds_data.get("apple_password_encrypted", ""), config
                        )
                        if raw_password:
                            new_encrypted_pw = encrypt_password(raw_password, config)
                            account_state_json = None
                            if (
                                isinstance(old_creds_data.get("account_state"), dict)
                                and old_creds_data["account_state"]
                            ):
                                account_state_json = json.dumps(
                                    old_creds_data["account_state"]
                                )

                            cred_state = AppleCredentialState(
                                user_username=user_id,
                                apple_id=old_creds_data["apple_id"],
                                apple_password_encrypted=new_encrypted_pw,
                                account_state_json=account_state_json,
                                last_updated=_parse_old_timestamp(
                                    old_creds_data.get("last_updated")
                                )
                                or datetime.now(timezone.utc),
                            )
                            db.session.merge(cred_state)
                            migrated_creds += 1
                        else:
                            log.warning(
                                f"Migration: Could not decrypt old password for user {user_id}. Skipping credential migration."
                            )
                except Exception as e:
                    log.error(
                        f"Migration: Error migrating Apple credentials for user {user_id}: {e}"
                    )
                    # Don't stop migration for this user, just log the error

                # --- Migrate Devices (Merge with existing logic) ---
                user_devices_config = old_devices_data.get(user_id, {})
                devices_with_pending_links = (
                    {}
                )  # Store devices that might need links added later
                if isinstance(user_devices_config, dict):
                    for device_id, device_config in user_devices_config.items():
                        if not isinstance(device_config, dict):
                            continue
                        try:
                            device = db.session.execute(
                                db.select(Device).filter_by(
                                    id=device_id, user_username=user_id
                                )
                            ).scalar_one_or_none()
                            if not device:
                                log.warning(
                                    f"Migration: Device {device_id} found in devices.json but not in DB/files for user {user_id}. Creating default entry."
                                )
                                device = Device(
                                    id=device_id,
                                    user_username=user_id,
                                    name=device_config.get("name", device_id)
                                    or device_id,
                                    label=device_config.get("label", "❓") or "❓",
                                    color=device_config.get("color")
                                    or getDefaultColorForId(device_id),
                                    model=device_config.get("model", "Accessory/Tag")
                                    or "Accessory/Tag",
                                    icon=device_config.get("icon", "tag") or "tag",
                                )
                                db.session.add(device)
                            else:  # Update existing
                                device.name = (
                                    device_config.get("name", device.name) or device_id
                                )
                                device.label = (
                                    device_config.get("label", device.label) or "❓"
                                )
                                device.color = device_config.get("color", device.color)
                                device.model = (
                                    device_config.get("model", device.model)
                                    or "Accessory/Tag"
                                )
                                device.icon = (
                                    device_config.get("icon", device.icon) or "tag"
                                )
                                db.session.add(device)  # Mark as potentially dirty

                            if "linked_geofences" in device_config:
                                devices_with_pending_links[device_id] = device_config[
                                    "linked_geofences"
                                ]

                            migrated_devices += 1
                        except Exception as e:
                            log.error(
                                f"Migration: Error processing device config for {device_id} (User: {user_id}): {e}"
                            )

                # --- Migrate Push Subscriptions ---
                try:
                    old_subs_file = user_dir / "push_subscriptions.json"
                    old_subs_data = _load_old_json(
                        old_subs_file, f"Push subs for {user_id}"
                    )
                    if isinstance(old_subs_data, dict):
                        for endpoint, sub_info in old_subs_data.items():
                            if isinstance(sub_info, dict) and sub_info.get("keys"):
                                new_sub = PushSubscription(
                                    user_username=user_id, endpoint=endpoint
                                )
                                new_sub.set_subscription_info(sub_info)
                                db.session.merge(new_sub)
                                migrated_subs += 1
                except Exception as e:
                    log.error(
                        f"Migration: Error migrating push subscriptions for user {user_id}: {e}"
                    )

                # --- Migrate Notification History ---
                try:
                    old_hist_file = user_dir / "notification_history.json"
                    old_hist_data = _load_old_json(
                        old_hist_file, f"Notify history for {user_id}"
                    )
                    if isinstance(old_hist_data, list):
                        for entry in old_hist_data:
                            if (
                                not isinstance(entry, dict)
                                or not entry.get("id")
                                or not entry.get("timestamp")
                            ):
                                continue
                            ts = _parse_old_timestamp(entry["timestamp"])
                            if not ts:
                                continue
                            hist_entry = NotificationHistory(
                                id=entry["id"],
                                user_username=user_id,
                                timestamp=ts,
                                title=entry.get("title", "Notification"),
                                body=entry.get("body"),
                                is_read=entry.get("is_read", False),
                            )
                            hist_entry.set_data(entry.get("data", {}))
                            db.session.merge(hist_entry)
                            migrated_history += 1
                except Exception as e:
                    log.error(
                        f"Migration: Error migrating notification history for user {user_id}: {e}"
                    )

                # --- Migrate State Files ---
                try:
                    old_gf_state_file = user_dir / "geofence_state.json"
                    old_gf_state_data = _load_old_json(
                        old_gf_state_file, f"GF state for {user_id}"
                    )
                    if isinstance(old_gf_state_data, dict):
                        for key_str, status in old_gf_state_data.items():
                            try:
                                key_tuple = eval(
                                    key_str
                                )  # Risky, but necessary if format was string tuple
                                if (
                                    isinstance(key_tuple, tuple)
                                    and len(key_tuple) == 2
                                    and isinstance(status, str)
                                ):
                                    dev_id, gf_id = key_tuple
                                    # Skip if geofence wasn't migrated
                                    # if gf_id in created_geofence_ids: # Uncomment if migrating geofences
                                    state_entry = GeofenceDeviceStatus(
                                        device_id=dev_id,
                                        geofence_id=gf_id,
                                        status=status,
                                    )
                                    db.session.merge(state_entry)
                                    migrated_gf_states += 1
                                    # else:
                                    #    log.warning(f"Migration: Skipping GF state for unmigrated geofence {gf_id} (Dev: {dev_id})")
                            except:
                                log.warning(
                                    f"Migration: Skipping invalid geofence state key: {key_str}"
                                )

                    old_batt_state_file = user_dir / "battery_state.json"
                    old_batt_state_data = _load_old_json(
                        old_batt_state_file, f"Batt state for {user_id}"
                    )
                    if isinstance(old_batt_state_data, dict):
                        for dev_id, status in old_batt_state_data.items():
                            if isinstance(status, str):
                                db.session.execute(
                                    db.update(Device)
                                    .filter_by(id=dev_id, user_username=user_id)
                                    .values(last_battery_status=status)
                                )
                                migrated_batt_states += 1

                    old_times_file = user_dir / "notification_times.json"
                    old_times_data = _load_old_json(
                        old_times_file, f"Notify times for {user_id}"
                    )
                    if isinstance(old_times_data, dict):
                        for key_str, timestamp in old_times_data.items():
                            try:
                                key_tuple = eval(key_str)  # Risky
                                if (
                                    isinstance(key_tuple, tuple)
                                    and len(key_tuple) == 2
                                    and isinstance(timestamp, (int, float))
                                ):
                                    dev_id, event_key = key_tuple
                                    time_entry = NotificationCooldown(
                                        device_id=dev_id,
                                        event_key=event_key,
                                        last_sent_timestamp=float(timestamp),
                                    )
                                    db.session.merge(time_entry)
                                    migrated_notify_times += 1
                            except:
                                log.warning(
                                    f"Migration: Skipping invalid notification time key: {key_str}"
                                )
                except Exception as e:
                    log.error(
                        f"Migration: Error migrating state files for user {user_id}: {e}"
                    )

            # --- Flush to ensure users/devices exist before linking ---
            log.info(
                "Migration: Flushing session to prepare for link/share migration..."
            )
            db.session.flush()

            # --- Migrate Global Shares (Assume they were global) ---
            if isinstance(old_shares_data, dict):
                for share_id, share_data in old_shares_data.items():
                    if not isinstance(share_data, dict):
                        continue
                    try:
                        user_id_for_share = share_data.get("user_id")
                        device_id_for_share = share_data.get("device_id")
                        user_exists = db.session.execute(
                            db.select(User.username).filter_by(
                                username=user_id_for_share
                            )
                        ).first()
                        device_exists = db.session.execute(
                            db.select(Device.id).filter_by(
                                id=device_id_for_share, user_username=user_id_for_share
                            )
                        ).first()
                        if user_exists and device_exists:
                            created_at = _parse_old_timestamp(
                                share_data.get("created_at")
                            ) or datetime.now(timezone.utc)
                            expires_at = _parse_old_timestamp(
                                share_data.get("expires_at")
                            )
                            share_entry = Share(
                                id=share_id,
                                user_username=user_id_for_share,
                                device_id=device_id_for_share,
                                created_at=created_at,
                                expires_at=expires_at,
                                active=share_data.get("active", True),
                                note=share_data.get("note"),
                            )
                            db.session.merge(share_entry)
                            migrated_shares += 1
                        else:
                            log.warning(
                                f"Migration: Skipping share {share_id} because user '{user_id_for_share}' or device '{device_id_for_share}' not found in DB."
                            )
                    except Exception as e:
                        log.error(f"Migration: Error migrating share {share_id}: {e}")

            # --- Migrate Device-Geofence Links ---
            log.info("Migration: Processing device-geofence links...")
            all_migrated_devices_with_links = (
                db.session.execute(
                    db.select(Device).filter(
                        Device.username.in_(old_users_data.keys())
                    )  # Filter for users we processed
                )
                .scalars()
                .all()
            )  # Fetch devices that *might* have pending links

            for device in all_migrated_devices_with_links:
                if (
                    hasattr(device, "_migration_linked_geofences")
                    and device._migration_linked_geofences
                ):
                    links_to_create = []
                    for link_info in device._migration_linked_geofences:
                        if not isinstance(link_info, dict):
                            continue
                        gf_id = link_info.get("id")
                        # Skip if geofence wasn't migrated
                        # if gf_id in created_geofence_ids: # Uncomment if migrating geofences
                        log.warning(
                            f"Migration: Skipping link for device {device.id} to geofence {gf_id} as global geofence migration is disabled."
                        )
                        # else:
                        #    log.warning(f"Migration: Skipping link for device {device.id} because geofence {gf_id} was not migrated.")
                    # if links_to_create:
                    #    db.session.execute(db.insert(device_geofence_link), links_to_create)
                    #    migrated_links += len(links_to_create)

            # --- Final Commit ---
            log.info("Migration: Attempting to commit all changes to database...")
            db.session.commit()
            log.info("--- Migration Summary ---")
            log.info(f"  Users: {migrated_users}")
            log.info(f"  Apple Credentials: {migrated_creds}")
            log.info(f"  Device Configs: {migrated_devices}")
            log.info(f"  Geofences: {migrated_geofences}")
            log.info(f"  Device-Geofence Links: {migrated_links}")
            log.info(f"  Push Subscriptions: {migrated_subs}")
            log.info(f"  Notification History: {migrated_history}")
            log.info(f"  Shares: {migrated_shares}")
            log.info(f"  Geofence States: {migrated_gf_states}")
            log.info(f"  Battery States: {migrated_batt_states}")
            log.info(f"  Notification Times: {migrated_notify_times}")
            log.info("--------------------------")

            # --- Post-Migration Actions ---
            for filename in OLD_JSON_FILES:
                _rename_old_file(data_dir / filename)
            for user_id in old_users_data.keys():
                user_dir = data_dir / user_id
                if user_dir.is_dir():
                    for filename in OLD_USER_JSON_FILES:
                        if filename != "cache.json":
                            _rename_old_file(user_dir / filename)
            migration_flag_path.touch()
            log.warning(
                "!!! Data migration successful! Old JSON files renamed to *.bak. !!!"
            )

        except Exception as e:
            db.session.rollback()
            log.exception(
                "!!! Database migration FAILED. Rolling back changes. Error: %s", e
            )
            log.error(
                "!!! Please check the old JSON files and database structure. Manual intervention may be required. !!!"
            )
