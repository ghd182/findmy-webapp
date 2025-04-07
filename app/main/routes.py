# app/main/routes.py


import logging
from flask import (
    render_template,
    request,
    flash,
    redirect,
    url_for,
    session,
    current_app,
    send_from_directory,
    abort,
    Response,
    make_response,
)

from flask_login import login_required, current_user
import threading
import traceback
import os

from . import bp
from app.services.user_data_service import UserDataService
from app.scheduler.tasks import run_fetch_for_user_task
from app.auth.forms import AppleCredentialsForm

log = logging.getLogger(__name__)

# --- Core Page Routes ---


@bp.route("/")
@login_required
def index_route():
    user_id = current_user.id
    log.debug(f"Rendering index page for user '{user_id}'.")
    return render_template("index.html")


# Serve manifest.json from root
@bp.route("/manifest.json")
def manifest():
    log.debug("Serving manifest.json request from /manifest.json (main blueprint)...")
    static_dir = current_app.static_folder
    manifest_path = os.path.join(static_dir, "manifest.json")
    log.info(f"Attempting to send manifest from: {manifest_path}")
    if not os.path.exists(manifest_path):
        log.error(f"Manifest file not found at: {manifest_path}")
        abort(404)
    try:
        log.info(">>> Sending manifest file now...")
        return send_from_directory(
            os.path.dirname(manifest_path),
            os.path.basename(manifest_path),
            mimetype="application/manifest+json",
        )
    except Exception as e:
        log.exception("Error serving manifest.json")
        abort(500)


@bp.route("/manage_apple_creds", methods=["GET", "POST"])
@login_required
def manage_apple_creds_route():
    user_id = current_user.id
    uds = UserDataService(current_app.config)
    form = AppleCredentialsForm()  # Instantiate the form

    if form.validate_on_submit():  # Handles POST, validation, CSRF
        apple_id = form.apple_id.data.strip()
        apple_password = form.apple_password.data  # No strip

        try:
            uds.save_apple_credentials(user_id, apple_id, apple_password)
            log.info(
                f"User '{user_id}' updated Apple credentials in storage (ID: {apple_id})."
            )
            flash("Apple credentials updated and stored securely.", "success")

            log.info(
                f"Triggering immediate fetch for user '{user_id}' after credential update."
            )
            try:
                # Note: run_fetch_for_user_task should ideally handle decryption itself
                # or we pass the unencrypted password carefully.
                # For now, assume run_fetch_for_user_task expects the unencrypted password.
                immediate_fetch_thread = threading.Thread(
                    target=run_fetch_for_user_task,
                    args=(user_id, apple_id, apple_password, current_app.config),
                    name=f"ImmediateFetch-{user_id}",
                    daemon=True,
                )
                immediate_fetch_thread.start()
                flash("Credentials saved. Initial background fetch initiated.", "info")
            except Exception as e:
                log.error(
                    f"Failed to start immediate fetch thread for user '{user_id}': {e}",
                    exc_info=True,
                )
                flash(
                    "Credentials saved, but initial fetch could not be started.",
                    "warning",
                )

            return redirect(
                url_for(".index_route")
            )  # Redirect to main app after success

        except ValueError as ve:  # Catch specific validation errors from UDS
            log.error(f"Validation error saving credentials for user {user_id}: {ve}")
            flash(f"Failed to save credentials: {ve}", "error")
            # No redirect, fall through to render template again
        except Exception as e:
            log.exception(f"Error saving Apple credentials for user {user_id}")
            flash("Failed to save credentials: An unexpected error occurred.", "error")
            # No redirect, fall through to render template again

    # --- Render the GET request or if validation failed ---
    # Pre-populate the Apple ID field if it exists
    current_apple_id_stored = None
    if not form.is_submitted():  # Only load on GET request
        try:
            current_apple_id_stored, _ = uds.load_apple_credentials(user_id)
            form.apple_id.data = current_apple_id_stored or ""  # Pre-fill form field
            log.debug(
                f"Pre-populating manage_apple_creds form for '{user_id}'. Stored ID: {bool(current_apple_id_stored)}"
            )
        except Exception as e:
            log.error(f"Error loading Apple credentials for form pre-population: {e}")
            flash("Could not load current Apple ID status.", "warning")

    # Pass the form object to the template
    return render_template(
        "manage_apple_creds.html",
        title="Manage Apple Credentials",
        form=form,
        current_apple_id=current_apple_id_stored,
    )

    # --- Render the GET request or if validation failed ---
    # Pre-populate the Apple ID field if it exists
    current_apple_id_stored = None
    if not form.is_submitted():  # Only load on GET request
        try:
            current_apple_id_stored, _ = uds.load_apple_credentials(user_id)
            form.apple_id.data = current_apple_id_stored or ""  # Pre-fill form field
            log.debug(
                f"Pre-populating manage_apple_creds form for '{user_id}'. Stored ID: {bool(current_apple_id_stored)}"
            )
        except Exception as e:
            log.error(f"Error loading Apple credentials for form pre-population: {e}")
            flash("Could not load current Apple ID status.", "warning")

    # Pass the form object to the template
    return render_template(
        "manage_apple_creds.html",
        title="Manage Apple Credentials",
        form=form,
        current_apple_id=current_apple_id_stored,
    )


@bp.route("/sw.js")
def service_worker():
    log.debug("Serving sw.js request...")
    # Construct path relative to the *application root*, not static folder directly
    # Assuming run.py is at the root, and app is a subdir.
    # If static folder is correctly set in Flask, this should work:
    static_dir = current_app.static_folder
    sw_path = os.path.join(static_dir, "sw.js")
    log.info(f"Attempting to send service worker from: {sw_path}")

    if not os.path.exists(sw_path):
        log.error(f"Service worker file not found at: {sw_path}")
        abort(404)
    try:
        response = make_response(
            send_from_directory(
                os.path.dirname(sw_path),
                os.path.basename(sw_path),
                mimetype="application/javascript",
            )
        )
        response.headers["Service-Worker-Allowed"] = "/"
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    except Exception as e:
        log.exception("Error serving sw.js")
        abort(500)


# Keep existing Favicon route (using absolute path generation)
@bp.route("/favicon.ico")
def favicon():
    log.debug("Serving favicon.ico request from /favicon.ico (main blueprint)...")
    try:
        return send_from_directory(
            current_app.static_folder,
            "favicon.ico",
            mimetype="image/vnd.microsoft.icon",
        )
    except Exception as e:
        log.error(f"favicon.ico not found. Error: {e}")
        abort(404)
    except Exception as e:
        # Try absolute path relative to app root as fallback
        try:
            log.warning(
                f"Failed to send favicon from static_folder, trying absolute path construction."
            )
            abs_path = os.path.join(current_app.root_path, "static")
            return send_from_directory(
                abs_path, "favicon.ico", mimetype="image/vnd.microsoft.icon"
            )
        except Exception as e2:
            log.error(
                f"favicon.ico not found in static folder ({current_app.static_folder}) or absolute path. Error: {e2}"
            )
            abort(404)
