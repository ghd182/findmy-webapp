# app/config.py
# Removed unused specific badge paths, commented out

import os
import logging
from dotenv import load_dotenv
from pathlib import Path
import threading
from datetime import timedelta

# Import the new key generation utilities
from .utils.key_utils import (
    generate_fernet_key_from_seed,
    generate_secret_key_bytes_from_seed,
    generate_vapid_keys_from_seed,
)

load_dotenv()
log = logging.getLogger(__name__)

# --- Environment Variable Seeds ---
VAPID_SEED = os.getenv("VAPID_SEED", "")
FERNET_SEED = os.getenv("FERNET_SEED", "")
SECRET_SEED = os.getenv("SECRET_SEED", "")

# --- Generate Keys from Seeds (if seeds are provided) ---
generated_vapid_private = None
generated_vapid_public = None
generated_fernet_key = None
generated_secret_key_bytes = None

if VAPID_SEED:
    log.info("VAPID_SEED found, attempting to generate VAPID keys...")
    vapid_pair = generate_vapid_keys_from_seed(VAPID_SEED)
    if vapid_pair:
        generated_vapid_private, generated_vapid_public = vapid_pair
        log.info("Successfully generated VAPID keys from seed.")
    # Error is logged within generate_vapid_keys_from_seed

if FERNET_SEED:
    log.info("FERNET_SEED found, attempting to generate Fernet key...")
    generated_fernet_key = generate_fernet_key_from_seed(FERNET_SEED)
    if generated_fernet_key:
        log.info("Successfully generated Fernet key from seed.")
    # Error is logged within generate_fernet_key_from_seed

if SECRET_SEED:
    log.info("SECRET_SEED found, attempting to generate SECRET_KEY...")
    generated_secret_key_bytes = generate_secret_key_bytes_from_seed(SECRET_SEED)
    if generated_secret_key_bytes:
        log.info("Successfully generated SECRET_KEY from seed.")
    # Error is logged within generate_secret_key_bytes_from_seed


