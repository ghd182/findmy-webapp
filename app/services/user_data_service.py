# File: app/services/user_data_service.py

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

from app import db
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

from app.utils.json_utils import (
    load_json_file,
    save_json_atomic,
)
from app.utils.helpers import (
    encrypt_password,
    decrypt_password,
    getDefaultColorForId,
    generate_device_icon_svg,
    DEFAULT_SOURCE_COLOR,
)
from app.utils.migration_utils import _parse_old_timestamp

log = logging.getLogger(__name__)


class UserDataService:
    """
    Handles loading and saving of user-specific data, now primarily via the database.
    """

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.data_dir = Path(config["DATA_DIRECTORY"])
        self.file_locks = {
            k: v
            for k, v in config["FILE_LOCKS"].items()
            if k in [config.get("USER_CACHE_FILENAME")]
        }
        self.data_dir.mkdir(parents=True, exist_ok=True)
        log.debug(
            f"UserDataService (DB Mode) initialized. Data directory: {self.data_dir}"
        )

    def _get_user_data_dir(self, user_id: str) -> Optional[Path]:
        if (
            not user_id
            or not isinstance(user_id, str)
            or "/" in user_id
            or ".." in user_id
            or user_id.startswith(".")
        ):
            log.error(
                f"Attempted to get user directory for invalid user_id: '{user_id}'"
            )
            return None
        user_dir = self.data_dir / user_id
        try:
            user_dir.mkdir(parents=True, exist_ok=True)
            return user_dir
        except OSError as e:
            log.error(f"Failed to create user data directory {user_dir}: {e}")
            return None

    def _get_user_file_path(self, user_id: str, filename: str) -> Optional[Path]:
        user_dir = self._get_user_data_dir(user_id)
        if not user_dir:
            return None
        if (
            "/" in filename
            or ".." in filename
            or filename.startswith(".")
            or not filename
        ):
            log.error(
                f"Attempted to get file path for invalid filename: '{filename}' for user '{user_id}'"
            )
            return None
        return user_dir / filename

    def get_user_by_username(self, username: str) -> Optional[User]:
        log.debug(f"Querying DB for user by username: {username}")
        try:
            user = db.session.execute(
                db.select(User).filter_by(username=username)
            ).scalar_one_or_none()
            return user
        except Exception as e:
            log.error(f"Database error getting user '{username}': {e}")
            return None

    def get_user_by_email(self, email: str) -> Optional[User]:
        log.debug(f"Querying DB for user by email: {email}")
        try:
            user = db.session.execute(
                db.select(User).filter_by(email=email.lower())
            ).scalar_one_or_none()
            return user
        except Exception as e:
            log.error(f"Database error getting user by email '{email}': {e}")
            return None

    def get_all_usernames(self) -> List[str]:
        log.debug("Querying DB for all usernames")
        try:
            usernames = db.session.execute(db.select(User.username)).scalars().all()
            return list(usernames)
        except Exception as e:
            log.error(f"Database error getting all usernames: {e}")
            return []

    def create_user(self, username: str, email: str, password: str) -> Optional[User]:
        log.info(f"Attempting to create user '{username}' ({email}) in DB")
        if not username or not email or not password:
            log.error("Create user failed: Missing username, email, or password.")
            return None
        if self.get_user_by_username(username):
            log.warning(f"Create user failed: Username '{username}' already exists.")
            return None
        if self.get_user_by_email(email):
            log.warning(f"Create user failed: Email '{email}' already exists.")
            return None
        user_dir = self._get_user_data_dir(username)
        if not user_dir:
            log.error(
                f"Create user failed: Could not create data directory for '{username}'."
            )
            return None
        try:
            new_user = User(username=username.strip(), email=email.strip().lower())
            new_user.set_password(password)
            new_user.theme_color = getDefaultColorForId(username)
            db.session.add(new_user)
            db.session.commit()
            log.info(f"Successfully created user '{username}' in database.")
            return new_user
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error creating user '{username}': {e}")
            return None

    def delete_user_data(self, user_id: str) -> bool:
        log.warning(
            f"Initiating deletion for user '{user_id}' from database. This is irreversible."
        )
        user = self.get_user_by_username(user_id)
        if not user:
            log.warning(f"Delete failed: User '{user_id}' not found in database.")
            return False
        try:
            log.info(f"Deleting user object '{user_id}' and cascading deletes...")
            db.session.delete(user)
            db.session.commit()
            log.info(
                f"Successfully deleted user '{user_id}' and associated data from database."
            )
            user_dir = self.data_dir / user_id
            if user_dir.exists() and user_dir.is_dir():
                try:
                    shutil.rmtree(user_dir)
                    log.info(
                        f"Successfully deleted data directory {user_dir} for deleted user '{user_id}'."
                    )
                except OSError as e:
                    log.error(
                        f"Failed to delete directory {user_dir} for deleted user '{user_id}': {e}"
                    )
                except Exception as e:
                    log.exception(
                        f"Unexpected error deleting directory {user_dir} for deleted user '{user_id}'"
                    )
            else:
                log.debug(
                    f"Data directory {user_dir} not found for deleted user '{user_id}'."
                )
            return True
        except Exception as e:
            db.session.rollback()
            log.exception(f"Database error deleting user '{user_id}': {e}")
            return False

    def load_user_preferences(self, user_id: str) -> Dict[str, str]:
        user = self.get_user_by_username(user_id)
        default_prefs = {
            "theme_mode": "system",
            "theme_color": DEFAULT_SOURCE_COLOR,
        }
        if not user:
            log.warning(
                f"Preferences requested for non-existent user '{user_id}'. Returning defaults."
            )
            return default_prefs
        return {
            "theme_mode": user.theme_mode or default_prefs["theme_mode"],
            "theme_color": user.theme_color or default_prefs["theme_color"],
        }

    def save_user_preferences(self, user_id: str, theme_mode: str, theme_color: str):
        user = self.get_user_by_username(user_id)
        if not user:
            log.error(f"Cannot save preferences: User '{user_id}' not found.")
            raise ValueError(f"User '{user_id}' not found.")
        valid_modes = ["system", "light", "dark"]
        if theme_mode not in valid_modes:
            theme_mode = "system"
        if not theme_color or not theme_color.startswith("#") or len(theme_color) != 7:
            theme_color = DEFAULT_SOURCE_COLOR
        try:
            user.theme_mode = theme_mode
            user.theme_color = theme_color
            db.session.commit()
            log.info(
                f"Saved DB preferences for user '{user_id}': Mode={theme_mode}, Color={theme_color}"
            )
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error saving preferences for '{user_id}': {e}")
            raise RuntimeError("Failed to save preferences due to database error.")

    def load_apple_credentials_and_state(
        self, user_id: str
    ) -> Tuple[Optional[str], Optional[str], Optional[Dict]]:
        log.debug(f"Loading Apple creds/state from DB for user '{user_id}'")
        try:
            credential_state = db.session.execute(
                db.select(AppleCredentialState).filter_by(user_username=user_id)
            ).scalar_one_or_none()
            if not credential_state:
                log.debug(
                    f"No Apple credentials/state found in DB for user '{user_id}'."
                )
                return None, None, None
            apple_id = credential_state.apple_id
            encrypted_password = credential_state.apple_password_encrypted
            account_state = credential_state.get_account_state()
            if not apple_id or not encrypted_password:
                log.warning(f"Incomplete Apple credentials in DB for user '{user_id}'.")
                return apple_id or None, None, account_state
            password = decrypt_password(encrypted_password, self.config)
            if not password:
                log.error(f"Password decryption failed for user '{user_id}' from DB.")
                return apple_id, None, account_state
            log.debug(
                f"Loaded Apple credentials and state from DB for user '{user_id}'."
            )
            return apple_id, password, account_state
        except Exception as e:
            log.error(
                f"Database error loading Apple credentials/state for '{user_id}': {e}"
            )
            return None, None, None

    def save_apple_credentials_and_state(
        self,
        user_id: str,
        apple_id: str,
        apple_password: str,
        account_export_data: Dict,
    ):
        log.info(f"Saving Apple creds/state to DB for user '{user_id}'")
        if not user_id or not apple_id or not apple_password or not account_export_data:
            raise ValueError(
                "Missing required arguments for saving Apple credentials and state."
            )
        try:
            user = self.get_user_by_username(user_id)
            if not user:
                raise ValueError(
                    f"Cannot save credentials, user '{user_id}' does not exist."
                )
            credential_state = db.session.execute(
                db.select(AppleCredentialState).filter_by(user_username=user_id)
            ).scalar_one_or_none()
            if not credential_state:
                log.debug(
                    f"Creating new AppleCredentialState record for user '{user_id}'."
                )
                credential_state = AppleCredentialState(user_username=user_id)
                db.session.add(credential_state)
            encrypted_password = encrypt_password(apple_password, self.config)
            if not encrypted_password and apple_password:
                raise ValueError("Password encryption failed.")
            credential_state.apple_id = apple_id
            credential_state.apple_password_encrypted = encrypted_password
            credential_state.set_account_state(account_export_data)
            credential_state.last_updated = datetime.now(timezone.utc)
            db.session.commit()
            log.info(
                f"Successfully saved Apple credentials and state to DB for user '{user_id}'."
            )
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error saving Apple credentials/state for '{user_id}': {e}"
            )
            raise

    def clear_apple_credentials(self, user_id: str):
        log.info(f"Clearing Apple creds/state from DB for user '{user_id}'")
        if not user_id:
            log.error("clear_apple_credentials called without user_id")
            return
        try:
            credential_state = db.session.execute(
                db.select(AppleCredentialState).filter_by(user_username=user_id)
            ).scalar_one_or_none()
            if credential_state:
                db.session.delete(credential_state)
                db.session.commit()
                log.info(
                    f"Removed Apple credentials/state record from DB for user '{user_id}'."
                )
            else:
                log.debug(
                    f"No Apple credentials/state record found in DB to remove for user '{user_id}'."
                )
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error clearing Apple credentials/state for '{user_id}': {e}"
            )

    def user_has_apple_credentials(self, user_id: str) -> bool:
        log.debug(f"Checking DB for Apple creds/state for user '{user_id}'")
        try:
            query = db.select(
                AppleCredentialState.apple_id, AppleCredentialState.account_state_json
            ).filter_by(user_username=user_id)
            result = db.session.execute(query).first()
            if result:
                apple_id, state_json = result
                has_creds = bool(apple_id)
                has_state = (
                    bool(state_json)
                    and state_json.strip() != "{}"
                    and state_json.strip() != "null"
                )
                log.debug(
                    f"DB Cred check for user {user_id}: has_creds={has_creds}, has_state={has_state}"
                )
                return has_creds
            else:
                log.debug(
                    f"No AppleCredentialState record found in DB for user '{user_id}'."
                )
                return False
        except Exception as e:
            log.error(f"Database error checking Apple creds/state for '{user_id}': {e}")
            return False

    def load_devices_config(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """Loads devices configuration for a user, merging file-based devices if needed."""
        log.debug(
            f"[UDS LoadDevCfg] Loading devices config from DB for user '{user_id}'"
        )
        config_data = {}
        try:
            log.debug(f"[UDS LoadDevCfg] Expiring session objects for user '{user_id}'")
            user_devices_to_expire = (
                db.session.execute(db.select(Device).filter_by(user_username=user_id))
                .scalars()
                .all()
            )
            user_geofences_to_expire = (
                db.session.execute(db.select(Geofence).filter_by(user_username=user_id))
                .scalars()
                .all()
            )
            for obj in user_devices_to_expire + user_geofences_to_expire:
                if obj in db.session:
                    db.session.expire(obj)
            log.debug(
                f"Expired {len(user_devices_to_expire)} devices and {len(user_geofences_to_expire)} geofences from session."
            )

            initial_devices_in_db_query = db.select(Device.id).filter_by(
                user_username=user_id
            )
            existing_db_ids_for_merge = set(
                db.session.execute(initial_devices_in_db_query).scalars().all()
            )
            log.debug(
                f"[UDS LoadDevCfg] Found {len(existing_db_ids_for_merge)} existing DB IDs for merge check: {existing_db_ids_for_merge}"
            )

            self._merge_file_devices_to_db(user_id, existing_db_ids_for_merge)

            final_devices_query = db.select(Device).filter_by(user_username=user_id)
            devices_in_db = {
                dev.id: dev for dev in db.session.execute(final_devices_query).scalars()
            }
            log.info(
                f"[UDS LoadDevCfg] Final device count after merge: {len(devices_in_db)} for user '{user_id}'."
            )

            all_user_geofences_map = {
                gf.id: gf
                for gf in db.session.execute(
                    db.select(Geofence).filter_by(user_username=user_id)
                ).scalars()
            }
            log.debug(
                f"[UDS LoadDevCfg] Loaded {len(all_user_geofences_map)} geofence definitions for user '{user_id}'."
            )

            for (
                device_id,
                device_obj,
            ) in devices_in_db.items():
                linked_geofences_data = []
                try:
                    link_details_query = db.select(
                        device_geofence_link.c.geofence_id,
                        device_geofence_link.c.notify_entry,
                        device_geofence_link.c.notify_exit,
                    ).where(device_geofence_link.c.device_id == device_obj.id)
                    link_details_result = db.session.execute(link_details_query).all()

                    for gf_id_from_link, entry_flag, exit_flag in link_details_result:
                        gf_definition = all_user_geofences_map.get(gf_id_from_link)
                        if gf_definition:
                            linked_geofences_data.append(
                                {
                                    "id": gf_id_from_link,
                                    "name": gf_definition.name,
                                    "lat": gf_definition.latitude,
                                    "lng": gf_definition.longitude,
                                    "radius": gf_definition.radius,
                                    "notify_on_entry": bool(entry_flag),
                                    "notify_on_exit": bool(exit_flag),
                                }
                            )
                        else:
                            log.warning(
                                f"[UDS LoadDevCfg] Geofence definition for link GF {gf_id_from_link} (Device {device_obj.id}) not found."
                            )
                except Exception as e:
                    log.error(
                        f"[UDS LoadDevCfg] Error loading linked geofences for device {device_obj.id}: {e}",
                        exc_info=True,
                    )

                linked_geofences_data.sort(key=lambda x: x.get("name", "").lower())
                final_color = device_obj.color or getDefaultColorForId(device_obj.id)
                svg_icon = None
                try:
                    svg_icon = generate_device_icon_svg(
                        device_obj.label or "❓", final_color
                    )
                except Exception as svg_err:
                    log.error(
                        f"[UDS LoadDevCfg] Error generating SVG for device {device_obj.id}: {svg_err}"
                    )

                retrieved_ts_obj = device_obj.last_seen_local
                retrieved_ts_iso = None
                if retrieved_ts_obj:
                    log.debug(
                        f"[UDS LoadDevCfg] Retrieved device.last_seen_local for {device_id}: {retrieved_ts_obj} (TZInfo: {retrieved_ts_obj.tzinfo})"
                    )
                    if retrieved_ts_obj.tzinfo is None:
                        log.warning(
                            f"[UDS LoadDevCfg] Retrieved timestamp for {device_id} is naive! Assuming UTC."
                        )
                        retrieved_ts_utc = retrieved_ts_obj.replace(tzinfo=timezone.utc)
                    else:
                        retrieved_ts_utc = retrieved_ts_obj.astimezone(timezone.utc)
                    retrieved_ts_iso = retrieved_ts_utc.isoformat()
                    log.debug(
                        f"[UDS LoadDevCfg] Formatted last_seen_local for {device_id} as ISO string: {retrieved_ts_iso}"
                    )
                else:
                    log.debug(
                        f"[UDS LoadDevCfg] No last_seen_local found in DB for {device_id}."
                    )

                config_data[device_obj.id] = {
                    "id": device_obj.id,
                    "name": device_obj.name or device_obj.id,
                    "label": device_obj.label or "❓",
                    "color": final_color,
                    "model": device_obj.model or "Accessory/Tag",
                    "icon": device_obj.icon or "tag",
                    "svg_icon": svg_icon,
                    "linked_geofences": linked_geofences_data,
                    "last_battery_status": device_obj.last_battery_status,
                    "last_seen_local": retrieved_ts_iso,
                }
        except Exception as e:
            log.error(
                f"[UDS LoadDevCfg] Database error loading devices config for user '{user_id}': {e}",
                exc_info=True,
            )
            return {}

        log.info(
            f"[UDS LoadDevCfg] Finished loading {len(config_data)} device configs from DB for user '{user_id}'."
        )
        return config_data

    def _merge_file_devices_to_db(self, user_id: str, existing_db_ids: Set[str]):
        log.debug(
            f"Scanning for file-based devices to potentially merge into DB for user '{user_id}'."
        )
        user_data_dir = self._get_user_data_dir(user_id)
        if not user_data_dir:
            return
        config_changed_by_merge = False
        user = self.get_user_by_username(user_id)
        if not user:
            log.error(f"Cannot merge file devices: User '{user_id}' not found.")
            return
        try:
            found_file_ids = set()
            creds_filename = self.config.get(
                "USER_APPLE_CREDS_FILENAME", "apple_credentials.json"
            )
            creds_stem = Path(creds_filename).stem

            for data_file in list(user_data_dir.glob("*.plist")) + list(
                user_data_dir.glob("*.keys")
            ):
                device_id = data_file.stem
                if not device_id or len(device_id) > 128:
                    log.warning(
                        f"Skipping merge for file with invalid derived device ID: {data_file.name}"
                    )
                    continue
                if device_id == creds_stem:
                    continue
                found_file_ids.add(device_id)

            devices_to_add_ids = found_file_ids - existing_db_ids
            if devices_to_add_ids:
                log.warning(
                    f"User '{user_id}': Found device files not in DB: {devices_to_add_ids}. Adding default entries."
                )
                devices_to_bulk_add = []
                for device_id_to_add in devices_to_add_ids:
                    if not db.session.get(Device, device_id_to_add):
                        devices_to_bulk_add.append(
                            Device(
                                id=device_id_to_add,
                                user_username=user_id,
                                name=device_id_to_add,
                                label="❓",
                                color=getDefaultColorForId(device_id_to_add),
                                model="Accessory/Tag",
                                icon="tag",
                            )
                        )
                    else:
                        log.info(
                            f"Device {device_id_to_add} already exists in DB, skipping add in merge operation."
                        )

                if devices_to_bulk_add:
                    db.session.add_all(devices_to_bulk_add)
                    config_changed_by_merge = True

            if config_changed_by_merge:
                db.session.commit()
                log.info(
                    f"User '{user_id}': Committed {len(devices_to_bulk_add)} new devices merged from files to DB."
                )
            else:
                log.debug(
                    f"User '{user_id}': No new devices from files to merge into DB."
                )

        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error during file device merge for user '{user_id}': {e}",
                exc_info=True,
            )

    @staticmethod
    def _load_private_keys_from_keys_file(keys_file_path: Path) -> List[str]:
        private_keys = []
        if not keys_file_path.exists():
            return []
        try:
            with keys_file_path.open("r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split(":", 1)
                    if (
                        len(parts) == 2
                        and parts[0].strip().lower() == "private key"
                    ):
                        key_data = parts[1].strip()
                        try:
                            # Basic validation for plausible base64 key data
                            if len(key_data) > 20 and len(key_data) % 4 == 0: # Check length and padding
                                base64.b64decode(key_data, validate=True) # Validate encoding
                                private_keys.append(key_data)
                            else:
                                log.warning(
                                    f"Skipping potential invalid key data in {keys_file_path.name} (L{line_num}): Length or padding issue."
                                )
                        except Exception as decode_err:
                            log.warning(
                                f"Skipping invalid base64 data in {keys_file_path.name} (L{line_num}): {decode_err}"
                            )
        except Exception as e:
            log.error(f"Error reading keys file {keys_file_path.name}: {e}", exc_info=True)
        return private_keys
    
    def save_devices_config(self, user_id: str, config_data: Dict[str, Dict[str, Any]]):
        log.info(
            f"Saving/Updating {len(config_data)} device configs to DB for user '{user_id}'"
        )
        if not isinstance(config_data, dict):
            raise TypeError("Device config data must be a dictionary.")

        all_user_geofences_ids = set(
            db.session.execute(
                db.select(Geofence.id).filter_by(user_username=user_id)
            ).scalars()
        )
        log.debug(
            f"User '{user_id}': Valid geofence IDs for link validation: {all_user_geofences_ids}"
        )

        processed_device_ids = set()
        try:
            for (
                device_id,
                config_item,
            ) in (
                config_data.items()
            ):  # Renamed 'config' to 'config_item' to avoid confusion
                processed_device_ids.add(device_id)
                log.debug(f"Processing device '{device_id}' for save...")
                if not isinstance(config_item, dict):  # Use 'config_item'
                    log.warning(
                        f"Skipping invalid config for device {device_id} during save."
                    )
                    continue

                device = db.session.execute(
                    db.select(Device).filter_by(id=device_id, user_username=user_id)
                ).scalar_one_or_none()

                if not device:
                    log.warning(
                        f"Device {device_id} not found for user {user_id} during config save. Skipping."
                    )
                    continue
                # Use config_item to get device attributes
                if "name" in config_item:
                    device.name = str(
                        config_item.get("name", device_id) or device_id
                    ).strip()
                if "label" in config_item:
                    device.label = str(config_item.get("label", "❓") or "❓").strip()[
                        :5
                    ]
                if "color" in config_item:
                    device.color = config_item.get("color")
                if "model" in config_item:
                    device.model = str(
                        config_item.get("model", "Accessory/Tag") or "Accessory/Tag"
                    ).strip()
                if "icon" in config_item:
                    device.icon = str(config_item.get("icon", "tag") or "tag").strip()
                if "last_battery_status" in config_item:
                    device.last_battery_status = config_item["last_battery_status"]
                if "last_seen_local" in config_item and config_item["last_seen_local"]:
                    try:
                        ts = datetime.fromisoformat(
                            config_item["last_seen_local"].replace("Z", "+00:00")
                        )
                        device.last_seen_local = (
                            ts.astimezone(timezone.utc)
                            if ts.tzinfo
                            else ts.replace(tzinfo=timezone.utc)
                        )
                    except (ValueError, TypeError) as ts_err:
                        log.warning(
                            f"Could not parse last_seen_local timestamp '{config_item['last_seen_local']}' for device {device_id}. Skipping update. Error: {ts_err}"
                        )

                db.session.add(device)
                log.debug(f"Device '{device_id}' fields marked for update.")

                if "linked_geofences" in config_item:  # Use 'config_item'
                    log.debug(
                        f"Updating links for device {device_id} as 'linked_geofences' is in payload..."
                    )
                    delete_stmt = db.delete(device_geofence_link).where(
                        device_geofence_link.c.device_id == device_id
                    )
                    delete_result = db.session.execute(delete_stmt)
                    log.debug(
                        f"Deleted {delete_result.rowcount} existing link(s) for device {device_id}."
                    )
                    incoming_links_data = config_item.get(
                        "linked_geofences", []
                    )  # Use 'config_item'
                    rows_to_insert = []
                    if isinstance(incoming_links_data, list):
                        for link_info in incoming_links_data:
                            log.debug(
                                f"SAVE_LINKS User:{user_id} Dev:{device_id} | Raw link_info from payload: {link_info}"
                            )  # Log the raw link_info

                            if isinstance(link_info, dict) and "id" in link_info:
                                gf_id = link_info.get("id")
                                if gf_id in all_user_geofences_ids:
                                    # --- CORRECTED KEY ACCESS ---
                                    entry_flag_bool = bool(
                                        link_info.get("notify_entry", False)
                                    )  # Use 'notify_entry'
                                    exit_flag_bool = bool(
                                        link_info.get("notify_exit", False)
                                    )  # Use 'notify_exit'
                                    # --- -------------------- ---

                                    log.debug(
                                        f"SAVE_LINKS User:{user_id} Dev:{device_id} GF:{gf_id} | "
                                        f"link_info_notify_entry: {link_info.get('notify_entry')} (Type: {type(link_info.get('notify_entry'))}), Parsed entry_flag_bool: {entry_flag_bool} | "
                                        f"link_info_notify_exit: {link_info.get('notify_exit')} (Type: {type(link_info.get('notify_exit'))}), Parsed exit_flag_bool: {exit_flag_bool}"
                                    )

                                    rows_to_insert.append(
                                        {
                                            "device_id": device_id,
                                            "geofence_id": gf_id,
                                            "notify_entry": 1 if entry_flag_bool else 0,
                                            "notify_exit": 1 if exit_flag_bool else 0,
                                        }
                                    )
                                else:
                                    log.warning(
                                        f"Skipping link insert for non-existent/invalid geofence '{gf_id}' for device '{device_id}'."
                                    )
                            else:
                                log.warning(
                                    f"Skipping malformed link_info during insert for device {device_id}: {link_info}"
                                )
                        if rows_to_insert:
                            log.debug(
                                f"Inserting {len(rows_to_insert)} new links for device {device_id}: {rows_to_insert}"
                            )
                            db.session.execute(
                                db.insert(device_geofence_link), rows_to_insert
                            )
                        else:
                            log.debug(
                                f"No valid links to insert for device {device_id}."
                            )
                    else:
                        log.warning(
                            f"Invalid format for 'linked_geofences' for device {device_id}. Expected list, got {type(incoming_links_data)}."
                        )
                else:
                    log.debug(
                        f"Skipping link update for device {device_id} as 'linked_geofences' not in payload."
                    )
            db.session.commit()
            log.info(
                f"Committed device config and potentially link updates for user '{user_id}'."
            )
            for verify_device_id in processed_device_ids:
                # Check if linked_geofences was part of the update for this device_id
                if "linked_geofences" in config_data.get(verify_device_id, {}):
                    log.debug(
                        f"Verifying saved links for device '{verify_device_id}' after commit..."
                    )
                    verify_links_query = db.select(
                        device_geofence_link.c.geofence_id,
                        device_geofence_link.c.notify_entry,
                        device_geofence_link.c.notify_exit,
                    ).where(device_geofence_link.c.device_id == verify_device_id)
                    verify_results = db.session.execute(verify_links_query).all()
                    log.debug(
                        f"Verification query results for {verify_device_id}: {verify_results}"
                    )
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error during saving device configs for user '{user_id}': {e}",
                exc_info=True,
            )
            raise

    

    def load_geofences_config(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        log.debug(f"Loading geofences config from DB for user '{user_id}'")
        try:
            geofences = (
                db.session.execute(db.select(Geofence).filter_by(user_username=user_id))
                .scalars()
                .all()
            )
            config_data = {
                gf.id: {
                    "id": gf.id,
                    "name": gf.name,
                    "lat": gf.latitude,
                    "lng": gf.longitude,
                    "radius": gf.radius,
                }
                for gf in geofences
            }
            log.info(
                f"Loaded {len(config_data)} geofences from DB for user '{user_id}'"
            )
            return config_data
        except Exception as e:
            log.error(
                f"Database error loading geofences config for '{user_id}': {e}",
                exc_info=True,
            )
            return {}

    def save_geofences_config(
        self, user_id: str, config_data: Dict[str, Dict[str, Any]]
    ):
        log.info(
            f"Saving {len(config_data)} geofence configs to DB for user '{user_id}'"
        )
        if not isinstance(config_data, dict):
            raise TypeError("Geofence config data must be a dictionary.")
        existing_geofences = {
            gf.id: gf
            for gf in db.session.execute(
                db.select(Geofence).filter_by(user_username=user_id)
            ).scalars()
        }
        try:
            processed_ids = set()
            for (
                gf_id,
                config_item,
            ) in config_data.items():  # Renamed 'config' to 'config_item'
                if not isinstance(config_item, dict):  # Use 'config_item'
                    continue
                processed_ids.add(gf_id)
                try:
                    name = str(config_item["name"]).strip()  # Use 'config_item'
                    lat = float(config_item["lat"])  # Use 'config_item'
                    lng = float(config_item["lng"])  # Use 'config_item'
                    radius = float(config_item["radius"])  # Use 'config_item'
                    if (
                        not name
                        or radius <= 0
                        or not (-90 <= lat <= 90)
                        or not (-180 <= lng <= 180)
                    ):
                        raise ValueError("Invalid geofence data.")
                    geofence_obj = existing_geofences.get(gf_id)
                    if geofence_obj:
                        geofence_obj.name = name
                        geofence_obj.latitude = lat
                        geofence_obj.longitude = lng
                        geofence_obj.radius = radius
                    else:
                        user = self.get_user_by_username(user_id)
                        if not user:
                            raise ValueError(
                                f"User '{user_id}' not found for creating geofence."
                            )
                        new_geofence = Geofence(
                            id=gf_id,
                            user_username=user_id,
                            name=name,
                            latitude=lat,
                            longitude=lng,
                            radius=radius,
                        )
                        db.session.add(new_geofence)
                        log.debug(f"Adding new geofence {gf_id} for user '{user_id}'.")
                except (KeyError, ValueError, TypeError) as ve:
                    log.warning(
                        f"Skipping invalid geofence data during save: ID {gf_id}, Data {config_item}, Error: {ve}"
                    )
            ids_to_delete = set(existing_geofences.keys()) - processed_ids
            if ids_to_delete:
                self._handle_geofence_deletion_dependencies(user_id, ids_to_delete)
                db.session.execute(
                    db.delete(Geofence).filter(
                        Geofence.user_username == user_id,
                        Geofence.id.in_(ids_to_delete),
                    )
                )
                log.info(f"Deleting geofences for user '{user_id}': {ids_to_delete}")
            db.session.commit()
            log.info(
                f"Successfully saved/updated geofence config to DB for user '{user_id}'."
            )
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error saving geofence config for user '{user_id}': {e}"
            )
            raise

    def _handle_geofence_deletion_dependencies(
        self, user_id: str, geofence_ids_to_delete: Set[str]
    ):
        if not geofence_ids_to_delete:
            return
        log.info(
            f"Cleaning dependencies for deleting geofences: {geofence_ids_to_delete}"
        )
        try:
            user_device_ids_subquery = db.select(Device.id).filter_by(
                user_username=user_id
            )
            stmt_link = db.delete(device_geofence_link).where(
                device_geofence_link.c.geofence_id.in_(geofence_ids_to_delete),
                device_geofence_link.c.device_id.in_(user_device_ids_subquery),
            )
            deleted_links = db.session.execute(stmt_link).rowcount
            log.debug(f"Deleted {deleted_links} entries from device_geofence_link.")
            stmt_status = db.delete(GeofenceDeviceStatus).where(
                GeofenceDeviceStatus.geofence_id.in_(geofence_ids_to_delete),
                GeofenceDeviceStatus.device_id.in_(user_device_ids_subquery),
            )
            deleted_status = db.session.execute(stmt_status).rowcount
            log.debug(f"Deleted {deleted_status} entries from geofence_device_status.")
            cooldowns_deleted_count = 0
            for gf_id in geofence_ids_to_delete:
                event_key_entry = f"geofence_{gf_id}_entry"
                event_key_exit = f"geofence_{gf_id}_exit"
                stmt_cd = db.delete(NotificationCooldown).where(
                    NotificationCooldown.device_id.in_(user_device_ids_subquery),
                    (NotificationCooldown.event_key == event_key_entry)
                    | (NotificationCooldown.event_key == event_key_exit),
                )
                result = db.session.execute(stmt_cd)
                cooldowns_deleted_count += result.rowcount
            log.debug(
                f"Deleted {cooldowns_deleted_count} related entries from notification_cooldown."
            )
        except Exception as e:
            log.error(f"Error cleaning geofence dependencies for user {user_id}: {e}")
            raise

    def delete_device_and_data(self, user_id: str, device_id: str) -> Tuple[bool, str]:
        log.warning(
            f"Attempting to delete device '{device_id}' from DB for user '{user_id}'."
        )
        try:
            device = db.session.execute(
                db.select(Device).filter_by(id=device_id, user_username=user_id)
            ).scalar_one_or_none()

            if not device:
                log.warning(
                    f"Delete failed: Device {device_id} not found for user '{user_id}'. Checking for files..."
                )
                deleted_filename = self._delete_device_files(user_id, device_id)
                return (
                    False,
                    f"Device '{device_id}' not found in database ({'file deleted' if deleted_filename else 'no file found'}).",
                )

            log.info(f"Deleting device object {device_id} from DB and cascading...")
            db.session.delete(device)
            db.session.commit()
            log.info(f"Successfully deleted device {device_id} from DB.")
            deleted_filename = self._delete_device_files(user_id, device_id)
            msg = f"Successfully deleted device '{device_id}' ({deleted_filename or 'No File Found'}) and associated database records."
            log.info(f"User '{user_id}': {msg}")
            return True, msg
        except Exception as e:
            db.session.rollback()
            log.exception(
                f"Error deleting device {device_id} for user '{user_id}': {e}"
            )
            return False, f"Database error during device deletion: {e}"

    def _delete_device_files(self, user_id: str, device_id: str) -> Optional[str]:
        user_data_dir = self._get_user_data_dir(user_id)
        if not user_data_dir:
            log.warning(
                f"Cannot delete device files for {device_id}, user dir not found for {user_id}"
            )
            return None
        deleted_filename = None
        plist_path = user_data_dir / f"{device_id}.plist"
        keys_path = user_data_dir / f"{device_id}.keys"
        for file_path in [plist_path, keys_path]:
            if file_path.exists():
                try:
                    current_filename = file_path.name
                    os.remove(file_path)
                    deleted_filename = current_filename
                    log.info(
                        f"User '{user_id}': Deleted source file {deleted_filename}."
                    )
                except OSError as e:
                    log.error(
                        f"User '{user_id}': Failed to delete source file {file_path.name}: {e}"
                    )
                except Exception as e:
                    log.exception(f"Unexpected error deleting {file_path.name}")
        return deleted_filename

    def get_raw_device_data(self, user_id: str) -> List[Dict[str, str]]:
        log.debug(f"Loading raw device data files for user '{user_id}'")
        raw_data_list = []
        user_data_dir = self._get_user_data_dir(user_id)
        if not user_data_dir:
            log.error(
                f"Cannot get user data dir for raw device data retrieval: {user_id}"
            )
            return []
        try:
            creds_filename = self.config.get(
                "USER_APPLE_CREDS_FILENAME", "apple_credentials.json"
            )
            creds_stem = Path(creds_filename).stem
            for data_file in list(user_data_dir.glob("*.plist")) + list(
                user_data_dir.glob("*.keys")
            ):
                device_id = data_file.stem
                file_type = data_file.suffix.lower().strip(".")
                if device_id == creds_stem:
                    continue
                if not device_id or len(device_id) > 128:
                    log.warning(
                        f"Skipping raw data load for file with invalid derived device ID: {data_file.name}"
                    )
                    continue
                try:
                    with data_file.open("rb") as f:
                        content_bytes = f.read()
                        content_b64 = base64.b64encode(content_bytes).decode("utf-8")
                        raw_data_list.append(
                            {
                                "device_id": device_id,
                                "type": file_type,
                                "content_b64": content_b64,
                            }
                        )
                        log.debug(
                            f"Read and encoded {file_type} file for device {device_id}"
                        )
                except Exception as e:
                    log.error(
                        f"Error reading or encoding file {data_file.name} for user '{user_id}': {e}"
                    )
            log.info(
                f"Retrieved raw data for {len(raw_data_list)} devices for user '{user_id}'"
            )
            return raw_data_list
        except Exception as e:
            log.error(
                f"Error listing or processing device files for user '{user_id}': {e}"
            )
            return []

    def update_device_local_status(
        self,
        user_id: str,
        device_id: str,
        timestamp_iso: str,
        battery_status: Optional[str] = None,
    ) -> bool:
        log.info(
            f"[UDS UpdateLocal] User:{user_id}, Device:{device_id}. Received Time: {timestamp_iso}, Batt: {battery_status}"
        )
        try:
            last_seen_dt_parsed = datetime.fromisoformat(
                timestamp_iso.replace("Z", "+00:00")
            )
            log.debug(
                f"[UDS UpdateLocal] Parsed timestamp: {last_seen_dt_parsed}, TZInfo: {last_seen_dt_parsed.tzinfo}"
            )
            if last_seen_dt_parsed.tzinfo is None:
                log.warning(
                    f"[UDS UpdateLocal] Parsed timestamp was naive, assuming UTC for {device_id}."
                )
                last_seen_dt_utc = last_seen_dt_parsed.replace(tzinfo=timezone.utc)
            else:
                last_seen_dt_utc = last_seen_dt_parsed.astimezone(timezone.utc)
                if last_seen_dt_utc != last_seen_dt_parsed:
                    log.debug(
                        f"[UDS UpdateLocal] Converted parsed timestamp to UTC: {last_seen_dt_utc}"
                    )
        except (ValueError, TypeError) as e:
            log.error(
                f"[UDS UpdateLocal] Invalid timestamp format received for local status update: '{timestamp_iso}'. Error: {e}"
            )
            return False
        try:
            device = db.session.execute(
                db.select(Device).filter_by(id=device_id, user_username=user_id)
            ).scalar_one_or_none()
            if not device:
                log.warning(
                    f"[UDS UpdateLocal] Device {device_id} not found for user {user_id} during local status update. Ignoring."
                )
                return False
            device.last_seen_local = last_seen_dt_utc
            log.debug(
                f"[UDS UpdateLocal] Setting device.last_seen_local = {device.last_seen_local} (TZInfo: {device.last_seen_local.tzinfo})"
            )
            valid_statuses = [
                "Very Low",
                "Low",
                "Medium",
                "High",
                "Full",
                "Unknown",
                None,
            ]
            if battery_status is not None and battery_status in valid_statuses:
                device.last_battery_status = battery_status
                log.debug(
                    f"[UDS UpdateLocal] Updating battery status for {device_id} to {battery_status}"
                )
            elif battery_status is not None:
                log.warning(
                    f"[UDS UpdateLocal] Ignoring invalid battery status '{battery_status}' received for {device_id}"
                )
            db.session.commit()
            log.info(
                f"[UDS UpdateLocal] Successfully updated DB for device {device_id} to {last_seen_dt_utc.isoformat()}"
            )
            return True
        except Exception as e:
            db.session.rollback()
            log.error(
                f"[UDS UpdateLocal] Database error updating local status for device {device_id} (User: {user_id}): {e}",
                exc_info=True,
            )
            return False

    def load_cache_from_file(self, user_id: str) -> Optional[Dict[str, Any]]:
        cache_filename = self.config.get("USER_CACHE_FILENAME")
        if not cache_filename:
            log.error("USER_CACHE_FILENAME not found in config.")
            return None
        cache_file = self._get_user_file_path(user_id, cache_filename)
        if not cache_file:
            log.error(f"Could not determine cache file path for user '{user_id}'.")
            return None
        lock = self.file_locks.get(cache_filename)
        if not lock:
            log.error(
                f"Lock for cache file '{cache_filename}' not found for user '{user_id}'."
            )
            return None
        cache_data = load_json_file(cache_file, lock)
        if cache_data is None:
            log.debug(f"Cache file {cache_file} not found or invalid, returning None.")
            return None
        if isinstance(cache_data.get("data"), dict) and "timestamp" in cache_data:
            log.info(
                f"Location data cache loaded from {cache_file} for user '{user_id}'"
            )
            return cache_data
        elif cache_data.get("error") and "timestamp" in cache_data:
            log.warning(f"Cache file for user '{user_id}' contains only error state.")
            return cache_data
        else:
            log.warning(f"Cache file {cache_file} has invalid format. Discarding.")
            return None

    def save_cache_to_file(self, user_id: str, cache_data: Dict[str, Any]):
        cache_filename = self.config.get("USER_CACHE_FILENAME")
        if not cache_filename:
            log.error("USER_CACHE_FILENAME not found in config. Cannot save cache.")
            raise ValueError("Cache filename not configured.")
        cache_file = self._get_user_file_path(user_id, cache_filename)
        if not cache_file:
            raise IOError(f"Could not get cache file path for user '{user_id}'.")
        lock = self.file_locks.get(cache_filename)
        if not lock:
            raise RuntimeError(
                f"Lock configuration missing for cache file '{cache_filename}'."
            )
        if not isinstance(cache_data, dict) or "timestamp" not in cache_data:
            raise ValueError(
                "Invalid cache data structure provided for saving (missing 'timestamp')."
            )
        if "data" not in cache_data and "error" not in cache_data:
            log.warning(
                f"Saving cache for user '{user_id}' with missing 'data' and 'error' keys."
            )
        try:
            save_json_atomic(cache_file, cache_data, lock, indent=None)
            log.debug(f"Cache saved to {cache_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save cache for user '{user_id}': {e}")
            raise

    def load_subscriptions(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        log.debug(f"Loading push subscriptions from DB for user '{user_id}'")
        try:
            subscriptions = (
                db.session.execute(
                    db.select(PushSubscription).filter_by(user_username=user_id)
                )
                .scalars()
                .all()
            )
            subs_data = {
                sub.endpoint: sub.get_subscription_info()
                for sub in subscriptions
                if sub.get_subscription_info() and sub.endpoint
            }
            log.info(
                f"Loaded {len(subs_data)} subscriptions from DB for user '{user_id}'"
            )
            return subs_data
        except Exception as e:
            log.error(f"Database error loading subscriptions for '{user_id}': {e}")
            return {}

    def save_subscriptions(self, user_id: str, subs_to_save: Dict[str, Dict[str, Any]]):
        log.info(
            f"Saving {len(subs_to_save)} push subscriptions to DB for user '{user_id}'"
        )
        if not isinstance(subs_to_save, dict):
            raise TypeError("Subscriptions data must be a dictionary.")
        try:
            existing_subs = {
                sub.endpoint: sub
                for sub in db.session.execute(
                    db.select(PushSubscription).filter_by(user_username=user_id)
                ).scalars()
            }
            incoming_endpoints = set(subs_to_save.keys())
            existing_endpoints = set(existing_subs.keys())
            for endpoint, sub_info in subs_to_save.items():
                if (
                    not isinstance(sub_info, dict)
                    or "endpoint" not in sub_info
                    or "keys" not in sub_info
                ):
                    log.warning(
                        f"Skipping invalid subscription format for endpoint {endpoint[:50]}..."
                    )
                    continue
                sub = existing_subs.get(endpoint)
                if sub:
                    sub.set_subscription_info(sub_info)
                    log.debug(
                        f"Updating existing subscription for endpoint {endpoint[:50]}..."
                    )
                else:
                    user = self.get_user_by_username(user_id)
                    if not user:
                        raise ValueError(
                            f"User '{user_id}' not found for saving subscription."
                        )
                    new_sub = PushSubscription(user_username=user_id, endpoint=endpoint)
                    new_sub.set_subscription_info(sub_info)
                    db.session.add(new_sub)
                    log.debug(
                        f"Adding new subscription for endpoint {endpoint[:50]}..."
                    )
            endpoints_to_delete = existing_endpoints - incoming_endpoints
            if endpoints_to_delete:
                log.info(
                    f"Deleting {len(endpoints_to_delete)} obsolete subscriptions for user '{user_id}'."
                )
                db.session.execute(
                    db.delete(PushSubscription).filter(
                        PushSubscription.user_username == user_id,
                        PushSubscription.endpoint.in_(endpoints_to_delete),
                    )
                )
            db.session.commit()
            log.info(f"Successfully saved subscriptions to DB for user '{user_id}'.")
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error saving subscriptions for user '{user_id}': {e}")
            raise

    def load_notification_history(self, user_id: str) -> List[Dict[str, Any]]:
        log.debug(f"Loading notification history from DB for user '{user_id}'")
        try:
            history_entries = (
                db.session.execute(
                    db.select(NotificationHistory)
                    .filter_by(user_username=user_id)
                    .order_by(NotificationHistory.timestamp.desc())
                )
                .scalars()
                .all()
            )
            history_list = [
                {
                    "id": entry.id,
                    "timestamp": entry.timestamp.isoformat(),
                    "title": entry.title,
                    "body": entry.body,
                    "data": entry.get_data() or {},
                    "is_read": entry.is_read,
                }
                for entry in history_entries
            ]
            log.info(
                f"Loaded {len(history_list)} notification history entries from DB for user '{user_id}'"
            )
            return history_list
        except Exception as e:
            log.error(
                f"Database error loading notification history for '{user_id}': {e}"
            )
            return []

    def save_notification_history(
        self, user_id: str, notification_entry: Dict[str, Any]
    ):
        log.info(f"Saving notification history entry to DB for user '{user_id}'")
        if not isinstance(notification_entry, dict) or not notification_entry.get("id"):
            raise ValueError("Invalid notification entry format.")
        try:
            user = self.get_user_by_username(user_id)
            if not user:
                raise ValueError(f"User '{user_id}' not found for saving notification.")
            ts_input = notification_entry["timestamp"]
            timestamp_obj = None
            if isinstance(ts_input, datetime):
                timestamp_obj = (
                    ts_input.astimezone(timezone.utc)
                    if ts_input.tzinfo
                    else ts_input.replace(tzinfo=timezone.utc)
                )
            elif isinstance(ts_input, str):
                try:
                    ts_str_cleaned = ts_input.replace("Z", "+00:00")
                    timestamp_obj = datetime.fromisoformat(ts_str_cleaned)
                except ValueError:
                    log.error(
                        f"Invalid ISO timestamp format in notification entry: {ts_input}"
                    )
                    raise ValueError("Invalid timestamp format in notification entry")
            else:
                raise ValueError("Timestamp must be a datetime object or ISO string.")
            if timestamp_obj.tzinfo is None:
                timestamp_obj = timestamp_obj.replace(tzinfo=timezone.utc)
            else:
                timestamp_obj = timestamp_obj.astimezone(timezone.utc)
            new_entry = NotificationHistory(
                id=notification_entry["id"],
                user_username=user_id,
                timestamp=timestamp_obj,
                title=notification_entry["title"],
                body=notification_entry.get("body"),
                is_read=notification_entry.get("is_read", False),
            )
            new_entry.set_data(notification_entry.get("data", {}))
            db.session.add(new_entry)
            db.session.commit()
            log.debug(
                f"Added notification history entry {new_entry.id} for user '{user_id}'."
            )
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error saving notification history entry for user '{user_id}': {e}"
            )
            raise

    def update_notification_read_status(
        self, user_id: str, notification_id: str, is_read: bool
    ) -> bool:
        log.info(
            f"Updating read status for notification {notification_id} (User: {user_id}) to {is_read} in DB."
        )
        try:
            result = db.session.execute(
                db.update(NotificationHistory)
                .filter_by(id=notification_id, user_username=user_id)
                .values(is_read=bool(is_read))
            )
            if result.rowcount == 0:
                log.warning(
                    f"Notification {notification_id} not found for user '{user_id}' during read status update."
                )
                db.session.rollback()
                return False
            db.session.commit()
            log.debug(
                f"Successfully updated read status for notification {notification_id}."
            )
            return True
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error updating read status for notification {notification_id} (User: {user_id}): {e}"
            )
            return False

    def delete_notification_history(
        self, user_id: str, notification_id: Optional[str] = None
    ) -> bool:
        try:
            deleted_count = 0
            if notification_id:
                log.info(
                    f"Deleting notification {notification_id} from DB for user '{user_id}'"
                )
                result = db.session.execute(
                    db.delete(NotificationHistory).filter_by(
                        id=notification_id, user_username=user_id
                    )
                )
                deleted_count = result.rowcount
                if deleted_count == 0:
                    log.warning(
                        f"Notification {notification_id} not found for deletion (User: {user_id})."
                    )
            else:
                log.warning(
                    f"Deleting ALL notification history from DB for user '{user_id}'"
                )
                result = db.session.execute(
                    db.delete(NotificationHistory).filter_by(user_username=user_id)
                )
                deleted_count = result.rowcount
                log.info(
                    f"Deleted {deleted_count} notification history entries for user '{user_id}'."
                )
            db.session.commit()
            return True if deleted_count > 0 or notification_id is None else False
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error deleting notification history for user '{user_id}' (ID: {notification_id}): {e}"
            )
            return False

    def prune_notification_history(self, user_id: str):
        log.info(f"Pruning notification history from DB for user '{user_id}'.")
        try:
            max_days = self.config.get("NOTIFICATION_HISTORY_DAYS", 30)
            if not isinstance(max_days, int) or max_days <= 0:
                log.warning(
                    f"Invalid NOTIFICATION_HISTORY_DAYS ({max_days}). Using default 30."
                )
                max_days = 30
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_days)
            result = db.session.execute(
                db.delete(NotificationHistory).filter(
                    NotificationHistory.user_username == user_id,
                    NotificationHistory.timestamp < cutoff_date,
                )
            )
            deleted_count = result.rowcount
            db.session.commit()
            if deleted_count > 0:
                log.info(
                    f"Pruned {deleted_count} old notification history entries from DB for user '{user_id}'."
                )
            else:
                log.debug(f"No history entries needed pruning for user '{user_id}'.")
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error pruning notification history for user '{user_id}': {e}"
            )

    def load_geofence_state(self, user_id: str) -> Dict[Tuple[str, str], str]:
        log.debug(f"Loading geofence state from DB for user '{user_id}'")
        try:
            statuses = (
                db.session.execute(
                    db.select(GeofenceDeviceStatus)
                    .join(Device)
                    .filter(Device.user_username == user_id)
                )
                .scalars()
                .all()
            )
            state_dict = {
                (status.device_id, status.geofence_id): status.status
                for status in statuses
            }
            log.info(
                f"Loaded {len(state_dict)} geofence states from DB for user '{user_id}'"
            )
            return state_dict
        except Exception as e:
            log.error(f"Database error loading geofence state for '{user_id}': {e}")
            return {}

    def save_geofence_state(self, user_id: str, state_dict: Dict[Tuple[str, str], str]):
        log.debug(
            f"Saving {len(state_dict)} geofence states to DB for user '{user_id}'"
        )
        if not isinstance(state_dict, dict):
            raise TypeError("Geofence state data must be a dict.")
        try:
            valid_device_ids = set(
                db.session.execute(
                    db.select(Device.id).filter_by(user_username=user_id)
                )
                .scalars()
                .all()
            )
            valid_geofence_ids = set(
                db.session.execute(
                    db.select(Geofence.id).filter_by(user_username=user_id)
                )
                .scalars()
                .all()
            )
            for (device_id, gf_id), status in state_dict.items():
                if not isinstance(status, str) or status not in [
                    "inside",
                    "outside",
                    "unknown",
                ]:
                    log.warning(
                        f"Skipping invalid status '{status}' for Dev:{device_id}/GF:{gf_id}"
                    )
                    continue
                if device_id not in valid_device_ids or gf_id not in valid_geofence_ids:
                    log.warning(
                        f"Skipping geofence status save: Device '{device_id}' or Geofence '{gf_id}' not found or not owned by user '{user_id}'."
                    )
                    continue
                status_entry = GeofenceDeviceStatus(
                    device_id=device_id, geofence_id=gf_id, status=status
                )
                db.session.merge(status_entry)
            db.session.commit()
            log.debug(f"Geofence state saved to DB for user '{user_id}'")
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error saving geofence state for user '{user_id}': {e}")
            raise

    def load_battery_state(self, user_id: str) -> Dict[str, str]:
        log.debug(f"Loading battery state from DB for user '{user_id}'")
        try:
            devices = db.session.execute(
                db.select(Device.id, Device.last_battery_status).filter_by(
                    user_username=user_id
                )
            ).all()
            state_dict = {
                dev_id: status if status else "unknown" for dev_id, status in devices
            }
            log.info(
                f"Loaded {len(state_dict)} battery states from DB for user '{user_id}'"
            )
            return state_dict
        except Exception as e:
            log.error(f"Database error loading battery state for '{user_id}': {e}")
            return {}

    def save_battery_state(self, user_id: str, state_dict: Dict[str, str]):
        log.debug(f"Saving {len(state_dict)} battery states to DB for user '{user_id}'")
        if not isinstance(state_dict, dict):
            raise TypeError("Battery state data must be a dict.")
        try:
            updated_count = 0
            for device_id, status in state_dict.items():
                valid_statuses = [
                    "low",
                    "normal",
                    "unknown",
                    "Very Low",
                    "Medium",
                    "High",
                    "Full",
                    None,
                ]
                if status not in valid_statuses and not isinstance(status, str):
                    log.warning(
                        f"Skipping invalid battery status '{status}' (type: {type(status)}) for device '{device_id}'"
                    )
                    continue
                result = db.session.execute(
                    db.update(Device)
                    .filter_by(id=device_id, user_username=user_id)
                    .values(last_battery_status=status if status else None)
                )
                if result.rowcount > 0:
                    updated_count += 1
                else:
                    log.warning(
                        f"Device {device_id} not found for user {user_id} while saving battery state."
                    )
            db.session.commit()
            log.debug(
                f"Updated {updated_count} battery states in DB for user '{user_id}'."
            )
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error saving battery state for user '{user_id}': {e}")
            raise

    def load_notification_times(self, user_id: str) -> Dict[Tuple[str, str], float]:
        log.debug(f"Loading notification times from DB for user '{user_id}'")
        try:
            cooldowns = (
                db.session.execute(
                    db.select(NotificationCooldown)
                    .join(Device)
                    .filter(Device.user_username == user_id)
                )
                .scalars()
                .all()
            )
            times_dict = {
                (cd.device_id, cd.event_key): cd.last_sent_timestamp for cd in cooldowns
            }
            log.info(
                f"Loaded {len(times_dict)} notification times from DB for user '{user_id}'"
            )
            return times_dict
        except Exception as e:
            log.error(f"Database error loading notification times for '{user_id}': {e}")
            return {}

    def save_notification_times(
        self, user_id: str, state_dict: Dict[Tuple[str, str], float]
    ):
        log.debug(
            f"Saving {len(state_dict)} notification times to DB for user '{user_id}'"
        )
        if not isinstance(state_dict, dict):
            raise TypeError("Notification times data must be a dict.")
        try:
            valid_device_ids = set(
                db.session.execute(
                    db.select(Device.id).filter_by(user_username=user_id)
                )
                .scalars()
                .all()
            )
            for (device_id, event_key), timestamp in state_dict.items():
                if not isinstance(timestamp, (int, float)):
                    log.warning(
                        f"Skipping invalid timestamp '{timestamp}' for Dev:{device_id}/Event:{event_key}"
                    )
                    continue
                if device_id not in valid_device_ids:
                    log.warning(
                        f"Skipping cooldown save: Device '{device_id}' not found or not owned by user '{user_id}'."
                    )
                    continue
                cooldown_entry = NotificationCooldown(
                    device_id=device_id,
                    event_key=event_key,
                    last_sent_timestamp=float(timestamp),
                )
                db.session.merge(cooldown_entry)
            db.session.commit()
            log.debug(f"Notification times saved to DB for user '{user_id}'")
        except Exception as e:
            db.session.rollback()
            log.error(
                f"Database error saving notification times for user '{user_id}': {e}"
            )
            raise

    def cleanup_user_data_files(self, user_id: str, valid_device_ids: Set[str]):
        log.info(
            f"Running DB state cleanup for user '{user_id}' based on {len(valid_device_ids)} valid device(s)."
        )
        try:
            user_device_ids_subquery = db.select(Device.id).filter_by(
                user_username=user_id
            )
            gf_status_del_stmt = db.delete(GeofenceDeviceStatus).where(
                GeofenceDeviceStatus.device_id.in_(user_device_ids_subquery),
                ~GeofenceDeviceStatus.device_id.in_(valid_device_ids),
            )
            gf_deleted_count = db.session.execute(gf_status_del_stmt).rowcount
            if gf_deleted_count > 0:
                log.info(
                    f"User '{user_id}': Removed {gf_deleted_count} stale geofence status entries from DB."
                )
            cd_del_stmt = db.delete(NotificationCooldown).where(
                NotificationCooldown.device_id.in_(user_device_ids_subquery),
                ~NotificationCooldown.device_id.in_(valid_device_ids),
            )
            cd_deleted_count = db.session.execute(cd_del_stmt).rowcount
            if cd_deleted_count > 0:
                log.info(
                    f"User '{user_id}': Removed {cd_deleted_count} stale notification cooldown entries from DB."
                )
            db.session.commit()
            log.info(f"Finished DB state cleanup for user '{user_id}'.")
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error during state cleanup for user '{user_id}': {e}")

    def load_shares(self) -> Dict[str, Dict[str, Any]]:
        log.debug("Loading ALL shares from DB (use specific methods if possible).")
        try:
            shares = db.session.execute(db.select(Share)).scalars().all()
            shares_data = {}
            for share in shares:
                created_at_aware = (
                    share.created_at.astimezone(timezone.utc)
                    if share.created_at.tzinfo
                    else share.created_at.replace(tzinfo=timezone.utc)
                )
                expires_at_aware = None
                if share.expires_at:
                    expires_at_aware = (
                        share.expires_at.astimezone(timezone.utc)
                        if share.expires_at.tzinfo
                        else share.expires_at.replace(tzinfo=timezone.utc)
                    )
                shares_data[share.id] = {
                    "share_id": share.id,
                    "user_id": share.user_username,
                    "device_id": share.device_id,
                    "created_at": created_at_aware.isoformat(),
                    "expires_at": (
                        expires_at_aware.isoformat() if expires_at_aware else None
                    ),
                    "active": share.active,
                    "note": share.note,
                }
            return shares_data
        except Exception as e:
            log.error(f"Database error loading all shares: {e}")
            return {}

    def save_shares(self, shares_data: Dict[str, Dict[str, Any]]):
        log.warning(
            "save_shares (bulk) called. Prefer specific add/update/delete methods."
        )
        pass

    def get_share(self, share_id: str) -> Optional[Dict[str, Any]]:
        log.debug(f"Loading share {share_id} from DB.")
        try:
            share = db.session.execute(
                db.select(Share).filter_by(id=share_id)
            ).scalar_one_or_none()
            if not share:
                log.warning(f"Share ID '{share_id}' not found in database.")
                return None
            created_at_aware = (
                share.created_at.astimezone(timezone.utc)
                if share.created_at.tzinfo
                else share.created_at.replace(tzinfo=timezone.utc)
            )
            expires_at_aware = None
            if share.expires_at:
                expires_at_aware = (
                    share.expires_at.astimezone(timezone.utc)
                    if share.expires_at.tzinfo
                    else share.expires_at.replace(tzinfo=timezone.utc)
                )
            return {
                "share_id": share.id,
                "user_id": share.user_username,
                "device_id": share.device_id,
                "created_at": created_at_aware.isoformat(),
                "expires_at": (
                    expires_at_aware.isoformat() if expires_at_aware else None
                ),
                "active": share.active,
                "note": share.note,
            }
        except Exception as e:
            log.error(f"Database error loading share {share_id}: {e}", exc_info=True)
            return None

    def add_share(
        self,
        user_id: str,
        device_id: str,
        duration_hours: Optional[int],
        note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        log.info(
            f"Adding share to DB for User:{user_id}, Device:{device_id}, Duration:{duration_hours}h"
        )
        if not user_id or not device_id:
            raise ValueError("Missing user/device ID for share.")
        user = self.get_user_by_username(user_id)
        if not user:
            raise ValueError(f"User '{user_id}' not found.")
        device = db.session.execute(
            db.select(Device).filter_by(id=device_id, user_username=user_id)
        ).scalar_one_or_none()
        if not device:
            raise ValueError(f"Device '{device_id}' not found for user '{user_id}'.")
        share_id = str(uuid.uuid4())
        now_utc = datetime.now(timezone.utc)
        expires_at = None
        if duration_hours is not None and duration_hours > 0:
            expires_at = now_utc + timedelta(hours=duration_hours)
        elif duration_hours == 0:
            expires_at = None
        else:
            default_duration = self.config.get("DEFAULT_SHARE_DURATION_HOURS", 24)
            expires_at = (
                now_utc + timedelta(hours=default_duration)
                if default_duration > 0
                else None
            )
        try:
            new_share = Share(
                id=share_id,
                user_username=user_id,
                device_id=device_id,
                created_at=now_utc,
                expires_at=expires_at,
                active=True,
                note=(note or "").strip()[:100],
            )
            db.session.add(new_share)
            db.session.commit()
            log.info(
                f"User '{user_id}' created share '{share_id}' in DB for device '{device_id}'. Expires: {new_share.expires_at}"
            )
            return {
                "share_id": new_share.id,
                "user_id": new_share.user_username,
                "device_id": new_share.device_id,
                "created_at": new_share.created_at.isoformat(),
                "expires_at": (
                    new_share.expires_at.isoformat() if new_share.expires_at else None
                ),
                "active": new_share.active,
                "note": new_share.note,
            }
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error adding share for user '{user_id}': {e}")
            return None

    def get_user_shares(self, user_id: str) -> List[Dict[str, Any]]:
        log.debug(
            f"Loading shares from DB for user '{user_id}' for potential export/display"
        )
        user_shares = []
        try:
            shares_query = (
                db.select(
                    Share.id,
                    Share.user_username,
                    Share.device_id,
                    Share.created_at,
                    Share.expires_at,
                    Share.active,
                    Share.note,
                    Device.name.label("device_name"),
                )
                .join(Device, Share.device_id == Device.id)
                .where(Share.user_username == user_id)
                .order_by(Share.created_at.desc())
            )
            results = db.session.execute(shares_query).mappings().all()
            now_utc = datetime.now(timezone.utc)

            for row in results:
                expires_at_aware = None
                if row["expires_at"]:
                    expires_at_aware = (
                        row["expires_at"].astimezone(timezone.utc)
                        if row["expires_at"].tzinfo
                        else row["expires_at"].replace(tzinfo=timezone.utc)
                    )
                is_expired = expires_at_aware and expires_at_aware < now_utc

                created_at_aware = row["created_at"]
                if created_at_aware and created_at_aware.tzinfo is None:
                    created_at_aware = created_at_aware.replace(tzinfo=timezone.utc)

                user_shares.append(
                    {
                        "share_id": row["id"],
                        "user_id": row["user_username"],
                        "device_id": row["device_id"],
                        "created_at": (
                            created_at_aware.isoformat() if created_at_aware else None
                        ),
                        "expires_at": (
                            expires_at_aware.isoformat() if expires_at_aware else None
                        ),
                        "active": row["active"],
                        "note": row["note"],
                        "device_name": row["device_name"] or row["device_id"],
                        "is_expired": is_expired,
                    }
                )
            log.info(
                f"Loaded {len(user_shares)} shares from DB for user '{user_id}' (export/display ready)"
            )
            return user_shares
        except Exception as e:
            log.error(
                f"Database error loading shares for user '{user_id}': {e}",
                exc_info=True,
            )
            return []

    def import_user_shares(
        self, user_id: str, shares_to_import: List[Dict[str, Any]]
    ) -> int:
        """Imports shares for a user, preserving IDs if possible."""
        log.warning(
            f"Importing {len(shares_to_import)} shares for user '{user_id}'. ALL EXISTING SHARES FOR THIS USER WILL BE DELETED."
        )
        try:
            # Delete existing shares first within the transaction
            deleted_count_result = db.session.execute(
                db.delete(Share).where(Share.user_username == user_id)
            )
            db.session.flush() # Ensure deletes happen before potential adds with same ID
            log.info(
                f"Deleted {deleted_count_result.rowcount} existing shares for user '{user_id}' before import."
            )
        except Exception as e:
            # If deletion fails, rollback and raise to prevent partial import
            db.session.rollback()
            log.error(
                f"Error deleting existing shares for user '{user_id}' during import: {e}"
            )
            raise # Stop the import process

        valid_user_device_ids = set(
            db.session.execute(db.select(Device.id).filter_by(user_username=user_id))
            .scalars()
            .all()
        )
        if not valid_user_device_ids:
            log.warning(
                f"User '{user_id}' has no devices. Cannot import any shares that require device links."
            )

        imported_count = 0
        new_share_objects = []

        for share_data in shares_to_import:
            if not isinstance(share_data, dict):
                log.warning(f"Skipping malformed share item (not a dict): {share_data}")
                continue

            
            share_id = share_data.get("share_id")
            device_id = share_data.get("device_id")

            
            if not share_id or not isinstance(share_id, str) or len(share_id) > 64:
                log.warning(f"Skipping share item with missing or invalid 'share_id': {share_data}")
                continue
            if not device_id:
                log.warning(f"Skipping share item with missing device_id: {share_data}")
                continue
            

            if device_id not in valid_user_device_ids:
                log.warning(
                    f"Skipping share for device '{device_id}' as it does not exist or belong to user '{user_id}'. Share data: {share_data}"
                )
                continue

            try:
                # new_share_id = str(uuid.uuid4()) 
                created_at_str = share_data.get("created_at")
                # Use helper function to parse potentially naive timestamp
                created_at = _parse_old_timestamp(created_at_str) or datetime.now(
                    timezone.utc
                )
                expires_at_str = share_data.get("expires_at")
                expires_at = _parse_old_timestamp(expires_at_str) # Helper handles None
                active = share_data.get("active", True)
                note = (share_data.get("note", "") or "").strip()[:100]

                
                new_share = Share(
                    id=share_id,
                    user_username=user_id,
                    device_id=device_id,
                    created_at=created_at,
                    expires_at=expires_at,
                    active=bool(active),
                    note=note,
                )
                
                new_share_objects.append(new_share)
                imported_count += 1
            except Exception as e:
                log.error(
                    f"Error processing individual share item for import (User: {user_id}, Device: {device_id}, ShareID: {share_id}): {e}. Data: {share_data}"
                )

        if new_share_objects:
            try:
                # Use add_all which should handle inserting objects with predefined primary keys
                db.session.add_all(new_share_objects)
                log.info(
                    f"Staged {len(new_share_objects)} new shares for user '{user_id}' for commit."
                )
                
                # db.session.commit()
                
            except Exception as e:
                log.error(f"Error staging new shares for user '{user_id}': {e}")
                # Rollback changes within this specific function's scope if staging fails
                db.session.rollback()
                raise # Re-raise to indicate failure to the caller
        return imported_count # Return count of successfully *staged* shares
    

    def toggle_share_status(
        self, share_id: str, requesting_user_id: str, new_status: bool
    ) -> bool:
        log.info(
            f"Toggling share {share_id} status to {new_status} in DB for user '{requesting_user_id}'."
        )
        try:
            result = db.session.execute(
                db.update(Share)
                .filter_by(id=share_id, user_username=requesting_user_id)
                .values(active=bool(new_status))
            )
            if result.rowcount == 0:
                log.warning(
                    f"Toggle status failed: Share {share_id} not found or not owned by user '{requesting_user_id}'."
                )
                db.session.rollback()
                return False
            db.session.commit()
            log.info(f"Successfully toggled share {share_id} status to {new_status}.")
            return True
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error toggling share status for {share_id}: {e}")
            return False

    def update_share_expiry(
        self, share_id: str, requesting_user_id: str, new_duration_hours: Optional[int]
    ) -> Optional[Dict]:
        log.info(
            f"Updating share {share_id} expiry (Duration: {new_duration_hours}h) in DB for user '{requesting_user_id}'."
        )
        try:
            share = db.session.execute(
                db.select(Share).filter_by(
                    id=share_id, user_username=requesting_user_id
                )
            ).scalar_one_or_none()
            if not share:
                log.warning(
                    f"Update expiry failed: Share {share_id} not found or not owned by user '{requesting_user_id}'."
                )
                return None
            now_utc = datetime.now(timezone.utc)
            new_expires_at: Optional[datetime] = None
            if new_duration_hours is not None and new_duration_hours > 0:
                new_expires_at = now_utc + timedelta(hours=new_duration_hours)
            elif new_duration_hours == 0:
                new_expires_at = None
            else:
                default_duration = self.config.get("DEFAULT_SHARE_DURATION_HOURS", 24)
                new_expires_at = (
                    now_utc + timedelta(hours=default_duration)
                    if default_duration > 0
                    else None
                )
            share.expires_at = new_expires_at
            db.session.commit()
            log.info(
                f"Successfully updated expiry for share {share_id} to {share.expires_at}."
            )
            is_expired_check = False
            expires_at_iso = None
            if share.expires_at:
                expires_at_aware = (
                    share.expires_at.astimezone(timezone.utc)
                    if share.expires_at.tzinfo
                    else share.expires_at.replace(tzinfo=timezone.utc)
                )
                is_expired_check = expires_at_aware < now_utc
                expires_at_iso = expires_at_aware.isoformat()
            created_at_aware = (
                share.created_at.astimezone(timezone.utc)
                if share.created_at.tzinfo
                else share.created_at.replace(tzinfo=timezone.utc)
            )
            return {
                "share_id": share.id,
                "user_id": share.user_username,
                "device_id": share.device_id,
                "created_at": created_at_aware.isoformat(),
                "expires_at": expires_at_iso,
                "active": share.active,
                "note": share.note,
                "is_expired": is_expired_check,
            }
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error updating share expiry for {share_id}: {e}")
            raise

    def delete_share_permanently(self, share_id: str, requesting_user_id: str) -> bool:
        log.warning(
            f"Permanently deleting share {share_id} from DB for user '{requesting_user_id}'."
        )
        try:
            result = db.session.execute(
                db.delete(Share).filter_by(
                    id=share_id, user_username=requesting_user_id
                )
            )
            if result.rowcount == 0:
                log.warning(
                    f"Permanent delete failed: Share {share_id} not found or not owned by user '{requesting_user_id}'."
                )
                db.session.rollback()
                return False
            db.session.commit()
            log.info(f"Successfully permanently deleted share {share_id}.")
            return True
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error permanently deleting share {share_id}: {e}")
            return False

    def prune_expired_shares(self):
        log.info("Pruning expired shares from DB...")
        try:
            now_utc = datetime.now(timezone.utc)
            result = db.session.execute(
                db.delete(Share).filter(
                    Share.expires_at != None, Share.expires_at < now_utc
                )
            )
            deleted_count = result.rowcount
            db.session.commit()
            if deleted_count > 0:
                log.info(f"Successfully pruned {deleted_count} expired shares from DB.")
            else:
                log.info("No expired shares found to prune from DB.")
        except Exception as e:
            db.session.rollback()
            log.error(f"Database error during share pruning: {e}")

    def is_device_shared(self, user_id: str, device_id: str) -> bool:
        log.debug(f"Checking DB if device {device_id} is shared by user {user_id}.")
        try:
            now_utc = datetime.now(timezone.utc)
            exists_query = (
                db.select(Share.id)
                .filter_by(user_username=user_id, device_id=device_id, active=True)
                .filter((Share.expires_at == None) | (Share.expires_at >= now_utc))
                .limit(1)
            )
            result = db.session.execute(exists_query).first()
            is_shared = result is not None
            log.debug(
                f"Device {device_id} shared status for user {user_id}: {is_shared}"
            )
            return is_shared
        except Exception as e:
            log.error(
                f"Database error checking share status for device {device_id} (User: {user_id}): {e}"
            )
            return False
