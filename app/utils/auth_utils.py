# File: app/utils/auth_utils.py
import logging
from functools import wraps
from typing import Optional
from datetime import datetime, timezone
from flask import request, jsonify, g, current_app
from werkzeug.security import check_password_hash # Needed for checking token hash
from app.models import User, ApiToken # Import models
from app import db # Import db instance

log = logging.getLogger(__name__)

def token_required(f):
    """Decorator to protect API routes with Bearer token authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        
        log.info(f"Decorator @token_required checking request for: {request.method} {request.path}")
        
        token = None
        # Extract token from Authorization: Bearer header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == 'bearer':
                token = parts[1]
            else:
                log.warning(f"Invalid Authorization header format received for {request.path}")
                return jsonify({"error": "Invalid Authorization header format"}), 401

        if not token:
            log.warning(f"Missing API token in request header for {request.path}")
            return jsonify({"error": "API token is missing"}), 401

        try:
            # Query all tokens - less efficient but necessary as we don't have the hash
            # In a high-volume scenario, consider caching or a more direct lookup if feasible.
            possible_tokens = db.session.execute(db.select(ApiToken)).scalars().all()
            valid_token_found = None
            user_for_token = None

            for api_token_record in possible_tokens:
                if api_token_record.check_token(token): # Check hash
                    if api_token_record.is_valid(): # Check expiry
                        valid_token_found = api_token_record
                        break # Found a valid matching token
                    else:
                        log.warning(f"API token matched but is expired (ID: {api_token_record.id}, User: {api_token_record.user_username})")
                        return jsonify({"error": "API token has expired"}), 401

            if valid_token_found:
                user_for_token = db.session.execute(db.select(User).filter_by(username=valid_token_found.user_username)).scalar_one_or_none()
                if user_for_token:
                    log.debug(f"API token validated for user: {user_for_token.username} (Token ID: {valid_token_found.id}) accessing {request.path}")
                    # Store the authenticated user in Flask's request context (g)
                    g.current_user = user_for_token
                    # Optionally update last_used_at
                    valid_token_found.last_used_at = datetime.now(timezone.utc)
                    db.session.commit() # Commit last used time
                else:
                    log.error(f"API token record (ID: {valid_token_found.id}) validated, but associated user '{valid_token_found.user_username}' not found!")
                    return jsonify({"error": "Invalid token (user not found)"}), 401
            else:
                log.warning(f"Invalid API token provided for {request.path}")
                return jsonify({"error": "Invalid API token"}), 401

        except Exception as e:
            log.exception(f"Error during API token verification for {request.path}: {e}")
            db.session.rollback() # Rollback potential last_used_at update on error
            return jsonify({"error": "Token verification failed"}), 500

        # Proceed with the original route function, g.current_user is set
        return f(*args, **kwargs)
    return decorated_function

def get_current_api_user() -> Optional[User]:
    """Helper function to get the user authenticated via API token from Flask's g."""
    return g.get('current_user', None)