class Config:
    """Base configuration."""

    # --- Key Loading Logic ---
    _secret_key_env = os.getenv("SECRET_KEY")
    SECRET_KEY = generated_secret_key_bytes or (
        _secret_key_env.encode("utf-8") if _secret_key_env else None
    )
    _using_fallback_secret = False
    if SECRET_KEY:
        if generated_secret_key_bytes:
            log.info("Using SECRET_KEY generated from SECRET_SEED.")
        elif _secret_key_env:
            log.info("Using SECRET_KEY from environment variable.")
    else:
        log.warning(
            "SECRET_KEY not found via seed or env var. Falling back to insecure os.urandom()."
        )
        SECRET_KEY = os.urandom(32)
        _using_fallback_secret = True

    _fernet_key_env = os.getenv("FERNET_KEY")
    FERNET_KEY = generated_fernet_key or _fernet_key_env
    ENCRYPTION_ENABLED = bool(FERNET_KEY)
    if FERNET_KEY:
        if generated_fernet_key:
            log.info("Using Fernet key generated from FERNET_SEED. Encryption ENABLED.")
        elif _fernet_key_env:
            log.info("Using Fernet key from environment variable. Encryption ENABLED.")
    else:
        log.warning(
            "FERNET_KEY not found via seed or env var. Encryption DISABLED (Using Base64 fallback)!"
        )

    _vapid_private_env = os.getenv("VAPID_PRIVATE_KEY")
    _vapid_public_env = os.getenv("VAPID_PUBLIC_KEY")
    VAPID_PRIVATE_KEY = generated_vapid_private or _vapid_private_env
    VAPID_PUBLIC_KEY = generated_vapid_public or _vapid_public_env
    VAPID_CLAIMS_EMAIL = os.getenv("VAPID_CLAIMS_EMAIL")
    VAPID_ENABLED = bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_CLAIMS_EMAIL)
    if VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY:
        if generated_vapid_private:
            log.info("Using VAPID keys generated from VAPID_SEED.")
        elif _vapid_private_env:
            log.info("Using VAPID keys from environment variables.")
    if not VAPID_ENABLED:
        log.warning(
            "VAPID keys (from seed or env) or claims email not found/incomplete. Push notifications DISABLED."
        )
    elif not VAPID_CLAIMS_EMAIL:
        log.warning(
            "VAPID keys are set, but VAPID_CLAIMS_EMAIL is missing. Push notifications might fail."
        )
    else:
        log.info(
            f"VAPID push notifications ENABLED (Claims Email: {VAPID_CLAIMS_EMAIL})."
        )

    # --- Other Config Variables ---
    DEBUG = False
    TESTING = False
    WTF_CSRF_ENABLED = True
    BASE_DIR = Path(__file__).resolve().parent.parent
    DATA_DIRECTORY = BASE_DIR / "data"
    USERS_FILE = DATA_DIRECTORY / "users.json"
    SHARES_FILE = DATA_DIRECTORY / "shares.json"
    DEFAULT_SHARE_DURATION_HOURS = int(os.getenv("DEFAULT_SHARE_DURATION_HOURS", 24))
    USER_DEVICES_FILENAME = "devices.json"
    USER_GEOFENCES_FILENAME = "geofences.json"
    USER_SUBSCRIPTIONS_FILENAME = "subscriptions.json"
    USER_CACHE_FILENAME = "cache.json"
    USER_GEOFENCE_STATE_FILENAME = "geofence_state.json"
    USER_BATTERY_STATE_FILENAME = "battery_state.json"
    USER_NOTIFICATION_TIMES_FILENAME = "notification_times.json"
    USER_APPLE_CREDS_FILENAME = "apple_credentials.json"
    USER_NOTIFICATIONS_HISTORY_FILENAME = "notifications_history.json"
    NOTIFICATION_HISTORY_DAYS = int(os.getenv("NOTIFICATION_HISTORY_DAYS", 30))
    LOW_BATTERY_THRESHOLD = int(os.getenv("LOW_BATTERY_THRESHOLD", 15))
    NOTIFICATION_COOLDOWN_SECONDS = int(os.getenv("NOTIFICATION_COOLDOWN_SECONDS", 300))
    DEFAULT_FETCH_INTERVAL_MINUTES = int(
        os.getenv("DEFAULT_FETCH_INTERVAL_MINUTES", 15)
    )
    FETCH_INTERVAL_MINUTES = int(os.getenv("FETCH_INTERVAL_MINUTES", 15))
    HISTORY_DURATION_DAYS = int(os.getenv("HISTORY_DURATION_DAYS", 7))
    ANISETTE_SERVERS = [
        s.strip()
        for s in os.getenv("ANISETTE_SERVERS", "http://localhost:6969").split(",")
        if s.strip()
    ]
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
    APP_VERSION = "2.2.1-notif-icon-fix"  # Update version
    SCHEDULER_API_ENABLED = True

    # --- Notification Icons/Badges ---
    DEFAULT_NOTIFICATION_ICON_PATH = os.getenv(
        "DEFAULT_NOTIFICATION_ICON_PATH", "icons/favicon.svg"
    )
    DEFAULT_NOTIFICATION_BADGE_PATH = os.getenv(
        "DEFAULT_NOTIFICATION_BADGE_PATH", "icons/badge-icon.png"
    )
    # --- Keep specific ones if needed by NotificationService logic ---
    GEOFENCE_ENTRY_BADGE_PATH = os.getenv(
        "GEOFENCE_ENTRY_BADGE_PATH", "img/wifi_tethering_16dp.png"
    )  # Still used by current logic
    GEOFENCE_EXIT_BADGE_PATH = os.getenv(
        "GEOFENCE_EXIT_BADGE_PATH", "img/crisis_alert_16dp.png"
    )  # Still used by current logic
    BATTERY_LOW_BADGE_PATH = os.getenv(
        "BATTERY_LOW_BADGE_PATH", "img/battery_warning_16dp.png"
    )  # Still used
    TEST_BADGE_PATH = os.getenv("TEST_BADGE_PATH", "img/labs_16dp.png")  # Still used
    WELCOME_BADGE_PATH = os.getenv(
        "WELCOME_BADGE_PATH", "img/notifications_16dp.png"
    )  # Still used
    WELCOME_NOTIFICATION_ICON_PATH = os.getenv(
        "WELCOME_NOTIFICATION_ICON_PATH", DEFAULT_NOTIFICATION_ICON_PATH
    )
    TEST_NOTIFICATION_ICON_PATH = os.getenv(
        "TEST_NOTIFICATION_ICON_PATH", DEFAULT_NOTIFICATION_ICON_PATH
    )

    FILE_LOCKS = {
        "users": None,
        "shares": None,
        USER_DEVICES_FILENAME: None,
        USER_GEOFENCES_FILENAME: None,
        USER_SUBSCRIPTIONS_FILENAME: None,
        USER_CACHE_FILENAME: None,
        USER_GEOFENCE_STATE_FILENAME: None,
        USER_BATTERY_STATE_FILENAME: None,
        USER_NOTIFICATION_TIMES_FILENAME: None,
        USER_APPLE_CREDS_FILENAME: None,
        USER_NOTIFICATIONS_HISTORY_FILENAME: None,
    }


