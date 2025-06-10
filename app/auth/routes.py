# File: app/auth/routes.py
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
from app import login_manager, db

# --- Import the globally defined limiter instance ---
from app import limiter

# UserDataService for data operations
from app.services.user_data_service import UserDataService

# Import forms
from .forms import LoginForm, RegistrationForm

log = logging.getLogger(__name__)


# --- Helper for safe redirects (Keep existing) ---
def is_safe_url(target):
    """Checks if a redirect target URL is safe."""
    if not isinstance(target, str):
        return False
    ref_url = urlparse(request.host_url)
    test_url = urljoin(request.host_url, target)
    is_safe = test_url.scheme in ("http", "https") and ref_url.netloc == test_url.netloc
    if not is_safe:
        log.warning(f"Unsafe redirect target detected and blocked: {target}")
    return is_safe


# --- User Loader (Keep existing) ---
@login_manager.user_loader
def load_user(user_id):
    """Flask-Login user loader callback."""
    log.debug(f"Flask-Login attempting to load user: {user_id}")
    try:
        user = User.get(user_id)  # User.get uses the DB now
        if user:
            log.debug(f"User {user_id} loaded successfully by Flask-Login.")
        else:
            log.warning(f"User {user_id} not found during Flask-Login load.")
        return user
    except Exception as e:
        log.error(f"Exception during user load for {user_id}: {e}", exc_info=True)
        return None


# --- Registration Route (Keep existing) ---
@bp.route("/register", methods=["GET", "POST"])
@limiter.limit("50 per hour")
def register_route():
    if current_user.is_authenticated:
        return redirect(url_for("main.index_route"))
    form = RegistrationForm()
    if form.validate_on_submit():
        username = form.username.data.strip()
        email = form.email.data.strip().lower()
        password = form.password.data
        uds = UserDataService(current_app.config)

        try:
            existing_user_by_email = uds.get_user_by_email(email)
            if existing_user_by_email:
                log.warning(
                    f"Registration failed: Email '{email}' already exists in DB."
                )
                flash(f"Email address '{email}' is already registered.", "error")
                return render_template("register.html", title="Register", form=form)
        except Exception as e:
            log.error(f"Database error during email uniqueness check: {e}")
            flash("Error checking existing users. Please try again.", "error")
            return render_template("register.html", title="Register", form=form)

        try:
            new_user = uds.create_user(username, email, password)
            if new_user:
                log.info(f"New user registered via DB: '{username}' ({email})")
                flash(
                    f"User '{username}' registered successfully! Please log in.",
                    "success",
                )
                return redirect(url_for(".login_route"))
            else:
                flash(
                    "Registration failed. Username or email might already exist, or a server error occurred.",
                    "error",
                )
        except Exception as e:
            log.exception(f"Unexpected error creating user '{username}' via UDS: {e}")
            flash(
                "An error occurred during registration. Please try again later.",
                "error",
            )

    return render_template("register.html", title="Register", form=form)


# --- Login Route (Keep existing) ---
@bp.route("/login", methods=["GET", "POST"])
@limiter.limit("10 per minute;1000 per day")
def login_route():
    uds = UserDataService(current_app.config)
    first_user_redirect = False

    try:
        user_count = db.session.execute(
            db.select(db.func.count(User.id_internal))
        ).scalar_one()
        if user_count == 0:
            log.warning("No users found in database. Redirecting to registration.")
            flash("No users exist yet. Please register the first user.", "info")
            first_user_redirect = True
    except Exception as e:
        log.error(f"Database error checking user existence before login: {e}")
        flash("Warning: Could not verify user database status.", "warning")

    if first_user_redirect:
        return redirect(url_for(".register_route"))

    form = LoginForm()
    if form.validate_on_submit():
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

            has_creds = False
            try:
                has_creds = uds.user_has_apple_credentials(username)
                log.info(
                    f"User '{username}' creds status check: {'Found' if has_creds else 'Not Found'}"
                )
            except Exception as cred_err:
                log.error(
                    f"Error checking Apple creds status for {username} after login: {cred_err}"
                )
                flash(
                    "Login successful, but couldn't check Apple credential status.",
                    "warning",
                )

            if next_page:
                return redirect(next_page)
            elif not has_creds:
                flash("Login successful. Please set your Apple credentials.", "info")
                return redirect(url_for("main.manage_apple_creds_route"))
            else:
                return redirect(url_for("main.index_route"))
        else:
            log.warning(f"Login failed for user '{username}'. Invalid credentials.")
            flash("Invalid username or password.", "error")

    return render_template("login.html", title="Login", form=form)


# --- Logout Route (Keep existing) ---
@bp.route("/logout")
@login_required
def logout_route():
    user_id = current_user.id
    log.info(f"Logout requested for user '{user_id}'.")
    flash_message = "You have been logged out."

    try:
        uds = UserDataService(current_app.config)
        uds.clear_apple_credentials(user_id)
        log.info(f"Cleared stored Apple credentials for user '{user_id}'.")
    except Exception as e:
        log.error(
            f"Failed to clear Apple credentials for user '{user_id}' during logout: {e}",
            exc_info=True,
        )
        flash("Logged out, but failed to clear stored Apple credentials.", "warning")

    try:
        logout_user()
        log.info(f"User '{user_id}' logged out via Flask-Login.")
    except Exception as e:
        log.error(
            f"Error during Flask-Login logout for user '{user_id}': {e}", exc_info=True
        )
        flash("An error occurred during logout.", "error")

    flash(flash_message, "success")
    log.info(f"Redirecting user '{user_id}' directly to login page.")
    return redirect(url_for("auth.login_route"))


# --- Intermediate Logged Out Route (Keep existing) ---
@bp.route("/logged-out")
def logged_out_route():
    """Displays a confirmation page after logout before redirecting to login."""
    return render_template("logout_success.html", title="Logged Out")


@bp.route("/reauth")
@login_required  # Still require app login context conceptually, though CF intercepts first
def reauth_route():
    """
    An uncached endpoint to trigger Cloudflare Access re-authentication.
    Cloudflare intercepts this, and upon successful auth, redirects back.
    This route just redirects to the main page if reached after auth.
    """
    log.info(
        f"User '{current_user.id}' reached /reauth route (likely after Cloudflare auth). Redirecting to main."
    )
    # Redirect to the main application page
    return redirect(url_for("main.index_route"))

