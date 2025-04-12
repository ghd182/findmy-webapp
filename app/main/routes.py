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

from app.services.apple_data_service import AppleDataService
from findmy.reports import LoginState  # Import LoginState
from app.utils.helpers import encrypt_password  # Import encrypt helper

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
    apple_service = AppleDataService(current_app.config, uds)  # Need Apple service
    form = AppleCredentialsForm()

    # --- Handle POST (Credential Submission) ---
    if form.validate_on_submit():
        apple_id = form.apple_id.data.strip()
        apple_password = form.apple_password.data  # Raw password

        log.info(
            f"User '{user_id}': Attempting to save/verify Apple credentials for ID {apple_id}."
        )

        # Clear any previous pending 2FA state first
        session.pop("pending_2fa_account_data", None)
        session.pop("pending_2fa_creds", None)

        try:
            # Attempt login (passing NO existing state for a fresh attempt)
            account, login_status, error_msg = apple_service.perform_account_login(
                apple_id, apple_password, existing_state=None
            )

            if login_status == LoginState.LOGGED_IN and account:
                # === SUCCESSFUL LOGIN ===
                log.info(f"User '{user_id}': Login successful during credential save.")
                # Save credentials AND the full state permanently
                uds.save_apple_credentials_and_state(
                    user_id, apple_id, apple_password, account.export()
                )
                flash("Apple credentials verified and saved successfully.", "success")

                # Trigger background fetch
                log.info(
                    f"User '{user_id}': Triggering immediate fetch after successful credential save."
                )
                # (Keep existing fetch trigger logic)
                try:
                    immediate_fetch_thread = threading.Thread(
                        target=run_fetch_for_user_task,
                        args=(user_id, apple_id, apple_password, current_app.config),
                        name=f"ImmediateFetchCredSave-{user_id}",
                        daemon=True,
                    )
                    immediate_fetch_thread.start()
                    flash("Initial background fetch initiated.", "info")
                except Exception as e:
                    log.error(
                        f"Failed starting immediate fetch thread for {user_id}: {e}"
                    )
                    flash(
                        "Credentials saved, but initial fetch failed to start.",
                        "warning",
                    )

                return redirect(url_for(".index_route"))

            elif login_status == LoginState.REQUIRE_2FA and account:
                # === 2FA REQUIRED ===
                log.warning(
                    f"User '{user_id}': Login requires 2FA. Storing pending state in session."
                )
                flash(
                    "Two-Factor Authentication required. Please complete the steps below.",
                    "warning",
                )

                # Store pending state and credentials (unencrypted pw for now) in session
                session["pending_2fa_account_data"] = account.export()
                session["pending_2fa_creds"] = {
                    "apple_id": apple_id,
                    "apple_password_unencrypted": apple_password,  # Store unencrypted temporarily
                }
                session.modified = True  # Ensure session is saved

                # Redirect back to the same page with a status flag
                return redirect(
                    url_for(".manage_apple_creds_route", status="2fa_required")
                )

            else:
                # === LOGIN FAILED ===
                log.error(
                    f"User '{user_id}': Apple credential verification failed: {error_msg}"
                )
                # Add specific flash message for 2FA failure that might lead here
                if "Two-Factor Authentication required" in (error_msg or ""):
                    flash(
                        f"Login Failed: {error_msg}. App-Specific Password might be needed if using SMS/Device Code doesn't work.",
                        "danger login-failed-2fa",
                    )
                else:
                    flash(f"Failed to verify Apple credentials: {error_msg}", "danger")
                # Do NOT redirect, stay on the page to show error

        except Exception as e:
            log.exception(
                f"Unexpected error saving/verifying Apple credentials for user {user_id}"
            )
            flash(f"An unexpected server error occurred: {e}", "danger")
            # Do NOT redirect, stay on page

    # --- Handle GET request ---
    # Check if we are returning from a POST that required 2FA
    is_2fa_pending = (
        request.args.get("status") == "2fa_required"
        and "pending_2fa_account_data" in session
    )
    log.debug(f"GET /manage_apple_creds: is_2fa_pending = {is_2fa_pending}")

    # Pre-populate Apple ID field (only if NOT in 2FA flow, or use session creds if pending)
    current_apple_id_display = None
    if not is_2fa_pending:
        try:
            # Use the new method, but only need the ID for display here
            current_apple_id_display, _, _ = uds.load_apple_credentials_and_state(
                user_id
            )
            if not form.is_submitted():  # Only pre-fill on initial GET
                form.apple_id.data = current_apple_id_display or ""
        except Exception as e:
            log.error(f"Error loading current Apple ID for display: {e}")
            flash("Could not load current Apple ID status.", "warning")
    elif is_2fa_pending and "pending_2fa_creds" in session:
        # If pending 2FA, show the ID the user just entered
        current_apple_id_display = session["pending_2fa_creds"].get("apple_id")
        form.apple_id.data = current_apple_id_display or ""
        form.apple_id.render_kw = {"readonly": True}  # Make field readonly during 2FA
        form.apple_password.render_kw = {
            "readonly": True,
            "placeholder": "********",
        }  # Make password readonly
        form.submit.render_kw = {
            "disabled": True,
            "style": "display: none;",
        }  # Hide original save button

    # Pass status to template
    return render_template(
        "manage_apple_creds.html",
        title="Manage Apple Credentials",
        form=form,
        current_apple_id=current_apple_id_display,
        is_2fa_pending=is_2fa_pending,  # Pass the flag to the template
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
