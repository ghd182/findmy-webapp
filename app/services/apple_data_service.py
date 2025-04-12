# app/services/apple_data_service.py

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
import base64
from typing import Optional, Dict, Any, Tuple, List, Set

# FindMy library components
from findmy.reports import (
    AppleAccount,
    LoginState,
    RemoteAnisetteProvider,
)
from findmy import FindMyAccessory, KeyPair


from findmy.errors import (
    InvalidCredentialsError,
    UnauthorizedError,
    UnhandledProtocolError,
)


# Import necessary services and utilities
from .user_data_service import UserDataService
from app.utils.helpers import get_available_anisette_server

log = logging.getLogger(__name__)


class AppleDataService:
    """Handles interactions with Apple's Find My service."""

    def __init__(self, config: Dict[str, Any], user_data_service: UserDataService):
        """
        Initializes the service.

        Args:
            config: The Flask app config dictionary.
            user_data_service: An instance of UserDataService.
        """
        self.config = config
        self.uds = user_data_service
        self.history_duration_days = config.get("HISTORY_DURATION_DAYS", 30)

    def perform_account_login(
        self, apple_id: str, apple_password: str, existing_state: Optional[Dict] = None
    ) -> Tuple[Optional[AppleAccount], LoginState, Optional[str]]:
        """
        Logs into an Apple account or restores from existing state.

        Args:
            apple_id: The user's Apple ID.
            apple_password: The user's Apple password (decrypted).
            existing_state: Optional pre-existing account state dict from account.export().

        Returns:
            A tuple containing:
                - The AppleAccount object (or None on failure).
                - The resulting LoginState.
                - An error message string (or None).
        """
        if not apple_id or not apple_password:
            return None, LoginState.LOGGED_OUT, "Apple ID or Password not provided."

        anisette_server_url = get_available_anisette_server(
            self.config.get("ANISETTE_SERVERS", [])
        )
        if not anisette_server_url:
            log.error("Login failed: No Anisette server available.")
            return None, LoginState.LOGGED_OUT, "Authentication service unavailable."

        account = None
        login_result = LoginState.LOGGED_OUT
        error_msg = None

        try:
            provider = RemoteAnisetteProvider(anisette_server_url)
            account = AppleAccount(provider) # Always create a new instance for login/restore attempt

            if existing_state and isinstance(existing_state, dict):
                log.debug(f"Attempting to restore account state for {apple_id}")
                try:
                    account.restore(existing_state)
                    login_result = account.login_state # State after restore
                    log.info(f"Restored account state for {apple_id}: {login_result}")
                    # If restored state is already logged in, we might not need password verification here,
                    # but FindMy.py might re-validate internally on first fetch.
                    # Let's assume background task handles re-auth if needed.
                    if login_result == LoginState.LOGGED_IN:
                         log.info(f"Account for {apple_id} restored to LOGGED_IN state.")
                         # No need to call login again if already logged in
                         return account, login_result, None
                    elif login_result == LoginState.REQUIRE_2FA:
                         log.warning(f"Restored account for {apple_id} is in REQUIRE_2FA state. Needs interactive flow.")
                         # We still need the password to potentially *complete* 2FA later
                         # Store the password temporarily if needed by the calling function (like in the session)
                         return account, login_result, "Restored account requires 2FA completion."
                    else:
                         log.warning(f"Restored account for {apple_id} is in state {login_result}. Attempting full login.")
                         # Fall through to attempt full login if restored state isn't useful

                except Exception as restore_err:
                    log.warning(f"Failed to restore account state for {apple_id}, attempting full login: {restore_err}")
                    # Fall through to full login

            # --- Full Login Attempt (if no state or restore failed/insufficient) ---
            log.debug(f"Attempting full login for {apple_id} using Anisette: {anisette_server_url}")
            login_result = account.login(apple_id, apple_password) # Use the same account instance
            log.info(f"Login attempt result for {apple_id}: {login_result}")

            if login_result == LoginState.LOGGED_IN:
                log.info(f"Successfully logged in Apple account for {apple_id} ({getattr(account, 'first_name', 'N/A')})")
                error_msg = None
            elif login_result == LoginState.REQUIRE_2FA:
                log.warning(f"Login requires 2FA for {apple_id}. Returning account object in 2FA state.")
                error_msg = "Two-Factor Authentication required." # Simple message for now
            elif login_result == LoginState.LOGGED_OUT:
                 # Check for specific errors if FindMy.py provides them, otherwise use generic
                error_detail = "Invalid Apple ID or Password." # Default
                if hasattr(account, 'login_error_detail'): # Hypothetical attribute
                     error_detail = account.login_error_detail
                log.error(f"Authentication failed for {apple_id}: {error_detail}")
                error_msg = f"Authentication failed: {error_detail}"
                account = None # Ensure account is None on outright failure
            else:
                log.error(f"Login failed for {apple_id} with unexpected state: {login_result}")
                error_msg = f"Login failed with unexpected state: {login_result}"
                account = None # Ensure account is None on unexpected failure

        except InvalidCredentialsError as e:
            log.error(f"Login failed for {apple_id}: Invalid Credentials ({e})")
            error_msg = f"Invalid Apple ID or Password."
            login_result = LoginState.LOGGED_OUT
            account = None
        except UnauthorizedError as e:
            log.error(f"Login failed for {apple_id}: Unauthorized ({e})")
            error_msg = f"Authorization error: {e}"
            login_result = LoginState.LOGGED_OUT
            account = None
        except UnhandledProtocolError as e:
            log.error(f"Login failed for {apple_id}: Unhandled Protocol Error ({e})")
            error_msg = f"Communication error with Apple servers: {e}"
            login_result = LoginState.LOGGED_OUT
            account = None
        except Exception as e:
            log.exception(f"An unexpected error occurred during Apple account login/restore for {apple_id}:")
            error_msg = f"An unexpected error occurred during login: {e}"
            login_result = LoginState.LOGGED_OUT
            account = None # Ensure account is None on general exception

        # --- Return the account object, the final state, and any error message ---
        return account, login_result, error_msg

    def _load_private_keys_from_file(self, keys_file_path: Path) -> List[str]:
        """Loads valid base64 private keys from a .keys file."""
        private_keys = []
        KNOWN_IGNORED_PREFIXES = {"advertisement key", "hashed adv key"}
        if not keys_file_path.exists():
            log.error(f"Keys file not found: {keys_file_path}")
            return []
        try:
            with keys_file_path.open("r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split(":", 1)
                    if len(parts) == 2:
                        prefix, key_data = parts[0].strip().lower(), parts[1].strip()
                        if prefix == "private key":
                            try:
                                # Basic validation for Base64 format
                                if len(key_data) > 20 and len(key_data) % 4 == 0:
                                    base64.b64decode(key_data, validate=True)
                                    private_keys.append(key_data)
                                else:
                                    log.warning(
                                        f"Skipping potentially invalid private key data in {keys_file_path.name} (Line {line_num})"
                                    )
                            except Exception:
                                log.warning(
                                    f"Skipping invalid base64 data for 'private key' in {keys_file_path.name} (Line {line_num})"
                                )
                        elif prefix not in KNOWN_IGNORED_PREFIXES:
                            log.warning(
                                f"Skipping unrecognized line format (prefix '{prefix}') in {keys_file_path.name} (Line {line_num})"
                            )
        except Exception as e:
            log.error(f"Error reading keys file {keys_file_path}: {e}")

        if not private_keys:
            log.warning(f"No valid 'private key:' lines found in {keys_file_path.name}")
        return private_keys

    def _create_report_dict(self, report: Any) -> Dict[str, Any]:
        """Converts a FindMy report object/dict to a standardized dictionary with UTC timestamps."""

        def make_utc_aware(dt_input):
            if not dt_input:
                return None
            try:
                if isinstance(dt_input, datetime):
                    # If already timezone-aware, convert to UTC. If naive, assume UTC.
                    return (
                        dt_input.astimezone(timezone.utc)
                        if dt_input.tzinfo
                        else dt_input.replace(tzinfo=timezone.utc)
                    )
                elif isinstance(dt_input, str):
                    dt_str = dt_input.replace("Z", "+00:00")  # Handle Z for UTC
                    # Handle potential microseconds (up to 6 digits) before +/- timezone offset
                    if "." in dt_str:
                        parts = dt_str.split(".")
                        # Find timezone offset start (+ or -)
                        offset_char_index = -1
                        if "+" in parts[1]:
                            offset_char_index = parts[1].find("+")
                        elif "-" in parts[1]:
                            offset_char_index = parts[1].find("-")

                        if offset_char_index != -1:
                            micros = parts[1][:offset_char_index][
                                :6
                            ]  # Take up to 6 digits before offset
                            timezone_part = parts[1][offset_char_index:]
                            dt_str = parts[0] + "." + micros + timezone_part
                        else:  # No offset found after microseconds
                            micros = parts[1][:6]
                            dt_str = parts[0] + "." + micros

                    dt = datetime.fromisoformat(dt_str)
                    # If still naive after parsing, assume UTC
                    return (
                        dt.astimezone(timezone.utc)
                        if dt.tzinfo
                        else dt.replace(tzinfo=timezone.utc)
                    )
            except (ValueError, TypeError) as ve:
                log.warning(f"Could not parse/convert timestamp '{dt_input}': {ve}")
            return None

        ts_aware = make_utc_aware(
            getattr(
                report,
                "timestamp",
                report.get("timestamp") if isinstance(report, dict) else None,
            )
        )
        pub_aware = make_utc_aware(
            getattr(
                report,
                "published_at",
                report.get("published_at") if isinstance(report, dict) else None,
            )
        )

        def get_attr_safe(obj, attr, default=None):
            if isinstance(obj, dict):
                return obj.get(attr, default)
            return getattr(obj, attr, default)

        lat = get_attr_safe(report, "latitude", get_attr_safe(report, "lat"))
        lon = get_attr_safe(report, "longitude", get_attr_safe(report, "lon"))
        h_acc = get_attr_safe(
            report, "horizontal_accuracy", get_attr_safe(report, "horizontalAccuracy")
        )
        alt = get_attr_safe(report, "altitude")
        v_acc = get_attr_safe(
            report, "vertical_accuracy", get_attr_safe(report, "verticalAccuracy")
        )
        batt = get_attr_safe(report, "battery")
        status = get_attr_safe(report, "status")
        desc = get_attr_safe(report, "description")
        conf = get_attr_safe(report, "confidence")
        floor = get_attr_safe(report, "floor")

        return {
            "timestamp": ts_aware.isoformat() if ts_aware else None,
            "published_at": pub_aware.isoformat() if pub_aware else None,
            "lat": float(lat) if lat is not None else None,
            "lon": float(lon) if lon is not None else None,
            "horizontalAccuracy": float(h_acc) if h_acc is not None else None,
            "altitude": float(alt) if alt is not None else None,
            "verticalAccuracy": float(v_acc) if v_acc is not None else None,
            "battery": batt,
            "status": status,
            "description": desc,
            "confidence": conf,
            "floor": floor,
        }

    def fetch_accessory_data(
        self, user_id: str, account: AppleAccount # Now requires a logged-in account object
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str], Set[str]]:
        """
        Fetches historical data for all accessories configured for the user.
        MODIFIED: Now expects a pre-authenticated AppleAccount object.
        """
        # --- Remove the login logic from this function ---
        # It now assumes `account` is already logged in or restored correctly.
        if not account or account.login_state != LoginState.LOGGED_IN:
            log.error(f"fetch_accessory_data called for user '{user_id}' but account is not in LOGGED_IN state ({account.login_state if account else 'None'}).")
            return None, "Account not logged in.", set()

        log.info(f"Starting data fetch for user '{user_id}' using provided account...")

        processed_data: Dict[str, Dict[str, Any]] = {}
        error_messages: List[str] = []
        processed_ids: Set[str] = set()
        
        user_data_dir = self.uds._get_user_data_dir(user_id)
        if not user_data_dir:
            return None, f"Could not access data directory for user '{user_id}'", set()

        # Load fresh device config for this fetch operation
        devices_config = self.uds.load_devices_config(user_id)

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=self.history_duration_days)
        log.info(
            f"User '{user_id}': Fetching report history from {start_date} to {end_date}"
        )

        default_config_structure = {
            "linked_geofences": [],
            "name": None,
            "label": "❓",
            "color": None,
            "model": "Accessory/Tag",
            "icon": "tag",
        }

        # --- Process .plist files ---
        for plist_file in user_data_dir.glob("*.plist"):
            device_id = plist_file.stem
            if (
                not device_id
                or device_id == Path(self.config["USER_APPLE_CREDS_FILENAME"]).stem
            ):
                continue

            processed_ids.add(device_id)
            config = devices_config.get(
                device_id, {**default_config_structure, "name": device_id}
            )
            # *** Store the FULL list of reports ***
            processed_data[device_id] = {"config": config, "reports": []}

            try:
                log.debug(
                    f"User '{user_id}': Fetching history for plist: {plist_file.name}"
                )
                with plist_file.open("rb") as f:
                    accessory = FindMyAccessory.from_plist(f)
                reports_raw: list[Any] = account.fetch_reports(
                    date_from=start_date, date_to=end_date, keys=accessory
                )
                log.debug(
                    f"User '{user_id}': Found {len(reports_raw)} raw reports for {device_id} (plist)"
                )

                if reports_raw:
                    # Convert, sort, and deduplicate reports
                    processed_reports = [
                        self._create_report_dict(r) for r in reports_raw
                    ]
                    # Deduplicate based on timestamp, keeping the latest occurrence if duplicates exist
                    # This assumes timestamps are precise enough, might need adjustment if not
                    unique_reports_map = {
                        r["timestamp"]: r
                        for r in processed_reports
                        if r.get("timestamp")
                    }
                    # Sort by timestamp (newest first)
                    sorted_reports = sorted(
                        list(unique_reports_map.values()),
                        key=lambda r: r["timestamp"],
                        reverse=True,
                    )
                    # *** Store the FULL sorted list ***
                    processed_data[device_id]["reports"] = sorted_reports
                    log.debug(
                        f"User '{user_id}': Stored {len(sorted_reports)} unique reports for {device_id} (plist)"
                    )

            except Exception as e:
                # Handle other fetch errors as before
                msg = f"Error fetching history for {plist_file.name if 'plist_file' in locals() else keys_file.name}: {e}"
                log.exception(f"User '{user_id}': {msg}")
                error_messages.append(msg)
                # Keep the device entry but with empty reports
                device_id = plist_file.stem if 'plist_file' in locals() else keys_file.stem
                if device_id not in processed_data: # Initialize if first error for device
                    processed_data[device_id] = {"config": devices_config.get(device_id,{}), "reports": []}
                processed_data[device_id]["reports"] = [] # Ensure 

        # --- Process .keys files ---
        for keys_file in user_data_dir.glob("*.keys"):
            device_id = keys_file.stem
            if (
                not device_id
                or device_id == Path(self.config["USER_APPLE_CREDS_FILENAME"]).stem
                or device_id in processed_ids
            ):
                continue

            processed_ids.add(device_id)
            config = devices_config.get(
                device_id, {**default_config_structure, "name": device_id}
            )
            # *** Store the FULL list of reports ***
            processed_data[device_id] = {"config": config, "reports": []}
            all_key_reports_raw = []

            try:
                log.debug(f"User '{user_id}': Processing keys file: {keys_file.name}")
                private_keys_b64 = self._load_private_keys_from_file(keys_file)
                if not private_keys_b64:
                    log.warning(
                        f"User '{user_id}': No valid private keys found in {keys_file.name}, skipping fetch."
                    )
                    continue

                for key_b64 in private_keys_b64:
                    try:
                        key_pair = KeyPair.from_b64(key_b64)
                        reports_for_key: list[Any] = account.fetch_reports(
                            date_from=start_date, date_to=end_date, keys=key_pair
                        )
                        if reports_for_key:
                            all_key_reports_raw.extend(reports_for_key)
                    except Exception as key_err:
                        log.error(
                            f"User '{user_id}': Error fetching history for key {key_b64[:10]}... from {keys_file.name}: {key_err}"
                        )

                log.debug(
                    f"User '{user_id}': Found total {len(all_key_reports_raw)} raw reports for {device_id} (keys)"
                )

                if all_key_reports_raw:
                    # Convert, sort, and deduplicate reports
                    processed_reports = [
                        self._create_report_dict(r) for r in all_key_reports_raw
                    ]
                    unique_reports_map = {
                        r["timestamp"]: r
                        for r in processed_reports
                        if r.get("timestamp")
                    }
                    sorted_reports = sorted(
                        list(unique_reports_map.values()),
                        key=lambda r: r["timestamp"],
                        reverse=True,
                    )
                    # *** Store the FULL sorted list ***
                    processed_data[device_id]["reports"] = sorted_reports
                    log.debug(
                        f"User '{user_id}': Stored {len(sorted_reports)} unique reports for {device_id} (keys)"
                    )

            except Exception as e:
                msg = f"Error processing keys file {keys_file.name}: {e}"
                log.exception(f"User '{user_id}': {msg}")
                error_messages.append(msg)
                # Keep the device entry but with empty reports
                processed_data[device_id]["reports"] = []

        # --- Add devices from config that had no data files ---
        all_config_ids = set(devices_config.keys())
        missing_data_ids = all_config_ids - processed_ids
        for device_id in missing_data_ids:
            if device_id not in processed_data:
                log.warning(
                    f"User '{user_id}': Device '{device_id}' found in config but no data file found. Adding with empty reports."
                )
                processed_data[device_id] = {
                    "config": devices_config[device_id],
                    "reports": [],  # Ensure reports key exists
                }
                processed_ids.add(device_id)

        # --- Combine errors and return ---
        combined_error_msg = "; ".join(error_messages) if error_messages else None
        log.info(f"Finished data fetch for user '{user_id}'. Processed {len(processed_ids)} devices. Errors: {combined_error_msg or 'None'}")
        return processed_data, combined_error_msg, processed_ids
