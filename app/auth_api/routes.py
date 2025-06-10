# File: app/auth_api/routes.py
# Purpose: Defines the API endpoint for generating authentication tokens.

import logging
import secrets
from flask import request, jsonify, current_app
from app.models import User, ApiToken  # Import models
from app import db, limiter, csrf  # Import db, limiter, csrf

# --- Use the blueprint defined in app/auth_api/__init__.py ---
from . import bp

log = logging.getLogger(__name__)


@bp.route("/generate_token", methods=["POST"])  # Route relative to blueprint prefix
@csrf.exempt  # MUST be exempt from CSRF
@limiter.limit("500 per hour")  # Keep rate limiting
def generate_api_token():
    """
    Generates an API token for the user after verifying credentials.
    Expects JSON body: {"username": "...", "password": "..."}
    Returns the plain token ONCE. Client MUST store it securely.
    THIS ROUTE DOES NOT REQUIRE SESSION OR TOKEN AUTH.
    Accessible via /api/public/auth/generate_token if blueprint is registered with /api/public/auth
    """
    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        log.warning("Generate token request missing username or password.")
        return jsonify({"error": "Missing credentials"}), 400

    username = data["username"]
    password = data["password"]
    log.info(
        f"Attempting to generate API token for user: '{username}' (via /api/public/auth/generate_token)"
    )

    user = User.get(username)  # Uses DB

    if user and user.check_password(password):
        log.info(f"User '{username}' credentials verified for token generation.")
        plain_token = secrets.token_urlsafe(32)
        try:
            description = data.get("description", "Android Scanner Token")
            new_api_token = ApiToken(
                user_username=user.username,
                description=description,
            )
            new_api_token.set_token(plain_token)
            db.session.add(new_api_token)
            db.session.commit()
            log.info(
                f"Successfully generated and stored hash for API token for user '{username}'. Description: {description}"
            )
            return (
                jsonify(
                    {
                        "token": plain_token,
                        "message": "Token generated successfully. Store securely!",
                    }
                ),
                201,
            )
        except Exception as e:
            db.session.rollback()
            log.exception(f"Database error saving API token for user '{username}': {e}")
            return jsonify({"error": "Server error generating token"}), 500
    else:
        log.warning(
            f"Token generation failed for user '{username}': Invalid credentials."
        )
        return jsonify({"error": "Invalid username or password"}), 401
