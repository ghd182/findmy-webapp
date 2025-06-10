# File: app/__init__.py
# Purpose: Application factory and initialization.

import os
import logging
import threading
from flask import (
    Flask,
    jsonify,
    url_for,
    g,
    request,
    redirect,
    flash,
    current_app,
    session,
    render_template,
    Response,
    abort,
)
from flask_login import LoginManager, current_user
from apscheduler.schedulers.background import BackgroundScheduler
from flask_wtf.csrf import CSRFProtect
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# --- Initialize Extensions Globally ---
login_manager = LoginManager()
csrf = CSRFProtect()
background_scheduler = BackgroundScheduler(daemon=True)
db = SQLAlchemy()
migrate = Migrate()
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["1000 per day", "500 per hour"],
    storage_uri="memory://",  # Changed from None for explicit in-memory storage
    strategy="fixed-window",  # Or "moving-window"
)
log = logging.getLogger(__name__)

# --- Configure Login Manager ---
login_manager.login_view = "auth.login_route"
login_manager.login_message_category = "info"
login_manager.login_message = "Please log in to access this page."


def create_app():
    """Application Factory Function"""
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    STATIC_DIR = os.path.join(APP_DIR, "static")
    TEMPLATE_DIR = os.path.join(APP_DIR, "templates")

    app = Flask(
        __name__,
        template_folder=TEMPLATE_DIR,
        static_folder=STATIC_DIR,
        static_url_path="/static",  # Ensures /static/... routes work
    )

    # --- 1. Load Config FIRST ---
    from .config import config

    app.config.from_object(config)
    log.info(f"Flask App Created with config: {type(config).__name__}")
    log.info(f"App Root Path: {app.root_path}")
    log.info(f"Static Folder: {app.static_folder}")
    log.info(f"Static URL Path: {app.static_url_path}")
    log.info(f"Data Directory: {app.config['DATA_DIRECTORY']}")
    log.info(f"Database URI: {app.config['SQLALCHEMY_DATABASE_URI']}")
    log.info(
        f"CSRF Protection Enabled (Config): {app.config.get('WTF_CSRF_ENABLED', 'Not Set')}"
    )

    # --- Configure ProxyFix & Session Cookies ---
    app.wsgi_app = ProxyFix(
        app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=0
    )  # x_prefix=0 for standard setups
    log.info("ProxyFix enabled (x_for=1, x_proto=1, x_host=1, x_prefix=0)")

    if not app.config.get("TESTING"):
        app.config.update(
            SESSION_COOKIE_SECURE=True,
            SESSION_COOKIE_HTTPONLY=True,
            SESSION_COOKIE_SAMESITE="Lax",  # Keep Lax for PWA iframes/embeds
            REMEMBER_COOKIE_SECURE=True,
            REMEMBER_COOKIE_HTTPONLY=True,
            REMEMBER_COOKIE_SAMESITE="Lax",
        )
        log.info("Applied secure session cookie settings.")
    else:
        app.config.update(SESSION_COOKIE_SAMESITE="Lax", REMEMBER_COOKIE_SAMESITE="Lax")
        log.info("Applied standard session cookie settings for TESTING.")

    # --- 2. Initialize Extensions WITH App ---
    login_manager.init_app(app)
    csrf.init_app(app)  # Initialize CSRF protection
    db.init_app(app)
    migrate.init_app(app, db)
    limiter.init_app(app)
    app.config["RATELIMIT_ENABLED"] = True  # Ensure limiter is active
    log.info("Flask extensions initialized with app.")

    # --- Initialize File Locks ---
    cache_filename = app.config.get("USER_CACHE_FILENAME")
    if (
        cache_filename
        and cache_filename in config.FILE_LOCKS  # Use the loaded config object
        and config.FILE_LOCKS.get(cache_filename) is None
    ):
        log.info("Initializing file locks (cache)...")
        for key in config.FILE_LOCKS:
            if config.FILE_LOCKS[key] is None:
                config.FILE_LOCKS[key] = threading.Lock()
        log.info("File locks initialization complete.")
    else:
        log.debug("Cache file lock already initialized or not configured.")

    # --- Ensure Data Directory ---
    try:
        app.config["DATA_DIRECTORY"].mkdir(parents=True, exist_ok=True)
        log.info(f"Data directory {app.config['DATA_DIRECTORY']} ensured.")
    except Exception as e:
        log.error(
            f"Failed to create/access data directory {app.config['DATA_DIRECTORY']}: {e}"
        )

    # --- 3. Import Models ---
    from . import models

    # --- 4. Run Data Migration ---
    from .utils.migration_utils import run_data_migration

    try:
        with app.app_context():  # Ensure app context for DB operations
            inspector = db.inspect(db.engine)
            if not inspector.has_table(models.User.__tablename__):
                log.warning("Database tables not found. Running db.create_all().")
                db.create_all()
            else:
                log.debug("Database tables appear to exist.")

            log.info("Checking if data migration from JSON to DB is needed...")
            run_data_migration(app)  # Pass the app object
            log.info("Data migration check complete.")
    except Exception as mig_err:
        log.exception(
            f"CRITICAL ERROR during data migration check/execution: {mig_err}"
        )

    # --- 5. Register Blueprints ---
    log.info("Registering blueprints...")

    from .auth.routes import bp as auth_bp

    app.register_blueprint(auth_bp, url_prefix="/auth")
    log.info("Registered 'auth' blueprint at prefix /auth")

    from .main.routes import bp as main_bp

    app.register_blueprint(main_bp)
    from .main.api import bp as api_bp

    app.register_blueprint(api_bp, url_prefix="/api")
    log.info("Registered 'main' blueprint at / and 'api' blueprint at prefix /api")

    from .public.routes import bp as public_bp

    app.register_blueprint(public_bp, url_prefix="/public")
    log.info("Registered 'public' blueprint at prefix /public")

    # Authentication API (Token generation)
    from .auth_api.routes import bp as auth_api_bp

    app.register_blueprint(
        auth_api_bp, url_prefix="/api/public/auth"
    )  # Ensure this prefix matches CF
    log.info("Registered 'auth_api' blueprint at prefix /api/public/auth")

    # Public Scanner API (Config/Report - Token required)
    from .public_api.routes import bp as public_api_bp

    app.register_blueprint(
        public_api_bp, url_prefix="/api/public/scanner"
    )  # Ensure this prefix matches CF
    log.info("Registered 'public_api' blueprint at prefix /api/public/scanner")

    # --- 6. Initialize Scheduler ---
    if not app.config.get("TESTING", False):
        if not background_scheduler.running:
            log.info("Scheduler not running/initialized, initializing jobs...")
            try:
                from .scheduler.tasks import schedule_jobs

                schedule_jobs(app, background_scheduler)  # Pass app object
                app._scheduler_jobs_added = True
                log.info("Scheduler jobs added.")
            except Exception as e:
                log.error(f"Error scheduling jobs: {e}")
        else:
            log.info("Scheduler reported as already running. Skipping job addition.")
    else:
        log.info("Testing environment detected. Scheduler jobs not scheduled.")

    # --- 7. Request Hooks, Error Handlers, Context Processors ---
    @app.before_request
    def before_request_checks():
        log.debug(
            f"------ Start before_request ({request.method} {request.path}) ------"
        )
        endpoint = request.endpoint
        req_path = request.path
        log.debug(
            f"Endpoint: {endpoint}, Blueprint: {request.blueprint}, Path: {req_path}"
        )

        # --- 1. Check for Authorization Header (Token Auth for /api/public/scanner/*) ---
        # Only apply token check if path STARTS WITH /api/public/scanner/
        if req_path.startswith("/api/public/scanner/"):
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.lower().startswith("bearer "):
                log.debug(
                    f"Authorization header found for '{req_path}'. Letting route decorator (@token_required) handle auth."
                )
                return  # Let the token_required decorator on the route handle it
            else:
                # If it's a scanner path but no token, it's an error (unless some sub-paths are public)
                log.warning(
                    f"Missing or invalid Bearer token for scanner path '{req_path}'."
                )
                # Let the @token_required decorator handle the 401 response if it's applied to the route.
                # If no decorator, it might fall through, but scanner routes SHOULD have it.
                return  # Let route handle it

        # --- 2. Check Public Access (If NO Token Header or not a /api/public/scanner/ path) ---
        # These endpoints are truly public, no token or session needed.
        # Cloudflare handles access to /public/* and /api/public/* (partially).
        # Flask must also allow these specific endpoints to bypass session checks.
        publicly_accessible_endpoints = {
            "static",
            "auth.login_route",
            "auth.register_route",
            "auth.logout_route",
            "auth.logged_out_route",
            "auth.reauth_route",  # Cloudflare re-auth trigger
            "public.view_shared_device",
            "public.get_public_share_data_new",  # Public API for share data
            "public.service_worker",  # Service worker at /public/sw.js
            "public.manifest",  # Manifest at /public/manifest.json
            "public.favicon",  # Favicon at /public/favicon.ico
            "main.service_worker",  # Service worker at /sw.js (root)
            "main.manifest",  # Manifest at /manifest.json (root)
            "main.favicon",  # Favicon at /favicon.ico (root)
            # === Crucial: Make token generation endpoint explicitly public ===
            "auth_api.generate_api_token",  # Endpoint for /api/public/auth/generate_token
        }
        is_root_path = req_path == "/"

        if endpoint in publicly_accessible_endpoints or is_root_path:
            log.info(
                f"Allowing public access to '{req_path}' (Endpoint: {endpoint}, Root: {is_root_path})."
            )
            # Redirect logged-in users from login/register
            if current_user.is_authenticated and endpoint in [
                "auth.login_route",
                "auth.register_route",
            ]:
                log.debug(
                    f"Authenticated user accessing '{endpoint}'. Redirecting to index."
                )
                return redirect(url_for("main.index_route"))
            return  # Request proceeds

        # --- 3. Check Session Authentication (If not handled above) ---
        # At this point, if it's not a token-protected path (/api/public/scanner/*)
        # and not a truly public endpoint, it requires a session.
        log.debug(
            f"'{req_path}' not explicitly public or token-scanner. Requires session auth. Checking..."
        )
        if not current_user.is_authenticated:
            next_url = request.full_path
            log.warning(
                f"Unauthenticated session access to protected endpoint '{endpoint}' at path '{req_path}'. Redirecting to login (next={next_url})."
            )
            flash("Please log in to access this page.", "info")
            return redirect(url_for("auth.login_route", next=next_url))

        # --- 4. User IS Authenticated via Session: Check Apple Credentials if needed ---
        # (This logic remains the same as before)
        log.debug(
            f"User '{current_user.id}' authenticated via session for '{req_path}'. Checking Apple Creds if needed."
        )
        from app.services.user_data_service import UserDataService

        uds = UserDataService(current_app.config)
        creds_optional_session_endpoints = {
            "main.index_route",
            "main.manage_apple_creds_route",
            "api.config_import_apply",
            "api.get_config_part",
            "api.upload_device_file",
            "api.user_preferences",
            "api.delete_account",
            "api.create_device_share",
            "api.get_my_shares",
            "api.set_share_status",
            "api.update_share_duration",
            "api.delete_my_share_permanently",
            "api.get_vapid_public_key",
            "api.subscribe",
            "api.unsubscribe",
            "api.auth.get_2fa_methods",
            "api.auth.request_2fa_code",
            "api.auth.submit_2fa_code",
        }
        if endpoint in creds_optional_session_endpoints:
            log.debug(
                f"Allowing session-authenticated access to creds-optional endpoint '{endpoint}'."
            )
            return
        log.debug(
            f"Endpoint '{endpoint}' requires Apple credentials check for session user '{current_user.id}'."
        )
        try:
            apple_id, _, _ = uds.load_apple_credentials_and_state(current_user.id)
            if not apple_id:
                log.warning(
                    f"User '{current_user.id}' accessing '{endpoint}' requires Apple credentials, which are not set. Redirecting."
                )
                flash(
                    "Apple credentials are required to use this feature. Please set them on the Credentials page.",
                    "warning",
                )
                return redirect(url_for("main.manage_apple_creds_route"))
            log.debug(
                f"Allowing session-authenticated access with credentials present to endpoint '{endpoint}'."
            )
        except Exception as e:
            log.error(
                f"Error checking creds status for user '{current_user.id}': {e}",
                exc_info=True,
            )
            flash(
                "Could not verify Apple credentials status due to an internal error.",
                "danger",
            )
            return redirect(url_for("main.index_route"))

        log.debug(
            f"All session checks passed for user '{current_user.id}' accessing '{endpoint}'. Allowing request."
        )
        return  # Request proceeds

    # --- Error Handlers & Context Processors (Keep as before) ---
    @app.route("/<path:filename>.map")
    def suppress_map_requests(filename):
        log.debug(f"Intercepted and suppressed .map file request: {filename}.map")
        return Response("Not Found", status=404)

    @app.errorhandler(404)
    def not_found_error(error):
        log.warning(f"404 Not Found: {request.url} - {error}")
        # Check if it's an API route
        if (
            request.blueprint == "api"
            or request.blueprint == "public_api"
            or request.blueprint == "auth_api"
        ):
            return jsonify(error="Not Found", message=str(error)), 404
        return render_template("404.html"), 404

    @app.errorhandler(500)
    def internal_error(error):
        log.error(f"500 Internal Server Error: {request.url} - {error}", exc_info=True)
        try:
            db.session.rollback()
            log.info("Rolled back database session due to internal error.")
        except Exception as db_err:
            log.error(f"Error rolling back database session: {db_err}")
        if (
            request.blueprint == "api"
            or request.blueprint == "public_api"
            or request.blueprint == "auth_api"
        ):
            return jsonify(error="Internal Server Error", message=str(error)), 500
        return render_template("500.html"), 500

    @app.errorhandler(400)
    def handle_bad_request_error(e):
        from flask_wtf.csrf import CSRFError

        is_csrf_error = False
        csrf_reason = "Unknown CSRF issue"
        if isinstance(e, CSRFError):
            is_csrf_error = True
            csrf_reason = getattr(e, "description", "CSRF token validation failed")
        elif (
            hasattr(e, "description")
            and isinstance(e.description, str)
            and "CSRF" in e.description
        ):
            is_csrf_error = True
            csrf_reason = e.description

        if is_csrf_error:
            log.warning(
                f"CSRF Validation Failed for {request.method} {request.url}. Reason: {csrf_reason}"
            )
            is_ajax = ("XMLHttpRequest" == request.headers.get("X-Requested-With")) or (
                "application/json" in request.accept_mimetypes
            )
            if is_ajax:
                log.debug(
                    "CSRF error detected on an AJAX request. Returning JSON error."
                )
                return (
                    jsonify(
                        error="CSRF Error",
                        message="Your security token has expired or is invalid. Please reload the page and try again.",
                    ),
                    400,
                )
            else:
                log.debug(
                    "CSRF error detected on a non-AJAX request. Flashing message and redirecting."
                )
                flash(
                    "Your request could not be completed due to a security check failure (CSRF). Please try submitting the form or reloading the page.",
                    "error",
                )
                referrer = request.referrer or url_for("main.index_route")
                if referrer == request.url:
                    referrer = url_for("main.index_route")
                return redirect(referrer)

        log.warning(f"400 Bad Request (Non-CSRF): {request.url} - {e}")
        description = getattr(e, "description", "Invalid request")
        is_ajax_generic = (
            "XMLHttpRequest" == request.headers.get("X-Requested-With")
        ) or ("application/json" in request.accept_mimetypes)

        if (
            request.blueprint == "api"
            or request.blueprint == "public_api"
            or request.blueprint == "auth_api"
            or is_ajax_generic
        ):
            return jsonify(error="Bad Request", message=description), 400
        else:
            try:
                return render_template("400.html", error=description), 400
            except:
                return f"<h1>400 Bad Request</h1><p>{description}</p>", 400

    log.info(f"VAPID Notifications Enabled: {app.config['VAPID_ENABLED']}")
    log.info(f"Password Encryption Enabled: {app.config['ENCRYPTION_ENABLED']}")

    @app.context_processor
    def inject_global_vars():
        def get_static_url(config_path):
            if not config_path:
                return None
            try:
                return url_for("static", filename=config_path, _external=False)
            except RuntimeError:
                log.warning(
                    f"No app context for url_for({config_path}), returning relative path."
                )
                return f"/static/{config_path}"
            except Exception as e:
                log.error(f"Error generating URL for '{config_path}': {e}")
                return None

        default_icon_url = get_static_url(
            app.config.get("DEFAULT_NOTIFICATION_ICON_PATH")
        )
        welcome_icon_url = get_static_url(
            app.config.get("WELCOME_NOTIFICATION_ICON_PATH")
        )
        test_icon_url = get_static_url(app.config.get("TEST_NOTIFICATION_ICON_PATH"))
        default_badge_url = get_static_url(
            app.config.get("DEFAULT_NOTIFICATION_BADGE_PATH")
        )
        geofence_entry_badge_url = get_static_url(
            app.config.get("GEOFENCE_ENTRY_BADGE_PATH")
        )
        geofence_exit_badge_url = get_static_url(
            app.config.get("GEOFENCE_EXIT_BADGE_PATH")
        )
        battery_low_badge_url = get_static_url(app.config.get("BATTERY_LOW_BADGE_PATH"))
        test_badge_url = get_static_url(app.config.get("TEST_BADGE_PATH"))
        welcome_badge_url = get_static_url(app.config.get("WELCOME_BADGE_PATH"))
        return dict(
            VAPID_PUBLIC_KEY=(
                app.config["VAPID_PUBLIC_KEY"] if app.config["VAPID_ENABLED"] else None
            ),
            LOW_BATTERY_THRESHOLD=app.config["LOW_BATTERY_THRESHOLD"],
            APP_VERSION=app.config["APP_VERSION"],
            username=(current_user.id if current_user.is_authenticated else None),
            DEFAULT_NOTIFICATION_ICON_URL=default_icon_url,
            WELCOME_NOTIFICATION_ICON_URL=welcome_icon_url,
            TEST_NOTIFICATION_ICON_URL=test_icon_url,
            DEFAULT_NOTIFICATION_BADGE_URL=default_badge_url,
            GEOFENCE_ENTRY_BADGE_URL=geofence_entry_badge_url,
            GEOFENCE_EXIT_BADGE_URL=geofence_exit_badge_url,
            BATTERY_LOW_BADGE_URL=battery_low_badge_url,
            TEST_BADGE_URL=test_badge_url,
            WELCOME_BADGE_URL=welcome_badge_url,
        )

    return app
