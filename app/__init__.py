# app/__init__.py

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

from .config import config
from .services.user_data_service import UserDataService

login_manager = LoginManager()
login_manager.login_view = "auth.login_route"
login_manager.login_message_category = "info"
login_manager.login_message = "Please log in to access this page."
csrf = CSRFProtect()
background_scheduler = BackgroundScheduler(daemon=True)
log = logging.getLogger(__name__)


def create_app():
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    STATIC_DIR = os.path.join(APP_DIR, "static")
    TEMPLATE_DIR = os.path.join(APP_DIR, "templates")
    app = Flask(
        __name__,
        template_folder=TEMPLATE_DIR,
        static_folder=STATIC_DIR,
        static_url_path="/static",
    )
    app.config.from_object(config)
    log.info(f"Flask App Created with config: {type(config).__name__}")
    log.info(f"App Root Path: {app.root_path}")
    log.info(f"Static Folder: {app.static_folder}")
    log.info(f"Static URL Path: {app.static_url_path}")
    log.info(f"Data Directory: {app.config['DATA_DIRECTORY']}")
    log.info(
        f"CSRF Protection Enabled (Config): {app.config.get('WTF_CSRF_ENABLED', 'Not Set')}"
    )

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=0)

    # --- Initialize Extensions ---
    login_manager.init_app(app)
    csrf.init_app(app)

    # --- Initialize Locks ---
    if "users" in config.FILE_LOCKS and config.FILE_LOCKS["users"] is None:
        log.info("Initializing file locks within create_app...")
        for key in config.FILE_LOCKS:
            if config.FILE_LOCKS[key] is None:
                config.FILE_LOCKS[key] = threading.Lock()
                log.debug(f"Initialized lock for '{key}'")
        log.info("File locks initialization complete.")
    elif "users" not in config.FILE_LOCKS:
        log.error("FILE_LOCKS missing 'users' key. Locks not initialized.")

    # --- Ensure Data Directory and Users File ---
    try:
        app.config["DATA_DIRECTORY"].mkdir(parents=True, exist_ok=True)
        users_file = app.config["USERS_FILE"]
        if not users_file.exists():
            users_lock = config.FILE_LOCKS.get("users")
            if users_lock:
                with users_lock:
                    if not users_file.exists():
                        log.warning(f"Creating empty user file at {users_file}")
                        try:
                            users_file.write_text("{}", encoding="utf-8")
                        except Exception as e:
                            log.error(f"Failed to create {users_file.name}: {e}")
            else:
                log.error("Cannot create users file: Lock for 'users' not found.")
    except Exception as e:
        log.error(
            f"Failed to create/access data directory {app.config['DATA_DIRECTORY']}: {e}"
        )

    # --- Register Blueprints ---
    from .auth.routes import bp as auth_bp

    app.register_blueprint(auth_bp)
    from .main.routes import bp as main_bp

    app.register_blueprint(main_bp)
    from .main.api import bp as api_bp

    app.register_blueprint(api_bp, url_prefix="/api")
    from .public.routes import bp as public_bp

    app.register_blueprint(public_bp, url_prefix="/public")

    # --- Initialize Scheduler ---
    if not app.config.get("TESTING", False):
        scheduler_init_flag = f"SCHEDULER_INITIALIZED_{os.getpid()}_{id(app)}"
        if not background_scheduler.running and not hasattr(
            app, "_scheduler_jobs_added"
        ):
            log.info("Scheduler not running/initialized, initializing jobs...")
            try:
                from .scheduler.tasks import schedule_jobs

                schedule_jobs(app, background_scheduler)
                app._scheduler_jobs_added = True
                log.info("Scheduler jobs added.")
            except Exception as e:
                log.error(f"Error scheduling jobs: {e}")
        elif background_scheduler.running:
            log.info("Scheduler already running.")
        else:
            log.info("Scheduler marked as initialized previously.")
    else:
        log.info("Testing environment detected. Scheduler jobs not scheduled.")

    # --- Request Hook ---
    @app.before_request
    def check_auth_and_creds():
        log.debug(
            f"------ Start before_request ({request.method} {request.path}) ------"
        )
        log.debug(f"Endpoint: {request.endpoint}, Blueprint: {request.blueprint}")
        # --- Allow all requests to the 'public' blueprint ---
        if request.blueprint == "public":
            log.debug("Allowing access to 'public' blueprint endpoint.")
            return

        # --- Allow specific non-blueprint endpoints (like static) ---
        allowed_endpoints_no_login = {
            "static",  # Core static files
            "auth.login_route",
            "auth.register_route",
            "auth.logout_route",
            # --- ADD BACK core asset routes if served by main ---
            "main.manifest",
            "main.favicon",
            "main.service_worker",
            # Add other truly public root endpoints here if any
        }
        endpoint = request.endpoint

        if endpoint in allowed_endpoints_no_login:
            # If logged in, redirect away from login/register
            if current_user.is_authenticated and endpoint in [
                "auth.login_route",
                "auth.register_route",
            ]:
                log.debug(
                    f"Authenticated user accessing public login/register '{endpoint}'. Redirecting."
                )
                return redirect(url_for("main.index_route"))
            log.debug(f"Allowing public access to endpoint '{endpoint}'.")
            return

        # --- Check Authentication for everything else ---
        if not current_user.is_authenticated:
            next_url = request.full_path
            log.info(
                f"Unauthenticated access to protected endpoint '{endpoint}'. Redirecting to login (next={next_url})."
            )
            flash("Please log in to access this page.", "info")
            return redirect(url_for("auth.login_route", next=next_url))

        # --- Check Credentials for authenticated users ---
        creds_optional_endpoints = {
            "main.manage_apple_creds_route",
            "auth.logout_route",
            "api.config_import_apply",
            "api.get_config_part",
            "api.upload_device_file",
            "api.user_preferences",
            "api.delete_account",
            # Add other API endpoints that DON'T need creds (like getting shares?)
            "api.create_device_share",
            "api.get_my_shares",
            "api.set_share_status",
            "api.update_share_duration",
            "api.delete_my_share_permanently",
            "api.get_vapid_public_key",  # Key itself isn't secret
            "api.subscribe",  # Need to be logged in, but maybe not have creds yet
            "api.unsubscribe",
        }
        if endpoint in creds_optional_endpoints:
            log.debug(
                f"Allowing authenticated access to creds-optional endpoint '{endpoint}'."
            )
            return

        # --- Default: Require Apple Credentials ---
        try:
            uds = UserDataService(current_app.config)
            if not uds.user_has_apple_credentials(current_user.id):
                log.warning(
                    f"User '{current_user.id}' accessing '{endpoint}' requires Apple credentials. Redirecting."
                )
                flash(
                    "Apple credentials are required to use this feature. Please set them below.",
                    "warning",
                )
                return redirect(url_for("main.manage_apple_creds_route"))
            log.debug(
                f"Allowing authenticated access with credentials to endpoint '{endpoint}'."
            )
        except Exception as e:
            log.error(
                f"Error checking creds for user '{current_user.id}': {e}", exc_info=True
            )
            flash(
                "Could not verify Apple credentials status due to an internal error.",
                "danger",
            )
            return redirect(url_for("main.index_route"))  # Redirect on error

    @app.route('/<path:filename>.map')
    def suppress_map_requests(filename):
        # Simply return a 404 Not Found response without rendering a template
        # This prevents the TemplateNotFound error for 404.html on these requests
        log.debug(f"Intercepted and suppressed .map file request: {filename}.map")
        return Response("Not Found", status=404)
    # --- End .map file route ---


    # --- Global Error Handlers ---
    @app.errorhandler(404)
    def not_found_error(error):
        log.warning(f"404 Not Found: {request.url} - {error}")
        return render_template("404.html"), 404

    @app.errorhandler(500)
    def internal_error(error):
        log.error(f"500 Internal Server Error: {request.url} - {error}", exc_info=True)
        return render_template("500.html"), 500

    @app.errorhandler(400)  # Catches general 400, including CSRF errors
    def handle_bad_request_error(e):
        from flask_wtf.csrf import CSRFError

        # Check if it's specifically a CSRF error
        is_csrf_error = False
        csrf_reason = "Unknown CSRF issue"
        if isinstance(e, CSRFError):
            is_csrf_error = True
            csrf_reason = getattr(e, "description", "CSRF token validation failed")
            # Sometimes CSRF errors are wrapped, check description
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
            # --- START: Check if it's an AJAX request ---
            is_ajax = (
                request.headers.get("X-Requested-With") == "XMLHttpRequest"
                or "application/json" in request.accept_mimetypes
                or request.headers.get("Accept") == "application/json"
            )  # Common checks

            if is_ajax:
                log.debug(
                    "CSRF error detected on an AJAX request. Returning JSON error."
                )
                return (
                    jsonify(
                        {
                            "error": "CSRF Error",
                            "message": "Your security token has expired or is invalid. Please reload the page and try again.",
                        }
                    ),
                    400,
                )  # Return 400 Bad Request status
            else:
                # --- END: Check AJAX ---
                # Handle non-AJAX CSRF errors (e.g., standard form submissions)
                log.debug(
                    "CSRF error detected on a non-AJAX request. Flashing message and redirecting."
                )
                flash(
                    "Your request could not be completed due to a security check failure (CSRF). Please try submitting the form or reloading the page.",
                    "error",
                )
                referrer = request.referrer or url_for("main.index_route")
                # Avoid redirect loops if referrer is the same page
                if referrer == request.url:
                    referrer = url_for("main.index_route")
                return redirect(referrer)

        # Handle other 400 Bad Request errors (non-CSRF)
        log.warning(f"400 Bad Request (Non-CSRF): {request.url} - {e}")
        description = getattr(e, "description", "Invalid request")
        # Check if it's an AJAX request for generic 400 errors too
        is_ajax_generic = (
            request.headers.get("X-Requested-With") == "XMLHttpRequest"
            or "application/json" in request.accept_mimetypes
            or request.headers.get("Accept") == "application/json"
        )
        if is_ajax_generic:
            return jsonify({"error": "Bad Request", "message": description}), 400
        else:
            try:
                return render_template("400.html", error=description), 400
            except Exception:
                return f"<h1>400 Bad Request</h1><p>{description}</p>", 400

    log.info(f"VAPID Notifications Enabled: {app.config['VAPID_ENABLED']}")
    log.info(f"Password Encryption Enabled: {app.config['ENCRYPTION_ENABLED']}")

    # --- CONTEXT PROCESSOR (Updated) ---
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

        # Icons
        default_icon_url = get_static_url(
            app.config.get("DEFAULT_NOTIFICATION_ICON_PATH")
        )
        welcome_icon_url = get_static_url(
            app.config.get("WELCOME_NOTIFICATION_ICON_PATH")
        )
        test_icon_url = get_static_url(app.config.get("TEST_NOTIFICATION_ICON_PATH"))

        # Badges (using updated config keys)
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
            # Icon URLs
            DEFAULT_NOTIFICATION_ICON_URL=default_icon_url,
            WELCOME_NOTIFICATION_ICON_URL=welcome_icon_url,
            TEST_NOTIFICATION_ICON_URL=test_icon_url,
            # Badge URLs
            DEFAULT_NOTIFICATION_BADGE_URL=default_badge_url,
            GEOFENCE_ENTRY_BADGE_URL=geofence_entry_badge_url,
            GEOFENCE_EXIT_BADGE_URL=geofence_exit_badge_url,
            BATTERY_LOW_BADGE_URL=battery_low_badge_url,
            TEST_BADGE_URL=test_badge_url,
            WELCOME_BADGE_URL=welcome_badge_url,
        )

    # --- End CONTEXT PROCESSOR ---

    return app
