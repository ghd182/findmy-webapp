# app/auth/routes.py

import logging
from flask import (
    render_template,
    request,
    flash,
    redirect,
    url_for,
    session,
    current_app,
    abort,
)
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash
from urllib.parse import urlparse, urljoin

# Blueprint, User model, LoginManager instance
from . import bp
from app.models import User
from app import login_manager  # No csrf import needed here anymore

# UserDataService for data operations
from app.services.user_data_service import UserDataService

# Import forms
from .forms import LoginForm, RegistrationForm

log = logging.getLogger(__name__)


# --- Helper for safe redirects ---
def is_safe_url(target):
    """Checks if a redirect target URL is safe."""
    if not isinstance(target, str):
        return False
    ref_url = urlparse(request.host_url)
    test_url = urlparse(urljoin(request.host_url, target))
    is_safe = test_url.scheme in ("http", "https") and ref_url.netloc == test_url.netloc
    if not is_safe:
        log.warning(f"Unsafe redirect target detected and blocked: {target}")
    return is_safe


# --- User Loader ---
@login_manager.user_loader
def load_user(user_id):
    """Flask-Login user loader callback."""
    log.debug(f"Flask-Login attempting to load user: {user_id}")
    try:
        user = User.get(user_id)
        if user:
            log.debug(f"User {user_id} loaded successfully by Flask-Login.")
        else:
            log.warning(f"User {user_id} not found during Flask-Login load.")
        return user
    except Exception as e:
        log.error(f"Exception during user load for {user_id}: {e}", exc_info=True)
        return None


# --- Registration Route (Using WTForms) ---
@bp.route("/register", methods=["GET", "POST"])
def register_route():
    if current_user.is_authenticated:
        return redirect(url_for("main.index_route"))
    form = RegistrationForm()
    if form.validate_on_submit():  # CSRF check happens here if enabled globally
        username = form.username.data.strip()
        email = form.email.data.strip().lower()
        password = form.password.data
        uds = UserDataService(current_app.config)
        try:
            existing_users = uds.load_users()
            if any(
                u_data.get("email", "").lower() == email
                for u_data in existing_users.values()
                if u_data.get("email")
            ):
                flash(f"Email address '{email}' is already registered.", "error")
                return render_template("register.html", title="Register", form=form)
        except Exception as e:
            log.error(f"Failed to load users for email uniqueness check: {e}")
            flash("Error checking existing users. Please try again.", "error")
            return render_template("register.html", title="Register", form=form)
        try:
            hashed_password = generate_password_hash(password)
            user_dir = uds._get_user_data_dir(username)
            if not user_dir:
                raise IOError(f"Could not create data directory for user '{username}'.")
            new_user_data = {"email": email, "password_hash": hashed_password}
            existing_users[username] = new_user_data
            uds.save_users(existing_users)
            log.info(f"New user registered: '{username}' ({email})")
            flash(
                f"User '{username}' registered successfully! Please log in.", "success"
            )
            return redirect(url_for(".login_route"))
        except (IOError, TypeError, RuntimeError) as e:
            log.exception(f"Error saving new user '{username}': {e}")
            flash(
                f"An error occurred during registration: {e}. Please try again later.",
                "error",
            )
        except Exception as e:
            log.exception(f"Unexpected error saving new user '{username}': {e}")
            flash(
                "An unexpected error occurred during registration. Please try again later.",
                "error",
            )
    return render_template("register.html", title="Register", form=form)


# --- Login Route (Using WTForms) ---
@bp.route("/login", methods=["GET", "POST"])
def login_route():
    uds = UserDataService(current_app.config)
    first_user_redirect = False
    try:
        existing_users = uds.load_users() # Returns {} on error or empty
        # --- MODIFIED CHECK ---
        # Redirect to register ONLY if the users file was loaded successfully AND is empty
        if isinstance(existing_users, dict) and not existing_users:
             log.warning("No users found in users.json. Redirecting to registration.")
             flash("No users exist yet. Please register the first user.", "info")
             first_user_redirect = True
             return redirect(url_for(".register_route"))
        # --- END MODIFIED CHECK ---
    except Exception as e:
        # Log error if loading users failed, but don't necessarily redirect to register
        log.error(f"Failed to check user existence before login: {e}")
        flash("Warning: Could not verify user database status.", "warning")
        # Allow rendering login form even if user check failed

    # If redirected to register, don't process the login form
    if first_user_redirect:
        return redirect(url_for(".register_route")) # Ensure redirect happens

    # --- Proceed with Login Form ---
    form = LoginForm()
    if form.validate_on_submit():
        # ... (keep existing login logic) ...
        username = form.username.data
        password = form.password.data
        remember = form.remember.data
        log.info(f"Login attempt for user: '{username}'")
        user_obj = User.get(username)
        if user_obj and user_obj.check_password(password):
            login_user(user_obj, remember=remember)
            log.info(f"User '{username}' logged in successfully.")
            session.permanent = remember
            next_page = request.args.get("next")
            if not is_safe_url(next_page):
                log.warning(f"Unsafe 'next' URL: {next_page}. Ignoring.")
                next_page = None
            has_creds = uds.user_has_apple_credentials(username) # Error handled in uds
            log.info(f"User '{username}' creds status: {'Found' if has_creds else 'Not Found'}")

            if next_page: return redirect(next_page)
            elif not has_creds:
                flash("Login successful. Please set your Apple credentials.", "info")
                return redirect(url_for("main.manage_apple_creds_route"))
            else: return redirect(url_for("main.index_route"))
        else:
            log.warning(f"Login failed for user '{username}'. Invalid credentials.")
            flash("Invalid username or password.", "error")

    return render_template("login.html", title="Login", form=form)


# --- Logout Route (Redirect to intermediate page) ---
@bp.route("/logout")
@login_required
def logout_route():
    user_id = current_user.id
    log.info(f"Logout requested for user '{user_id}'.")
    flash_message = "You have been logged out."  # Keep original message base

    # Clear Apple Credentials first (best effort)
    try:
        uds = UserDataService(current_app.config)
        uds.clear_apple_credentials(user_id)
        log.info(f"Cleared stored Apple credentials for user '{user_id}'.")
        # No need to add to flash message, user is going straight to login
    except Exception as e:
        log.error(
            f"Failed to clear Apple credentials for user '{user_id}' during logout: {e}",
            exc_info=True,
        )
        # Add a different flash message if needed, but maybe keep it simple
        flash("Logged out, but failed to clear stored Apple credentials.", "warning")

    # Perform actual logout (clears session, expires remember cookie)
    try:
        logout_user()
        # session.clear() # logout_user() handles the necessary session keys
        log.info(f"User '{user_id}' logged out via Flask-Login.")
    except Exception as e:
        log.error(
            f"Error during Flask-Login logout for user '{user_id}': {e}", exc_info=True
        )
        flash("An error occurred during logout.", "error")  # Add error flash

    # Flash the logout message before redirecting to login
    flash(flash_message, "success")  # Use success category

    log.info(f"Redirecting user '{user_id}' directly to login page.")
    # --- MODIFIED REDIRECT ---
    return redirect(url_for("auth.login_route"))
    # --- ------------------- ---


# --- Intermediate Logged Out Route ---
@bp.route("/logged-out")
def logged_out_route():
    """Displays a confirmation page after logout before redirecting to login."""
    return render_template("logout_success.html", title="Logged Out")