# --- DevelopmentConfig, ProductionConfig, TestingConfig (Keep as before) ---
class DevelopmentConfig(Config):
    DEBUG = True
    LOG_LEVEL = "DEBUG"
    if not Config.ENCRYPTION_ENABLED:
        log.warning(
            "Running Development without FERNET_KEY (seed or env). Passwords stored insecurely."
        )


class ProductionConfig(Config):
    if not Config.SECRET_KEY or Config._using_fallback_secret:
        log.critical(
            "CRITICAL STARTUP FAILURE: No valid SECRET_KEY found via SECRET_SEED or environment variable for production environment!"
        )
        raise RuntimeError(
            "Missing or insecure SECRET_KEY configuration for production."
        )
    if not Config.ENCRYPTION_ENABLED:
        log.critical(
            "CRITICAL STARTUP FAILURE: Encryption is DISABLED (FERNET_KEY missing via FERNET_SEED or environment variable) in production environment!"
        )
        raise RuntimeError("Missing FERNET_KEY configuration for production.")
    WTF_CSRF_ENABLED = True


class TestingConfig(Config):
    TESTING = True
    SECRET_KEY = (
        generate_secret_key_bytes_from_seed("test-secret-seed")
        or b"fallback-test-key-thirty-two-b"
    )
    FERNET_KEY = generate_fernet_key_from_seed("test-fernet-seed")
    ENCRYPTION_ENABLED = bool(FERNET_KEY)
    VAPID_ENABLED = False
    FETCH_INTERVAL_MINUTES = 9999
    DATA_DIRECTORY = Config.BASE_DIR / "test_data"
    USERS_FILE = DATA_DIRECTORY / "test_users.json"
    WTF_CSRF_ENABLED = False


# --- get_config and lock initialization (Keep as before) ---
def get_config():
    config_name = os.getenv("FLASK_ENV", "production").lower()
    log.info(f"Loading config for FLASK_ENV='{config_name}'")
    if config_name == "development":
        return DevelopmentConfig()
    elif config_name == "production":
        return ProductionConfig()
    elif config_name == "testing":
        return TestingConfig()
    else:
        log.warning(f"Unknown FLASK_ENV='{config_name}'. Defaulting to Production.")
        return ProductionConfig()


config = get_config()
if config.FILE_LOCKS.get("users") is None:
    log.info("Initializing file locks...")
    import threading

    for key in config.FILE_LOCKS:
        if config.FILE_LOCKS[key] is None:
            config.FILE_LOCKS[key] = threading.Lock()
            log.debug(f"Initialized lock for '{key}'")
    log.info("File locks initialization complete.")
