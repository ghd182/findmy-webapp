# app/services/user_data_service.py
import os
import json
import logging
import threading
import shutil
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, Set, List
from datetime import datetime, timezone, timedelta
from werkzeug.security import generate_password_hash
import uuid


from app.utils.json_utils import load_json_file, save_json_atomic
from app.utils.helpers import (
    encrypt_password,
    decrypt_password,
    getDefaultColorForId,
    generate_device_icon_svg,
    DEFAULT_SOURCE_COLOR,  # Import the default color constant
)

log = logging.getLogger(__name__)


class UserDataService:
    """
    Handles loading and saving of user-specific data files (JSON).
    Encapsulates file paths, locking, and basic validation.
    """

    def __init__(self, config: Dict[str, Any]):
        """
        Initializes the service with application configuration.

        Args:
            config: The Flask app config dictionary.
        """
        self.config = config
        self.data_dir = Path(config["DATA_DIRECTORY"])
        self.users_file = Path(config["USERS_FILE"])
        self.file_locks = config["FILE_LOCKS"]  # Use locks from config

        # Ensure base data directory exists
        self.data_dir.mkdir(parents=True, exist_ok=True)
        log.debug(f"UserDataService initialized. Data directory: {self.data_dir}")

    # --- Path Helpers ---

    def _get_user_data_dir(self, user_id: str) -> Optional[Path]:
        """Gets the Path object for a user's data directory, creating it if needed."""
        if (
            not user_id
            or not isinstance(user_id, str)
            or "/" in user_id
            or ".." in user_id  # Prevent path traversal
            or user_id.startswith(".")
        ):
            log.error(f"Attempted to get data dir for invalid user ID: '{user_id}'")
            return None  # Indicate failure

        user_dir = self.data_dir / user_id
        try:
            user_dir.mkdir(parents=True, exist_ok=True)
            return user_dir
        except OSError as e:
            log.error(f"Failed to create user data directory {user_dir}: {e}")
            return None

    def _get_user_file_path(self, user_id: str, filename: str) -> Optional[Path]:
        """Constructs the full path to a user-specific file."""
        user_dir = self._get_user_data_dir(user_id)
        if not user_dir:
            return None  # Failed to get/create user directory

        # Basic check on filename
        if "/" in filename or filename.startswith("."):
            log.error(
                f"Attempted to get file path for invalid filename: '{filename}' for user '{user_id}'"
            )
            return None

        return user_dir / filename

    # --- Global User Management (users.json) ---

    def load_users(self) -> Dict[str, Dict[str, Any]]:
        """Loads the main user database (users.json)."""
        users_lock = self.file_locks.get("users")
        if not users_lock:
            log.error("Lock for 'users.json' not found in configuration.")
            return {}

        users_data = load_json_file(self.users_file, users_lock)

        if users_data is None:
            return {}
        elif not isinstance(users_data, dict):
            log.error(
                f"{self.users_file.name} has invalid format (not a dictionary). Returning empty."
            )
            return {}

        log.info(f"Loaded {len(users_data)} users from {self.users_file.name}")
        return users_data

    def save_users(self, users_data: Dict[str, Dict[str, Any]]):
        """Saves the main user database (users.json)."""
        users_lock = self.file_locks.get("users")
        if not users_lock:
            log.error("Lock for 'users.json' not found in configuration. Cannot save.")
            raise RuntimeError("User lock configuration missing.")
        if not isinstance(users_data, dict):
            log.error(
                f"Attempted to save non-dictionary data to {self.users_file.name}. Aborting save."
            )
            raise TypeError("users_data must be a dictionary.")
        try:
            save_json_atomic(self.users_file, users_data, users_lock, indent=4)
            log.info(f"Saved {len(users_data)} users to {self.users_file.name}")
        except Exception as e:
            log.error(f"Failed to save users data: {e}")
            raise

    def load_single_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Loads data for a single user from users.json."""
        all_users = self.load_users()
        return all_users.get(user_id)

    # --- NEW: User Preferences ---
    def load_user_preferences(self, user_id: str) -> Dict[str, str]:
        """Loads theme preferences for a user, returning defaults if not found."""
        user_data = self.load_single_user(user_id)
        default_prefs = {
            "theme_mode": "system",
            "theme_color": DEFAULT_SOURCE_COLOR,  # Use default from helpers
        }
        if not user_data:
            return default_prefs

        # Return saved prefs or defaults if specific keys are missing
        return {
            "theme_mode": user_data.get("theme_mode", default_prefs["theme_mode"]),
            "theme_color": user_data.get("theme_color", default_prefs["theme_color"]),
        }

    def save_user_preferences(self, user_id: str, theme_mode: str, theme_color: str):
        """Saves theme preferences for a user into users.json."""
        if not user_id:
            log.error("Cannot save preferences for empty user ID.")
            raise ValueError("User ID cannot be empty.")

        # --- START: Validation (outside lock) ---
        valid_modes = ["system", "light", "dark"]
        if theme_mode not in valid_modes:
            log.warning(
                f"Invalid theme mode '{theme_mode}' for user '{user_id}'. Using 'system'."
            )
            theme_mode = "system"
        if not theme_color or not theme_color.startswith("#") or len(theme_color) != 7:
            log.warning(
                f"Invalid theme color '{theme_color}' for user '{user_id}'. Using default."
            )
            theme_color = DEFAULT_SOURCE_COLOR
        # --- END: Validation ---

        users_lock = self.file_locks.get("users")
        if not users_lock:
            log.error("Lock for 'users.json' not found. Cannot save preferences.")
            raise RuntimeError("User lock configuration missing.")

        # --- START: Modified Lock Handling ---
        MAX_RETRIES = 3
        RETRY_DELAY = 0.1  # seconds
        for attempt in range(MAX_RETRIES):
            # 1. Load data *without* holding the lock for modification
            #    (load_users handles its own locking for the read)
            all_users = self.load_users()  # Read the latest data

            if user_id not in all_users:
                log.error(
                    f"User '{user_id}' not found in users.json during save attempt {attempt + 1}. Cannot save preferences."
                )
                raise ValueError(f"User '{user_id}' not found.")

            # 2. Modify the data in memory
            original_mode = all_users[user_id].get("theme_mode")
            original_color = all_users[user_id].get("theme_color")
            all_users[user_id]["theme_mode"] = theme_mode
            all_users[user_id]["theme_color"] = theme_color

            # 3. Acquire lock ONLY for the save operation
            with users_lock:
                # 4. *Re-read* the file inside the lock to check for conflicts
                try:
                    # Use the locked load_json_file directly for efficiency
                    current_data_in_file = load_json_file(
                        self.users_file, threading.Lock()
                    )  # Dummy lock as outer lock is held
                    if (
                        current_data_in_file is None
                    ):  # File deleted or corrupted between load and lock?
                        log.error(
                            f"Users file {self.users_file} became inaccessible during save_user_preferences. Aborting."
                        )
                        raise IOError("Users file became inaccessible during save.")

                    # Check if the specific user's data changed concurrently
                    current_user_data_in_file = current_data_in_file.get(user_id, {})
                    if (
                        current_user_data_in_file.get("theme_mode") != original_mode
                        or current_user_data_in_file.get("theme_color")
                        != original_color
                    ):
                        log.warning(
                            f"Conflict detected saving preferences for user '{user_id}'. Retrying (attempt {attempt + 1}/{MAX_RETRIES})..."
                        )
                        # Release lock implicitly by exiting 'with', loop will retry
                        if attempt < MAX_RETRIES - 1:
                            import time

                            time.sleep(
                                RETRY_DELAY * (attempt + 1)
                            )  # Exponential backoff basic
                            continue  # Go to next retry iteration
                        else:
                            log.error(
                                f"Failed to save preferences for user '{user_id}' after {MAX_RETRIES} attempts due to conflicts."
                            )
                            raise RuntimeError(
                                "Failed to save preferences due to concurrent modification."
                            )

                    # 5. If no conflict, save the modified data (atomic save)
                    save_json_atomic(
                        self.users_file, all_users, threading.Lock(), indent=4
                    )  # Dummy lock as outer lock is held
                    log.info(
                        f"Saved preferences for user '{user_id}': Mode={theme_mode}, Color={theme_color}"
                    )
                    return  # Success, exit function

                except Exception as e:
                    log.exception(
                        f"Error during locked save/check in save_user_preferences (attempt {attempt + 1})"
                    )
                    # Depending on error, might want to retry or raise immediately
                    if attempt < MAX_RETRIES - 1:
                        import time

                        time.sleep(RETRY_DELAY * (attempt + 1))
                        continue
                    else:
                        raise  # Re-raise after final attempt

        # Should not be reached if successful, only if retries failed
        log.error(f"Exhausted retries saving preferences for {user_id}")
        raise RuntimeError("Failed to save preferences after multiple retries.")

    # --- Apple Credentials ---

    def load_apple_credentials(
        self, user_id: str
    ) -> Tuple[Optional[str], Optional[str]]:
        """Loads Apple ID and (decrypted) password for a user."""
        creds_filename = self.config["USER_APPLE_CREDS_FILENAME"]
        creds_file = self._get_user_file_path(user_id, creds_filename)
        if not creds_file:
            return None, None
        lock = self.file_locks.get(creds_filename)
        if not lock:
            log.error(f"Lock for '{creds_filename}' not found.")
            return None, None

        creds_data = load_json_file(creds_file, lock)
        if creds_data is None:
            log.debug(f"No Apple credentials file found for user '{user_id}'.")
            return None, None

        apple_id = creds_data.get("apple_id")
        encrypted_password = creds_data.get("apple_password_encrypted")
        if not apple_id or not encrypted_password:
            log.warning(
                f"Incomplete Apple credentials found for user '{user_id}' in {creds_file.name}."
            )
            return apple_id or None, None

        password = decrypt_password(encrypted_password, self.config)
        if not password:
            log.error(
                f"Password decryption failed for user '{user_id}'. Check FERNET_KEY or stored format."
            )
            return apple_id, None
        log.debug(f"Loaded Apple credentials for user '{user_id}'.")
        return apple_id, password

    def save_apple_credentials(self, user_id: str, apple_id: str, apple_password: str):
        """Saves (encrypted) Apple credentials for a user."""
        if not user_id or not apple_id or not apple_password:
            raise ValueError("Missing required arguments for saving Apple credentials.")
        creds_filename = self.config["USER_APPLE_CREDS_FILENAME"]
        creds_file = self._get_user_file_path(user_id, creds_filename)
        if not creds_file:
            raise IOError(f"Could not determine file path for user '{user_id}'.")
        lock = self.file_locks.get(creds_filename)
        if not lock:
            raise RuntimeError("Apple credentials lock configuration missing.")

        encrypted_password = encrypt_password(apple_password, self.config)
        if not encrypted_password and apple_password:
            raise ValueError("Password encryption failed.")

        creds_data = {
            "apple_id": apple_id,
            "apple_password_encrypted": encrypted_password,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        try:
            save_json_atomic(creds_file, creds_data, lock, indent=4)
            log.info(f"Saved Apple credentials to {creds_file} for user '{user_id}'.")
        except Exception as e:
            log.error(f"Failed to save Apple credentials for user '{user_id}': {e}")
            raise

    def clear_apple_credentials(self, user_id: str):
        """Removes the Apple credentials file for a user."""
        if not user_id:
            log.error("clear_apple_credentials called without user_id")
            return
        creds_filename = self.config["USER_APPLE_CREDS_FILENAME"]
        creds_file = self._get_user_file_path(user_id, creds_filename)
        if not creds_file:
            return
        lock = self.file_locks.get(creds_filename)
        if not lock:
            log.error(f"Lock for '{creds_filename}' not found.")
            return
        with lock:
            try:
                if creds_file.exists():
                    os.remove(creds_file)
                    log.info(f"Removed Apple credentials file for user '{user_id}'.")
                else:
                    log.debug(
                        f"No Apple credentials file to remove for user '{user_id}'."
                    )
            except OSError as e:
                log.error(f"Failed to remove {creds_file}: {e}")

    def user_has_apple_credentials(self, user_id: str) -> bool:
        """Checks if the credentials file exists and contains an ID."""
        creds_filename = self.config["USER_APPLE_CREDS_FILENAME"]
        creds_file = self._get_user_file_path(user_id, creds_filename)
        if not creds_file or not creds_file.exists():
            return False
        apple_id, _ = self.load_apple_credentials(user_id)
        return bool(apple_id)

    # --- Devices Config ---

    def load_devices_config(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """
        Loads and validates the devices configuration for a user.
        Merges devices found from .plist/.keys files if they are missing from devices.json.
        """
        devices_filename = self.config["USER_DEVICES_FILENAME"]
        devices_file = self._get_user_file_path(user_id, devices_filename)
        if not devices_file:
            return {}

        lock = self.file_locks.get(devices_filename)
        if not lock:
            log.error(f"Lock for '{devices_filename}' not found.")
            return {}

        config_data = load_json_file(devices_file, lock)
        if config_data is None:
            config_data = {}  # Start with empty dict if file missing/invalid

        # --- START: Merge file-based devices if missing from loaded config ---
        user_data_dir = self._get_user_data_dir(user_id)
        config_changed_by_merge = False
        if user_data_dir:
            found_file_ids = set()
            for data_file in list(user_data_dir.glob("*.plist")) + list(
                user_data_dir.glob("*.keys")
            ):
                device_id = data_file.stem
                # Skip known non-device files
                if device_id == Path(self.config["USER_APPLE_CREDS_FILENAME"]).stem:
                    continue
                if device_id:
                    found_file_ids.add(device_id)

            devices_to_add = found_file_ids - set(config_data.keys())
            if devices_to_add:
                log.warning(
                    f"User '{user_id}': Found device files not in {devices_filename}: {devices_to_add}. Adding default entries."
                )
                for device_id in devices_to_add:
                    config_data[device_id] = {  # Add default config
                        "name": device_id,
                        "label": "❓",
                        "color": None,
                        "model": "Accessory/Tag",
                        "icon": "tag",
                        "linked_geofences": [],
                    }
                config_changed_by_merge = True  # Mark that we modified the loaded data
        # --- END: Merge file-based devices ---

        # --- Validation ---
        all_user_geofences = self.load_geofences_config(
            user_id
        )  # Load for link validation
        validated_config = {}
        default_config_structure = {
            "linked_geofences": [],
            "name": None,
            "label": "❓",
            "color": None,
            "model": "Accessory/Tag",
            "icon": "tag",
        }
        for device_id, config in config_data.items():
            if not isinstance(config, dict):
                continue
            validated_device = default_config_structure.copy()
            validated_device.update(config)  # Apply loaded config over defaults
            raw_links = validated_device.get("linked_geofences", [])
            validated_links, linked_ids_seen = [], set()
            if isinstance(raw_links, list):
                for link in raw_links:
                    if isinstance(link, dict) and "id" in link:
                        gf_id = link.get("id")
                        if (
                            isinstance(gf_id, str)
                            and gf_id
                            and gf_id in all_user_geofences
                            and gf_id not in linked_ids_seen
                        ):
                            validated_links.append(
                                {
                                    "id": gf_id,
                                    "notify_entry": bool(
                                        link.get("notify_entry", False)
                                    ),
                                    "notify_exit": bool(link.get("notify_exit", False)),
                                }
                            )
                            linked_ids_seen.add(gf_id)
                        elif gf_id and gf_id not in all_user_geofences:
                            log.warning(
                                f"User '{user_id}', Device '{device_id}': Linked geofence ID '{gf_id}' not found. Removing link."
                            )
                        elif gf_id in linked_ids_seen:
                            log.warning(
                                f"User '{user_id}', Device '{device_id}': Duplicate geofence link ID '{gf_id}'. Ignoring duplicate."
                            )
            validated_device["linked_geofences"] = validated_links
            validated_device["name"] = str(
                validated_device.get("name", device_id) or device_id
            ).strip()
            validated_device["label"] = str(
                validated_device.get("label", "❓") or "❓"
            ).strip()[:2]
            validated_device["color"] = validated_device.get("color")  # Allow None
            validated_device["model"] = str(
                validated_device.get("model", "Accessory/Tag") or "Accessory/Tag"
            ).strip()
            validated_device["icon"] = str(
                validated_device.get("icon", "tag") or "tag"
            ).strip()

            # --- Generate and add SVG icon during load ---
            try:
                final_color_for_svg = validated_device["color"] or getDefaultColorForId(
                    device_id
                )
                validated_device["svg_icon"] = generate_device_icon_svg(
                    validated_device["label"], final_color_for_svg
                )
            except Exception as svg_err:
                log.error(
                    f"Error generating SVG during device config load for {device_id}: {svg_err}"
                )
                validated_device["svg_icon"] = None  # Ensure field exists even on error
            # --- -------------------------------------- ---

            validated_config[device_id] = validated_device

        # If we added devices by merging, save the updated config file back
        if config_changed_by_merge:
            log.info(
                f"User '{user_id}': Saving merged device config back to {devices_filename}."
            )
            try:
                # Use save_json_atomic directly for initial save, indent=4 for readability
                save_json_atomic(
                    devices_file,
                    {
                        dev_id: {k: v for k, v in conf.items() if k != "svg_icon"}
                        for dev_id, conf in validated_config.items()
                    },
                    lock,
                    indent=4,
                )  # Exclude SVG from file
            except Exception as e:
                log.error(
                    f"User '{user_id}': Failed to save merged {devices_filename}: {e}"
                )
                # Proceed with in-memory data, but log error

        log.debug(
            f"Device config loaded for user '{user_id}' ({len(validated_config)} items)"
        )
        return validated_config

    def save_devices_config(self, user_id: str, config_data: Dict[str, Dict[str, Any]]):
        """Validates and saves the devices configuration for a user (excluding generated SVG)."""
        devices_filename = self.config["USER_DEVICES_FILENAME"]
        devices_file = self._get_user_file_path(user_id, devices_filename)
        if not devices_file:
            raise IOError(
                f"Could not determine device config file path for user '{user_id}'."
            )
        lock = self.file_locks.get(devices_filename)
        if not lock:
            raise RuntimeError("Device config lock configuration missing.")
        if not isinstance(config_data, dict):
            raise TypeError("Device config data must be a dictionary.")

        all_user_geofences_ids = set(self.load_geofences_config(user_id).keys())
        validated_config_to_save = {}
        for device_id, config in config_data.items():
            if not isinstance(config, dict):
                log.warning(
                    f"User '{user_id}', Device '{device_id}': Invalid config format (not dict) during save, skipping."
                )
                continue
            config_to_save = {
                k: v for k, v in config.items() if k != "svg_icon"
            }  # Exclude SVG from saving

            raw_links = config_to_save.get("linked_geofences", [])
            validated_links, linked_ids_seen = [], set()
            if isinstance(raw_links, list):
                for link in raw_links:
                    if isinstance(link, dict) and "id" in link:
                        gf_id = link.get("id")
                        if (
                            isinstance(gf_id, str)
                            and gf_id
                            and gf_id in all_user_geofences_ids
                            and gf_id not in linked_ids_seen
                        ):
                            validated_links.append(
                                {
                                    "id": gf_id,
                                    "notify_entry": bool(
                                        link.get("notify_entry", False)
                                    ),
                                    "notify_exit": bool(link.get("notify_exit", False)),
                                }
                            )
                            linked_ids_seen.add(gf_id)
                        elif gf_id and gf_id not in all_user_geofences_ids:
                            log.warning(
                                f"User '{user_id}', Device '{device_id}': Skipping link to non-existent geofence ID '{gf_id}' during save."
                            )
                        elif gf_id in linked_ids_seen:
                            log.warning(
                                f"User '{user_id}', Device '{device_id}': Duplicate geofence link ID '{gf_id}' during save. Skipping duplicate."
                            )
            config_to_save["linked_geofences"] = validated_links
            config_to_save["name"] = str(
                config_to_save.get("name", device_id) or device_id
            ).strip()
            config_to_save["label"] = str(
                config_to_save.get("label", "❓") or "❓"
            ).strip()[:2]
            config_to_save["color"] = config_to_save.get("color")
            config_to_save["model"] = str(
                config_to_save.get("model", "Accessory/Tag") or "Accessory/Tag"
            ).strip()
            config_to_save["icon"] = str(
                config_to_save.get("icon", "tag") or "tag"
            ).strip()
            validated_config_to_save[device_id] = config_to_save

        try:
            save_json_atomic(devices_file, validated_config_to_save, lock, indent=4)
            log.info(f"Device config saved to {devices_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save device config for user '{user_id}': {e}")
            raise

    # --- Geofences Config ---

    def load_geofences_config(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """Loads and validates the geofences configuration for a user."""
        geofences_filename = self.config["USER_GEOFENCES_FILENAME"]
        geofences_file = self._get_user_file_path(user_id, geofences_filename)
        if not geofences_file:
            return {}
        lock = self.file_locks.get(geofences_filename)
        if not lock:
            log.error(f"Lock for '{geofences_filename}' not found.")
            return {}

        config_data = load_json_file(geofences_file, lock)
        if config_data is None:
            return {}

        validated_config, seen_names_lower = {}, set()
        for gf_id, config in config_data.items():
            if not isinstance(config, dict):
                log.warning(
                    f"User '{user_id}', Geofence '{gf_id}': Invalid config format (not dict), skipping."
                )
                continue
            try:
                validated_gf = {
                    "id": gf_id,
                    "name": str(config["name"]).strip(),
                    "lat": float(config["lat"]),
                    "lng": float(config["lng"]),
                    "radius": float(config["radius"]),
                }
                if (
                    not validated_gf["name"]
                    or validated_gf["radius"] <= 0
                    or not (-90 <= validated_gf["lat"] <= 90)
                    or not (-180 <= validated_gf["lng"] <= 180)
                ):
                    raise ValueError("Invalid geofence data (name, radius, lat, lng).")
                name_lower = validated_gf["name"].lower()
                if name_lower in seen_names_lower:
                    log.warning(
                        f"User '{user_id}' has duplicate geofence name (case-insensitive): '{validated_gf['name']}'. Loading anyway, but check config."
                    )
                validated_config[gf_id] = validated_gf
                seen_names_lower.add(name_lower)
            except (KeyError, ValueError, TypeError) as ve:
                log.warning(
                    f"User '{user_id}': Skipping invalid geofence config for ID {gf_id}: {config} - Error: {ve}"
                )

        log.debug(
            f"Geofence config loaded for user '{user_id}' ({len(validated_config)} items)"
        )
        return validated_config

    def save_geofences_config(
        self, user_id: str, config_data: Dict[str, Dict[str, Any]]
    ):
        """Validates and saves the geofences configuration for a user."""
        geofences_filename = self.config["USER_GEOFENCES_FILENAME"]
        geofences_file = self._get_user_file_path(user_id, geofences_filename)
        if not geofences_file:
            raise IOError(
                f"Could not determine geofence config file path for user '{user_id}'."
            )
        lock = self.file_locks.get(geofences_filename)
        if not lock:
            raise RuntimeError("Geofence config lock configuration missing.")
        if not isinstance(config_data, dict):
            raise TypeError("Geofence config data must be a dictionary.")

        validated_config_to_save, seen_names_lower = {}, set()
        for gf_id, config in config_data.items():
            config_value = {
                k: v for k, v in config.items() if k != "id"
            }  # Exclude ID from value saved to file
            if not isinstance(config_value, dict):
                log.warning(
                    f"User '{user_id}', Geofence '{gf_id}': Invalid value format (not dict) during save, skipping."
                )
                continue
            try:
                validated_gf_data = {
                    "name": str(config_value["name"]).strip(),
                    "lat": float(config_value["lat"]),
                    "lng": float(config_value["lng"]),
                    "radius": float(config_value["radius"]),
                }
                if (
                    not validated_gf_data["name"]
                    or validated_gf_data["radius"] <= 0
                    or not (-90 <= validated_gf_data["lat"] <= 90)
                    or not (-180 <= validated_gf_data["lng"] <= 180)
                ):
                    raise ValueError("Invalid geofence data (name, radius, lat, lng).")
                name_lower = validated_gf_data["name"].lower()
                if name_lower in seen_names_lower:
                    raise ValueError(
                        f"Duplicate geofence name detected: '{validated_gf_data['name']}'"
                    )
                validated_config_to_save[gf_id] = validated_gf_data
                seen_names_lower.add(name_lower)
            except (KeyError, ValueError, TypeError) as ve:
                log.warning(
                    f"User '{user_id}': Skipping invalid geofence during save ID {gf_id}: {config_value} - Error: {ve}"
                )

        try:
            save_json_atomic(geofences_file, validated_config_to_save, lock, indent=4)
            log.info(f"Geofence config saved to {geofences_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save geofence config for user '{user_id}': {e}")
            raise

    # --- Push Subscriptions ---

    def load_subscriptions(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """Loads push notification subscriptions for a user."""
        subs_filename = self.config["USER_SUBSCRIPTIONS_FILENAME"]
        subs_file = self._get_user_file_path(user_id, subs_filename)
        if not subs_file:
            return {}
        lock = self.file_locks.get(subs_filename)
        if not lock:
            log.error(f"Lock for '{subs_filename}' not found.")
            return {}

        subs_data = load_json_file(subs_file, lock)
        if subs_data is None:
            return {}

        validated_subs = {}
        for endpoint, sub_info in subs_data.items():
            if (
                isinstance(sub_info, dict)
                and "endpoint" in sub_info
                and "keys" in sub_info
            ):
                validated_subs[endpoint] = sub_info
            else:
                log.warning(
                    f"User '{user_id}': Invalid subscription format found for endpoint '{endpoint[:50]}...'. Skipping."
                )
        log.info(f"Loaded {len(validated_subs)} subscriptions for user '{user_id}'")
        return validated_subs

    def save_subscriptions(self, user_id: str, subs_to_save: Dict[str, Dict[str, Any]]):
        """Saves push notification subscriptions for a user."""
        subs_filename = self.config["USER_SUBSCRIPTIONS_FILENAME"]
        subs_file = self._get_user_file_path(user_id, subs_filename)
        if not subs_file:
            raise IOError(
                f"Could not determine subscriptions file path for user '{user_id}'."
            )
        lock = self.file_locks.get(subs_filename)
        if not lock:
            raise RuntimeError("Subscriptions lock configuration missing.")
        if not isinstance(subs_to_save, dict):
            raise TypeError("Subscriptions data must be a dictionary.")

        validated_data_to_save = {}
        for endpoint, sub_info in subs_to_save.items():
            if (
                isinstance(sub_info, dict)
                and "endpoint" in sub_info
                and "keys" in sub_info
            ):
                validated_data_to_save[endpoint] = sub_info
            else:
                log.warning(
                    f"User '{user_id}': Attempting to save invalid subscription format for endpoint '{endpoint[:50]}...'. Skipping."
                )
        try:
            save_json_atomic(
                subs_file, validated_data_to_save, lock, indent=None
            )  # No indent
            log.info(
                f"Saved {len(validated_data_to_save)} subscriptions to {subs_file} for user '{user_id}'"
            )
        except Exception as e:
            log.error(f"Failed to save subscriptions for user '{user_id}': {e}")
            raise

    # --- Notification History ---

    def load_notification_history(self, user_id: str) -> List[Dict[str, Any]]:
        """Loads notification history for a user, sorted newest first."""
        history_filename = self.config["USER_NOTIFICATIONS_HISTORY_FILENAME"]
        history_file = self._get_user_file_path(user_id, history_filename)
        if not history_file:
            return []
        lock = self.file_locks.get(history_filename)
        if not lock:
            log.error(f"Lock for '{history_filename}' not found.")
            return []

        # --- MODIFIED: Use load_json_file but handle LIST type ---
        with lock:
            if not history_file.exists():
                log.debug(f"Notification history file not found: {history_file}")
                return []
            if history_file.stat().st_size == 0:
                log.warning(f"Notification history file is empty: {history_file}")
                return []

            try:
                with open(history_file, "r", encoding="utf-8") as f:
                    history_data = json.load(f)

                # *** CRITICAL FIX: Check if it's a LIST ***
                if not isinstance(history_data, list):
                    log.warning(
                        f"Notification history file {history_file} is not a list. Resetting."
                    )
                    # Optionally backup/rename corrupted file here before returning empty
                    # history_file.rename(history_file.with_suffix(".corrupted"))
                    return []

            except json.JSONDecodeError as e:
                log.error(f"Failed to parse JSON from {history_file}: {e}")
                return []
            except (IOError, OSError) as e:
                log.error(f"Failed to read file {history_file}: {e}")
                return []
            except Exception as e:
                log.exception(f"Unexpected error loading JSON from {history_file}")
                return []
        # --- END MODIFICATION ---

        # Ensure basic structure and sort (Keep this part)
        validated_history = []
        required_keys = {"id", "timestamp", "title", "body", "is_read"}
        for item in history_data:
            if isinstance(item, dict) and required_keys.issubset(item.keys()):
                try:
                    # Attempt to parse timestamp for sorting consistency check
                    item_ts_str = item.get("timestamp", "")
                    # Ensure timestamp has timezone info before parsing
                    if "+" not in item_ts_str and "Z" not in item_ts_str:
                        item_ts_str += "+00:00"  # Assume UTC if no offset
                    else:
                        item_ts_str = item_ts_str.replace("Z", "+00:00")

                    item["timestamp_dt"] = datetime.fromisoformat(item_ts_str)
                    validated_history.append(item)
                except (ValueError, TypeError, KeyError) as e:
                    log.warning(
                        f"Skipping history item with invalid timestamp '{item.get('timestamp')}': {e} (ID: {item.get('id')})"
                    )
            else:
                log.warning(
                    f"Skipping invalid history item structure: {str(item)[:100]}..."
                )

        validated_history.sort(key=lambda x: x["timestamp_dt"], reverse=True)
        # Remove temporary sort key
        for item in validated_history:
            del item["timestamp_dt"]

        log.info(
            f"Loaded {len(validated_history)} notification history entries for user '{user_id}'"
        )
        return validated_history

    def save_notification_history(
        self, user_id: str, notification_entry: Dict[str, Any]
    ):
        """Adds a new notification entry to the history file (which is a list)."""
        history_filename = self.config["USER_NOTIFICATIONS_HISTORY_FILENAME"]
        history_file = self._get_user_file_path(user_id, history_filename)
        if not history_file:
            raise IOError(
                f"Could not get notification history file path for user '{user_id}'."
            )
        lock = self.file_locks.get(history_filename)
        if not lock:
            raise RuntimeError(f"Lock for '{history_filename}' not found.")

        # --- MODIFIED: Load existing history (expecting list) and handle potential errors ---
        with lock:
            current_history = []  # Default to empty list
            if history_file.exists() and history_file.stat().st_size > 0:
                try:
                    with open(history_file, "r", encoding="utf-8") as f:
                        loaded_data = json.load(f)
                    if isinstance(loaded_data, list):
                        current_history = loaded_data
                    else:
                        log.warning(
                            f"Overwriting non-list history file {history_file} during save."
                        )
                except Exception as load_err:
                    log.error(
                        f"Error loading existing history file {history_file} during save, starting fresh: {load_err}"
                    )
            # --- END MODIFICATION ---

            # Prepend new entry
            current_history.insert(0, notification_entry)

            # Prune immediately after adding
            max_days = self.config.get("NOTIFICATION_HISTORY_DAYS", 30)
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_days)
            pruned_history = []
            for item in current_history:
                try:
                    # Ensure timestamp has timezone info before parsing
                    item_ts_str = item.get("timestamp", "")
                    if "+" not in item_ts_str and "Z" not in item_ts_str:
                        item_ts_str += "+00:00"
                    else:
                        item_ts_str = item_ts_str.replace("Z", "+00:00")
                    item_ts = datetime.fromisoformat(item_ts_str)
                    if item_ts >= cutoff_date:
                        pruned_history.append(item)
                except (ValueError, TypeError, KeyError) as e:
                    log.warning(
                        f"Skipping item with invalid timestamp '{item.get('timestamp')}' during history save/prune: {e} (ID: {item.get('id')})"
                    )

            try:
                # Save the potentially pruned list back
                save_json_atomic(
                    history_file, pruned_history, threading.Lock(), indent=2
                )  # Use dummy lock inside outer lock
                log.info(
                    f"Saved notification history for user '{user_id}' ({len(pruned_history)} entries)."
                )
            except Exception as e:
                log.error(
                    f"Failed to save notification history for user '{user_id}': {e}"
                )
                raise  # Re-raise the exception after logging

    def update_notification_read_status(
        self, user_id: str, notification_id: str, is_read: bool
    ) -> bool:
        """Updates the read status of a specific notification entry in the history list."""
        history_filename = self.config["USER_NOTIFICATIONS_HISTORY_FILENAME"]
        history_file = self._get_user_file_path(user_id, history_filename)
        if not history_file:
            return False
        lock = self.file_locks.get(history_filename)
        if not lock:
            return False

        with lock:
            # --- MODIFIED: Load directly expecting a list ---
            current_history = []
            if history_file.exists() and history_file.stat().st_size > 0:
                try:
                    with open(history_file, "r", encoding="utf-8") as f:
                        loaded_data = json.load(f)
                    if isinstance(loaded_data, list):
                        current_history = loaded_data
                    else:
                        log.warning(
                            f"History file {history_file} is not a list. Cannot update read status."
                        )
                        return False
                except Exception as load_err:
                    log.error(
                        f"Error loading history file {history_file} for read status update: {load_err}"
                    )
                    return False
            # --- END MODIFICATION ---

            updated = False
            for item in current_history:
                if isinstance(item, dict) and item.get("id") == notification_id:
                    item["is_read"] = bool(is_read)
                    updated = True
                    break  # Found and updated

            if updated:
                try:
                    # Save the modified list
                    save_json_atomic(
                        history_file, current_history, threading.Lock(), indent=2
                    )  # Use dummy lock
                    log.info(
                        f"Updated read status for notification {notification_id} for user '{user_id}' to {is_read}."
                    )
                    return True
                except Exception as e:
                    log.error(
                        f"Failed to save updated history for read status change (user {user_id}): {e}"
                    )
                    return False  # Save failed
            else:
                log.warning(
                    f"Notification ID {notification_id} not found for user '{user_id}' during status update."
                )
                return False  # Indicate not found

    def delete_notification_history(
        self, user_id: str, notification_id: Optional[str] = None
    ) -> bool:
        """Deletes a specific notification or all history (list) for a user."""
        history_filename = self.config["USER_NOTIFICATIONS_HISTORY_FILENAME"]
        history_file = self._get_user_file_path(user_id, history_filename)
        if not history_file:
            return False
        lock = self.file_locks.get(history_filename)
        if not lock:
            return False

        with lock:
            # --- MODIFIED: Load directly expecting a list ---
            current_history = []
            if history_file.exists() and history_file.stat().st_size > 0:
                try:
                    with open(history_file, "r", encoding="utf-8") as f:
                        loaded_data = json.load(f)
                    if isinstance(loaded_data, list):
                        current_history = loaded_data
                    else:
                        log.warning(
                            f"History file {history_file} is not a list. Cannot delete entries."
                        )
                        # Treat as success if clearing all, as file will be overwritten anyway
                        return notification_id is None
                except Exception as load_err:
                    log.error(
                        f"Error loading history file {history_file} for deletion: {load_err}"
                    )
                    return False
            # --- END MODIFICATION ---

            deleted = False
            if notification_id:  # Delete single entry
                original_count = len(current_history)
                new_history = [
                    item
                    for item in current_history
                    if not (
                        isinstance(item, dict) and item.get("id") == notification_id
                    )
                ]
                deleted = len(new_history) < original_count
            else:  # Delete all entries
                new_history = []
                deleted = (
                    len(current_history) > 0
                )  # Mark as deleted if list wasn't already empty

            if (
                deleted or notification_id is None
            ):  # Save if deleted specific OR clearing all
                try:
                    # Save the potentially modified list
                    save_json_atomic(
                        history_file, new_history, threading.Lock(), indent=2
                    )  # Use dummy lock
                    if notification_id:
                        if deleted:
                            log.info(
                                f"Deleted notification {notification_id} for user '{user_id}'."
                            )
                        else:
                            log.warning(
                                f"Notification ID {notification_id} not found for deletion for user '{user_id}'."
                            )
                    else:
                        log.info(
                            f"Cleared all notification history for user '{user_id}'."
                        )
                    return True  # Return True if operation completed, even if specific ID wasn't found
                except Exception as e:
                    log.error(
                        f"Failed to save history after deletion (user {user_id}): {e}"
                    )
                    return False  # Save failed
            else:
                # This case means specific ID was requested but not found
                log.warning(
                    f"Notification ID {notification_id} not found for deletion for user '{user_id}'."
                )
                return True  # Return True as operation completed without error, though nothing changed

    # --- Pruning (Keep as is, it already loads/saves correctly based on the fixed methods above) ---
    def prune_notification_history(self, user_id: str):
        """Removes history entries older than the configured retention period."""
        history_filename = self.config["USER_NOTIFICATIONS_HISTORY_FILENAME"]
        history_file = self._get_user_file_path(user_id, history_filename)
        if not history_file or not history_file.exists():
            return  # No file to prune
        lock = self.file_locks.get(history_filename)
        if not lock:
            return

        with lock:
            # --- MODIFIED: Load directly expecting a list ---
            current_history = []
            if history_file.exists() and history_file.stat().st_size > 0:
                try:
                    with open(history_file, "r", encoding="utf-8") as f:
                        loaded_data = json.load(f)
                    if isinstance(loaded_data, list):
                        current_history = loaded_data
                    else:
                        log.warning(
                            f"History file {history_file} is not a list during prune. Cannot prune."
                        )
                        return  # Cannot prune invalid file
                except Exception as load_err:
                    log.error(
                        f"Error loading history file {history_file} for pruning: {load_err}"
                    )
                    return  # Cannot prune if load fails
            # --- END MODIFICATION ---

            if not current_history:
                return  # Nothing to prune

            max_days = self.config.get("NOTIFICATION_HISTORY_DAYS", 30)
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_days)
            original_count = len(current_history)

            pruned_history = []
            for item in current_history:
                try:
                    item_ts_str = item.get("timestamp", "")
                    if "+" not in item_ts_str and "Z" not in item_ts_str:
                        item_ts_str += "+00:00"
                    else:
                        item_ts_str = item_ts_str.replace("Z", "+00:00")
                    item_ts = datetime.fromisoformat(item_ts_str)
                    if item_ts >= cutoff_date:
                        pruned_history.append(item)
                except (ValueError, TypeError, KeyError) as e:
                    log.warning(
                        f"Skipping item with invalid timestamp '{item.get('timestamp')}' during pruning: {e} (ID: {item.get('id')})"
                    )
                    continue  # Skip invalid items

            if len(pruned_history) < original_count:
                try:
                    # Save the pruned list
                    save_json_atomic(
                        history_file, pruned_history, threading.Lock(), indent=2
                    )  # Dummy lock
                    log.info(
                        f"Pruned {original_count - len(pruned_history)} old notification history entries for user '{user_id}'."
                    )
                except Exception as e:
                    log.error(
                        f"Failed to save pruned history for user '{user_id}': {e}"
                    )
            else:
                log.debug(f"No history entries needed pruning for user '{user_id}'.")

    # --- State Files (Geofence, Battery, Notification Times, Cache) ---

    def load_geofence_state(self, user_id: str) -> Dict[Tuple[str, str], str]:
        state_filename = self.config["USER_GEOFENCE_STATE_FILENAME"]
        state_file = self._get_user_file_path(user_id, state_filename)
        if not state_file:
            return {}
        lock = self.file_locks.get(state_filename)
        if not lock:
            log.error(f"Lock for '{state_filename}' not found.")
            return {}
        state_from_file = load_json_file(state_file, lock)
        if state_from_file is None:
            return {}
        parsed_state = {}
        for k, v in state_from_file.items():
            parts = k.split("::", 1)
            if (
                len(parts) == 2
                and isinstance(v, str)
                and v in ["inside", "outside", "unknown"]
            ):
                parsed_state[(parts[0], parts[1])] = v
            else:
                log.warning(
                    f"User '{user_id}': Invalid key/value format in {state_file.name}: {k}={v}"
                )
        log.info(f"Loaded {len(parsed_state)} geofence states for user '{user_id}'")
        return parsed_state

    def save_geofence_state(self, user_id: str, state_dict: Dict[Tuple[str, str], str]):
        state_filename = self.config["USER_GEOFENCE_STATE_FILENAME"]
        state_file = self._get_user_file_path(user_id, state_filename)
        if not state_file:
            raise IOError(
                f"Could not get geofence state file path for user '{user_id}'."
            )
        lock = self.file_locks.get(state_filename)
        if not lock:
            raise RuntimeError(f"Lock for '{state_filename}' not found.")
        if not isinstance(state_dict, dict):
            raise TypeError("Geofence state data must be a dict.")
        state_to_save = {
            f"{k[0]}::{k[1]}": v
            for k, v in state_dict.items()
            if isinstance(k, tuple) and len(k) == 2 and isinstance(v, str)
        }
        try:
            save_json_atomic(state_file, state_to_save, lock, indent=2)
            log.debug(f"Geofence state saved to {state_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save geofence state for user '{user_id}': {e}")
            raise

    def load_battery_state(self, user_id: str) -> Dict[str, str]:
        state_filename = self.config["USER_BATTERY_STATE_FILENAME"]
        state_file = self._get_user_file_path(user_id, state_filename)
        if not state_file:
            return {}
        lock = self.file_locks.get(state_filename)
        if not lock:
            log.error(f"Lock for '{state_filename}' not found.")
            return {}
        state_from_file = load_json_file(state_file, lock)
        if state_from_file is None:
            return {}
        state = {
            k: v
            for k, v in state_from_file.items()
            if isinstance(v, str) and v in ["low", "normal", "unknown"]
        }
        log.info(f"Loaded {len(state)} battery states for user '{user_id}'")
        return state

    def save_battery_state(self, user_id: str, state_dict: Dict[str, str]):
        state_filename = self.config["USER_BATTERY_STATE_FILENAME"]
        state_file = self._get_user_file_path(user_id, state_filename)
        if not state_file:
            raise IOError(
                f"Could not get battery state file path for user '{user_id}'."
            )
        lock = self.file_locks.get(state_filename)
        if not lock:
            raise RuntimeError(f"Lock for '{state_filename}' not found.")
        if not isinstance(state_dict, dict):
            raise TypeError("Battery state data must be a dict.")
        state_to_save = {k: v for k, v in state_dict.items() if isinstance(v, str)}
        try:
            save_json_atomic(state_file, state_to_save, lock, indent=2)
            log.debug(f"Battery state saved to {state_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save battery state for user '{user_id}': {e}")
            raise

    def load_notification_times(self, user_id: str) -> Dict[Tuple[str, str], float]:
        state_filename = self.config["USER_NOTIFICATION_TIMES_FILENAME"]
        state_file = self._get_user_file_path(user_id, state_filename)
        if not state_file:
            return {}
        lock = self.file_locks.get(state_filename)
        if not lock:
            log.error(f"Lock for '{state_filename}' not found.")
            return {}
        state_from_file = load_json_file(state_file, lock)
        if state_from_file is None:
            return {}
        parsed_state = {}
        for k, v in state_from_file.items():
            parts = k.split("::", 1)
            if len(parts) == 2 and isinstance(v, (int, float)):
                try:
                    parsed_state[(parts[0], parts[1])] = float(v)
                except ValueError:
                    log.warning(
                        f"User '{user_id}': Invalid timestamp value in {state_file.name}: {k}={v}"
                    )
            else:
                log.warning(
                    f"User '{user_id}': Invalid key/value format in {state_file.name}: {k}={v}"
                )
        log.info(f"Loaded {len(parsed_state)} notification times for user '{user_id}'")
        return parsed_state

    def save_notification_times(
        self, user_id: str, state_dict: Dict[Tuple[str, str], float]
    ):
        state_filename = self.config["USER_NOTIFICATION_TIMES_FILENAME"]
        state_file = self._get_user_file_path(user_id, state_filename)
        if not state_file:
            raise IOError(
                f"Could not get notification times file path for user '{user_id}'."
            )
        lock = self.file_locks.get(state_filename)
        if not lock:
            raise RuntimeError(f"Lock for '{state_filename}' not found.")
        if not isinstance(state_dict, dict):
            raise TypeError("Notification times data must be a dict.")
        state_to_save = {}
        for k, v in state_dict.items():
            if isinstance(k, tuple) and len(k) == 2 and isinstance(v, (int, float)):
                state_to_save[f"{k[0]}::{k[1]}"] = float(v)
            else:
                log.warning(
                    f"User '{user_id}': Skipping invalid notification time entry during save: Key={k}, Value={v}"
                )
        try:
            save_json_atomic(state_file, state_to_save, lock, indent=2)
            log.debug(f"Notification times saved to {state_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save notification times for user '{user_id}': {e}")
            raise

    def load_cache_from_file(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Loads the cached device data for a user."""
        cache_filename = self.config["USER_CACHE_FILENAME"]
        cache_file = self._get_user_file_path(user_id, cache_filename)
        if not cache_file:
            return None
        lock = self.file_locks.get(cache_filename)
        if not lock:
            log.error(f"Lock for '{cache_filename}' not found.")
            return None

        cache_data = load_json_file(cache_file, lock)
        if cache_data is None:
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
        """Saves the cached device data for a user."""
        cache_filename = self.config["USER_CACHE_FILENAME"]
        cache_file = self._get_user_file_path(user_id, cache_filename)
        if not cache_file:
            raise IOError(f"Could not get cache file path for user '{user_id}'.")
        lock = self.file_locks.get(cache_filename)
        if not lock:
            raise RuntimeError(f"Lock for '{cache_filename}' not found.")

        if not isinstance(cache_data, dict) or "timestamp" not in cache_data:
            raise ValueError("Invalid cache data structure for saving.")
        if "data" not in cache_data and "error" not in cache_data:
            log.warning(
                f"Saving cache for user '{user_id}' with missing 'data' and 'error' keys."
            )

        try:
            save_json_atomic(
                cache_file, cache_data, lock, indent=None
            )  # No indent for cache
            log.debug(f"Cache saved to {cache_file} for user '{user_id}'")
        except Exception as e:
            log.error(f"Failed to save cache for user '{user_id}': {e}")
            raise

    # --- Data Cleanup Operations ---

    def cleanup_user_data_files(self, user_id: str, valid_device_ids: Set[str]):
        """Removes stale entries from state files for devices that no longer exist."""
        log.info(
            f"Running state file cleanup for user '{user_id}' based on {len(valid_device_ids)} valid device(s)."
        )
        try:
            current_gf_state = self.load_geofence_state(user_id)
            keys_to_remove_gf = [
                k for k in current_gf_state if k[0] not in valid_device_ids
            ]
            if keys_to_remove_gf:
                log.info(
                    f"User '{user_id}': Removing {len(keys_to_remove_gf)} stale geofence state entries."
                )
                updated_state = {
                    k: v
                    for k, v in current_gf_state.items()
                    if k not in keys_to_remove_gf
                }
                self.save_geofence_state(user_id, updated_state)
        except Exception as e:
            log.error(f"User '{user_id}': Error cleaning up geofence state: {e}")
        try:
            current_batt_state = self.load_battery_state(user_id)
            keys_to_remove_batt = [
                k for k in current_batt_state if k not in valid_device_ids
            ]
            if keys_to_remove_batt:
                log.info(
                    f"User '{user_id}': Removing {len(keys_to_remove_batt)} stale battery state entries."
                )
                updated_state = {
                    k: v
                    for k, v in current_batt_state.items()
                    if k not in keys_to_remove_batt
                }
                self.save_battery_state(user_id, updated_state)
        except Exception as e:
            log.error(f"User '{user_id}': Error cleaning up battery state: {e}")
        try:
            current_notify_times = self.load_notification_times(user_id)
            keys_to_remove_times = [
                k
                for k in current_notify_times
                if isinstance(k, tuple) and len(k) > 0 and k[0] not in valid_device_ids
            ]
            if keys_to_remove_times:
                log.info(
                    f"User '{user_id}': Removing {len(keys_to_remove_times)} stale notification time entries."
                )
                updated_state = {
                    k: v
                    for k, v in current_notify_times.items()
                    if k not in keys_to_remove_times
                }
                self.save_notification_times(user_id, updated_state)
        except Exception as e:
            log.error(f"User '{user_id}': Error cleaning up notification times: {e}")
        log.info(f"Finished state file cleanup for user '{user_id}'.")

    # --- NEW: Account Deletion ---

    def load_shares(self) -> Dict[str, Dict[str, Any]]:
        """Loads the global shares database (shares.json)."""
        shares_lock = self.file_locks.get("shares")
        if not shares_lock:
            log.error("Lock for 'shares.json' not found.")
            return {}
        # --- FIX: Use correct path joining ---
        shares_file_path = (
            self.data_dir / self.config["SHARES_FILE"].name
        )  # Use name relative to data_dir
        # --- ---------------------------- ---
        shares_data = load_json_file(shares_file_path, shares_lock)
        if shares_data is None:
            # --- FIX: Create empty shares file if it doesn't exist ---
            if not shares_file_path.exists():
                log.warning(
                    f"Shares file {shares_file_path} not found. Creating empty file."
                )
                try:
                    self.save_shares({})  # Save an empty dict initially
                    return {}
                except Exception as e:
                    log.error(f"Failed to create initial shares file: {e}")
                    return {}  # Return empty on creation failure
            else:
                return {}  # Return empty if loading failed but file exists
            # --- -------------------------------------------------- ---
        if not isinstance(shares_data, dict):
            log.error("shares.json format invalid.")
            return {}
        return shares_data

    def save_shares(self, shares_data: Dict[str, Dict[str, Any]]):
        """Saves the global shares database (shares.json)."""
        shares_lock = self.file_locks.get("shares")
        if not shares_lock:
            raise RuntimeError("Share lock missing.")
        if not isinstance(shares_data, dict):
            raise TypeError("shares_data must be dict.")
        # --- FIX: Use correct path joining ---
        shares_file_path = self.data_dir / self.config["SHARES_FILE"].name
        # --- ---------------------------- ---
        try:
            save_json_atomic(shares_file_path, shares_data, shares_lock, indent=2)
            log.info(f"Saved {len(shares_data)} shares to {shares_file_path.name}")
        except Exception as e:
            log.error(f"Failed to save shares data: {e}")
            raise

    def save_shares(self, shares_data: Dict[str, Dict[str, Any]]):
        """Saves the global shares database (shares.json)."""
        shares_lock = self.file_locks.get("shares")
        if not shares_lock:
            raise RuntimeError("Share lock missing.")
        if not isinstance(shares_data, dict):
            raise TypeError("shares_data must be dict.")
        shares_file_path = self.config["DATA_DIRECTORY"] / self.config["SHARES_FILE"]
        try:
            save_json_atomic(shares_file_path, shares_data, shares_lock, indent=2)
            log.info(f"Saved {len(shares_data)} shares to {shares_file_path.name}")
        except Exception as e:
            log.error(f"Failed to save shares data: {e}")
            raise

    def get_active_shared_device_ids_for_user(self, user_id: str) -> Set[str]:
        """Gets a set of device IDs actively shared BY this user."""
        active_ids = set()
        all_shares = self.load_shares()
        now_utc = datetime.now(timezone.utc)
        for share_id, share_data in all_shares.items():
            # Check owner and active status
            if share_data.get("user_id") == user_id and share_data.get("active", False):
                expires_at_str = share_data.get("expires_at")
                # Check expiry
                if expires_at_str:
                    try:
                        expires_at_dt = datetime.fromisoformat(
                            expires_at_str.replace("Z", "+00:00")
                        )
                        if expires_at_dt.tzinfo is None:
                            expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
                        # Only add if not expired
                        if expires_at_dt >= now_utc:
                            device_id = share_data.get("device_id")
                            if device_id:
                                active_ids.add(device_id)
                    except ValueError:
                        log.warning(
                            f"Invalid expiry format checking active shares for user {user_id}, share {share_id}"
                        )
                else:
                    # No expiry date means it's active indefinitely
                    device_id = share_data.get("device_id")
                    if device_id:
                        active_ids.add(device_id)
        return active_ids

    def add_share(
        self,
        user_id: str,
        device_id: str,
        duration_hours: Optional[int],
        note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Creates a new share record."""
        if not user_id or not device_id:
            log.error("Missing user/device ID for share.")
            return None
        share_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        expires_at = None
        if duration_hours is not None and duration_hours > 0:
            expires_at = now + timedelta(hours=duration_hours)
        elif duration_hours == 0:
            expires_at = None  # Indefinite
        else:
            default_duration = self.config.get("DEFAULT_SHARE_DURATION_HOURS", 24)
            if default_duration > 0:
                expires_at = now + timedelta(hours=default_duration)
        new_share = {
            "share_id": share_id,
            "user_id": user_id,
            "device_id": device_id,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat() if expires_at else None,
            "active": True,
            "note": (note or "").strip()[:100],
        }
        try:
            all_shares = self.load_shares()
            all_shares[share_id] = new_share
            self.save_shares(all_shares)
            log.info(
                f"User '{user_id}' created share '{share_id}' for device '{device_id}'. Expires: {new_share['expires_at']}"
            )
            return new_share
        except Exception as e:
            log.exception(
                f"Failed to add share for user '{user_id}', device '{device_id}'"
            )
            return None

    def get_share(self, share_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a specific share record by its ID."""
        all_shares = self.load_shares()
        return all_shares.get(share_id)

    def get_user_shares(self, user_id: str) -> List[Dict[str, Any]]:
        """Retrieves all active shares created by a specific user."""
        all_shares = self.load_shares()
        user_shares = []
        now_utc = datetime.now(timezone.utc)
        for share_id, share_data in all_shares.items():
            if share_data.get("user_id") == user_id:
                is_expired = False
                expires_at_str = share_data.get("expires_at")
                if expires_at_str:
                    try:
                        expires_at_dt = datetime.fromisoformat(
                            expires_at_str.replace("Z", "+00:00")
                        )
                        if expires_at_dt.tzinfo is None:
                            expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
                        if expires_at_dt < now_utc:
                            is_expired = True
                    except ValueError:
                        log.warning(f"Invalid expiry format for share {share_id}")
                        is_expired = True
                # Only include if active flag is True (ignore expiry here, UI can show expired ones if needed)
                # if share_data.get("active", False): # <<< Keep this check
                share_data_with_id = share_data.copy()
                share_data_with_id["share_id"] = share_id
                share_data_with_id["is_expired"] = is_expired  # Add expiry status flag
                user_shares.append(share_data_with_id)
        user_shares.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return user_shares

    # --- START: New Share Management Methods ---
    def toggle_share_status(
        self, share_id: str, requesting_user_id: str, new_status: bool
    ) -> bool:
        """Sets the active status of a share if the requesting user is the owner."""
        try:
            all_shares = self.load_shares()
            share_data = all_shares.get(share_id)

            if not share_data:
                log.warning(f"Toggle status failed: Share ID '{share_id}' not found.")
                return False
            if share_data.get("user_id") != requesting_user_id:
                log.warning(
                    f"Toggle status failed: User '{requesting_user_id}' does not own share '{share_id}'."
                )
                return False

            current_status = share_data.get("active", False)
            if current_status == new_status:
                log.info(
                    f"Share '{share_id}' status is already {new_status}. No change needed."
                )
                return True  # Treat as success if already in desired state

            share_data["active"] = new_status
            self.save_shares(all_shares)
            log.info(
                f"User '{requesting_user_id}' set share '{share_id}' status to {new_status}."
            )
            return True
        except Exception as e:
            log.exception(f"Failed to toggle status for share '{share_id}'")
            return False

    def update_share_expiry(
        self, share_id: str, requesting_user_id: str, new_duration_hours: Optional[int]
    ) -> Optional[Dict]:
        """Updates the expiry time of a share if the requesting user is the owner."""
        try:
            all_shares = self.load_shares()
            share_data = all_shares.get(share_id)

            if not share_data:
                log.warning(f"Update expiry failed: Share ID '{share_id}' not found.")
                return None
            if share_data.get("user_id") != requesting_user_id:
                log.warning(
                    f"Update expiry failed: User '{requesting_user_id}' does not own share '{share_id}'."
                )
                return None

            now = datetime.now(timezone.utc)
            new_expires_at = None
            if new_duration_hours is not None and new_duration_hours > 0:
                new_expires_at = now + timedelta(hours=new_duration_hours)
            elif new_duration_hours == 0:  # Indefinite
                new_expires_at = None
            else:  # Use default if invalid duration provided (e.g., None or negative)
                default_duration = self.config.get("DEFAULT_SHARE_DURATION_HOURS", 24)
                if default_duration > 0:
                    new_expires_at = now + timedelta(hours=default_duration)

            share_data["expires_at"] = (
                new_expires_at.isoformat() if new_expires_at else None
            )
            share_data["note"] = share_data.get(
                "note", ""
            )  # Ensure note exists even if empty

            self.save_shares(all_shares)
            log.info(
                f"User '{requesting_user_id}' updated expiry for share '{share_id}' to {share_data['expires_at']}."
            )
            # Return the updated share data (including share_id)
            updated_share = share_data.copy()
            updated_share["share_id"] = share_id
            return updated_share
        except Exception as e:
            log.exception(f"Failed to update expiry for share '{share_id}'")
            return None

    # --- END: New Share Management Methods ---

    def delete_share_permanently(self, share_id: str, requesting_user_id: str) -> bool:
        """
        Permanently deletes a share record from shares.json if the user is the owner.
        """
        try:
            all_shares = self.load_shares()  # load_shares handles locking for read
            share_data = all_shares.get(share_id)

            if not share_data:
                log.warning(
                    f"Permanent delete failed: Share ID '{share_id}' not found."
                )
                return False  # Not found is not an error, but deletion didn't happen

            if share_data.get("user_id") != requesting_user_id:
                log.warning(
                    f"Permanent delete failed: User '{requesting_user_id}' does not own share '{share_id}'."
                )
                # Consider raising PermissionError here? For now, return False
                return False

            # If checks pass, remove the entry
            del all_shares[share_id]

            # Save the modified dictionary (save_shares handles locking for write)
            self.save_shares(all_shares)
            log.info(
                f"User '{requesting_user_id}' permanently deleted share '{share_id}'."
            )
            return True

        except KeyError:  # Should be caught by the get() check, but safety first
            log.warning(
                f"Permanent delete failed: Share ID '{share_id}' key error during removal attempt."
            )
            return False
        except Exception as e:
            log.exception(f"Failed to permanently delete share '{share_id}'")
            return False  # Indicate failure

    # --- END: New Permanent Delete Method ---

    def revoke_share(self, share_id: str, requesting_user_id: str) -> bool:
        """Revokes a share by setting its status to inactive."""
        # This method now only sets active=False
        log.info(f"Revoking share '{share_id}' by setting active=False (not deleting).")
        return self.toggle_share_status(share_id, requesting_user_id, new_status=False)

    def prune_expired_shares(self):
        # Keep existing logic, but now only needs to check expiry, not active flag
        log.info("Running periodic share pruning...")
        try:
            all_shares = self.load_shares()
            shares_to_keep = {}
            now_utc = datetime.now(timezone.utc)
            removed_count = 0
            for share_id, share_data in all_shares.items():
                is_expired = False
                expires_at_str = share_data.get("expires_at")
                if expires_at_str:
                    try:
                        expires_at_dt = datetime.fromisoformat(
                            expires_at_str.replace("Z", "+00:00")
                        )
                        if expires_at_dt.tzinfo is None:
                            expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
                        if expires_at_dt < now_utc:
                            is_expired = True
                    except ValueError:
                        log.warning(f"Invalid expiry format during pruning {share_id}")
                        is_expired = True
                # Keep shares that are NOT expired (regardless of active status, user manages that)
                if not is_expired:
                    shares_to_keep[share_id] = share_data
                else:
                    log.debug(f"Pruning expired share '{share_id}'")
                    removed_count += 1
            if removed_count > 0:
                self.save_shares(shares_to_keep)
                log.info(f"Successfully pruned {removed_count} expired shares.")
            else:
                log.info("No shares needed pruning based on expiry.")
        except Exception as e:
            log.exception("Error during share pruning")

    def is_device_shared(self, user_id: str, device_id: str) -> bool:
        # Keep existing logic (checks active and expiry)
        all_shares = self.load_shares()
        now_utc = datetime.now(timezone.utc)
        for share_id, share_data in all_shares.items():
            if (
                share_data.get("user_id") == user_id
                and share_data.get("device_id") == device_id
            ):
                if share_data.get("active", False):
                    expires_at_str = share_data.get("expires_at")
                    if expires_at_str:
                        try:
                            expires_at_dt = datetime.fromisoformat(
                                expires_at_str.replace("Z", "+00:00")
                            )
                            if expires_at_dt.tzinfo is None:
                                expires_at_dt = expires_at_dt.replace(
                                    tzinfo=timezone.utc
                                )
                            if expires_at_dt >= now_utc:
                                return True
                        except ValueError:
                            continue
                    else:
                        return True  # Active and never expires
        return False

    def delete_user_data(self, user_id: str) -> bool:
        """
        Deletes a user's entry from users.json, their shares, and their data directory.
        Returns True if user entry is successfully removed, False otherwise.
        """
        if not user_id:
            log.error("Attempted to delete user with empty ID.")
            return False

        log.warning(f"Initiating deletion for user '{user_id}'. This is irreversible.")
        user_removed_from_json = False
        users_lock = self.file_locks.get("users")

        if not users_lock:
            log.error(
                "CRITICAL: Lock for 'users.json' not found. Cannot remove user entry. Aborting delete."
            )
            return False

        # --- Step 1: Remove user from users.json (under lock) ---
        try:
            dummy_lock = threading.Lock()  # Use dummy lock as outer lock is held
            with users_lock:
                all_users = load_json_file(self.users_file, dummy_lock)
                if all_users is None:
                    log.error(
                        f"Could not load users from {self.users_file} during delete."
                    )
                    return False

                if user_id in all_users:
                    log.info(f"Removing user '{user_id}' from {self.users_file.name}")
                    del all_users[user_id]
                    save_json_atomic(self.users_file, all_users, dummy_lock, indent=4)
                    user_removed_from_json = True
                    log.info(f"Successfully removed '{user_id}' from users file.")
                else:
                    log.warning(
                        f"User '{user_id}' not found in users.json (already removed?)."
                    )
                    user_removed_from_json = True  # Treat as success if already gone

        except Exception as e:
            log.exception(
                f"Failed operation within lock while removing user '{user_id}' from users.json."
            )
            return False

        # --- If user removal succeeded, proceed with shares and directory ---
        if user_removed_from_json:
            # --- Step 2: Remove User's Shares ---
            try:
                log.info(f"Removing shares associated with deleted user '{user_id}'.")
                all_shares = self.load_shares()
                shares_to_keep = {
                    sid: sdata
                    for sid, sdata in all_shares.items()
                    if sdata.get("user_id") != user_id
                }
                if len(shares_to_keep) < len(all_shares):
                    self.save_shares(shares_to_keep)
                    log.info(f"Successfully removed shares for user '{user_id}'.")
                else:
                    log.info(f"No shares found to remove for user '{user_id}'.")
            except Exception as e:
                log.exception(f"Failed to remove shares for deleted user '{user_id}'.")
                # Log but continue to directory removal

            # --- Step 3: Delete user directory ---
            user_dir = self.data_dir / user_id
            log.info(f"Attempting to delete user data directory: {user_dir}")
            if user_dir.exists() and user_dir.is_dir():
                try:
                    shutil.rmtree(user_dir)
                    log.info(
                        f"Successfully deleted data directory for user '{user_id}'."
                    )
                except OSError as e:
                    log.error(
                        f"Failed to delete directory {user_dir} for user '{user_id}': {e}"
                    )
                    # Log error but still return True as user account is gone
                except Exception as e:
                    log.exception(
                        f"Unexpected error deleting directory {user_dir} for user '{user_id}'"
                    )
                    # Log error but still return True
            else:
                log.warning(
                    f"User data directory {user_dir} not found or is not a directory. Skipping removal."
                )

            return True  # Return True as the user account was removed from users.json
        else:
            log.error(
                f"Deletion failed because user '{user_id}' not removed from users.json."
            )
            return False

    def delete_device_and_data(self, user_id: str, device_id: str) -> Tuple[bool, str]:
        """
        Deletes a device's source file (.plist/.keys) and removes its related data
        from configuration and state files.

        Args:
            user_id: The ID of the user.
            device_id: The ID of the device to delete.

        Returns:
            A tuple (success: bool, message: str).
        """
        log.warning(f"Attempting to delete device '{device_id}' for user '{user_id}'.")
        user_data_dir = self._get_user_data_dir(user_id)
        if not user_data_dir:
            msg = f"Could not access data directory for user '{user_id}'."
            log.error(msg)
            return False, msg

        source_file_deleted = False
        deleted_filename = "Unknown"

        # --- 1. Delete Source File (.plist or .keys) ---
        # No specific lock needed for single file deletion, OS handles atomicity generally.
        plist_path = user_data_dir / f"{device_id}.plist"
        keys_path = user_data_dir / f"{device_id}.keys"
        file_to_delete = None

        if plist_path.exists():
            file_to_delete = plist_path
        elif keys_path.exists():
            file_to_delete = keys_path

        if file_to_delete:
            try:
                deleted_filename = file_to_delete.name
                os.remove(file_to_delete)
                log.info(f"User '{user_id}': Deleted source file {deleted_filename}.")
                source_file_deleted = True
            except OSError as e:
                msg = f"Failed to delete source file {file_to_delete.name}: {e}"
                log.error(f"User '{user_id}': {msg}")
                # Continue cleanup even if source file deletion fails (might be permissions issue)
                # return False, msg # Option: Halt if source file can't be deleted
        else:
            log.warning(
                f"User '{user_id}': Source file (.plist or .keys) for device '{device_id}' not found. Proceeding with data cleanup."
            )
            # Allow cleanup even if source file is missing

        # --- 2. Clean up JSON files (locking individually) ---
        cleanup_errors = []

        # Helper function to load, modify, save a file atomically with locking
        def cleanup_json_file(filename_key: str, removal_logic):
            json_filename = self.config.get(filename_key)
            if not json_filename:
                log.error(f"Config key '{filename_key}' not found.")
                cleanup_errors.append(f"Config missing for {filename_key}")
                return

            json_file = self._get_user_file_path(user_id, json_filename)
            lock = self.file_locks.get(json_filename)

            if not json_file or not lock:
                log.error(f"Path or lock not found for {json_filename}.")
                cleanup_errors.append(f"Path/lock error for {json_filename}")
                return

            with lock:  # Lock for the read-modify-write operation
                try:
                    # Load using the locked helper (pass dummy lock as outer lock is held)
                    data = load_json_file(json_file, threading.Lock())
                    if data is None:  # File non-existent or invalid
                        log.debug(
                            f"{json_filename} not found or invalid for user '{user_id}', skipping cleanup."
                        )
                        return

                    original_size = len(data)
                    updated_data = removal_logic(
                        data
                    )  # Apply the specific removal logic

                    if len(updated_data) < original_size:
                        # Save using the locked helper (pass dummy lock)
                        save_json_atomic(
                            json_file,
                            updated_data,
                            threading.Lock(),
                            indent=2 if filename_key != "USER_CACHE_FILENAME" else None,
                        )
                        log.info(
                            f"User '{user_id}': Removed '{device_id}' related entries from {json_filename}."
                        )
                    else:
                        log.debug(
                            f"User '{user_id}': No entries for '{device_id}' found in {json_filename}."
                        )

                except Exception as e:
                    msg = f"Failed to process {json_filename} for device '{device_id}': {e}"
                    log.exception(f"User '{user_id}': {msg}")
                    cleanup_errors.append(msg)

        # --- Apply Cleanup Logic for each file ---

        # a) devices.json (Keep as is)
        cleanup_json_file(
            "USER_DEVICES_FILENAME",
            lambda data: {k: v for k, v in data.items() if k != device_id},
        )

        # --- *** CORRECTED Cache Cleanup Logic *** ---
        # b) cache.json
        def remove_from_cache(cache_dict):
            if (
                isinstance(cache_dict, dict)
                and "data" in cache_dict
                and isinstance(cache_dict["data"], dict)
            ):
                # Modify the inner 'data' dictionary
                if device_id in cache_dict["data"]:
                    del cache_dict["data"][device_id]
                    log.debug(
                        f"Removed device '{device_id}' from inner 'data' dict in cache."
                    )
            # Return the potentially modified outer dictionary
            return cache_dict

        cleanup_json_file("USER_CACHE_FILENAME", remove_from_cache)
        # --- *** END CORRECTION *** ---

        # c) geofence_state.json (Keep as is)
        cleanup_json_file(
            "USER_GEOFENCE_STATE_FILENAME",
            lambda data: {
                k: v for k, v in data.items() if not k.startswith(f"{device_id}::")
            },
        )
        # d) battery_state.json (Keep as is)
        cleanup_json_file(
            "USER_BATTERY_STATE_FILENAME",
            lambda data: {k: v for k, v in data.items() if k != device_id},
        )
        # e) notification_times.json (Keep as is)
        cleanup_json_file(
            "USER_NOTIFICATION_TIMES_FILENAME",
            lambda data: {
                k: v for k, v in data.items() if not k.startswith(f"{device_id}::")
            },
        )
        # f) (Optional) notifications_history.json (Keep commented or implement if needed)

        if cleanup_errors:
            final_message = f"Device '{device_id}' source file ({deleted_filename}) deleted (or was missing), but errors occurred during data cleanup: {'; '.join(cleanup_errors)}"
            log.error(f"User '{user_id}': {final_message}")
            return False, final_message
        else:
            final_message = f"Successfully deleted device '{device_id}' ({deleted_filename}) and associated data."
            log.info(f"User '{user_id}': {final_message}")
            return True, final_message
