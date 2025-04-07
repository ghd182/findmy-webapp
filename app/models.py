# app/models.py
from werkzeug.security import check_password_hash
from flask_login import UserMixin
from flask import current_app
import logging

# Import the user data service (we'll create this next)
# Use a structure that avoids circular imports, e.g., import within methods or pass service instance
# For now, we'll keep the static 'get' method similar to before, but it will use the service internally.

log = logging.getLogger(__name__)

class User(UserMixin):
    """User model for Flask-Login."""
    def __init__(self, id, email=None, password_hash=None):
        self.id = id
        self.email = email
        self.password_hash = password_hash
        log.debug(f"User object created: id={self.id}, email={self.email is not None}")

    @staticmethod
    def get(user_id):
        """Load user by ID using the user data service."""
        # This dynamic import is one way to handle dependencies during initialization
        # A better way is dependency injection but more complex setup
        try:
            from .services.user_data_service import UserDataService
            uds = UserDataService(current_app.config)
            user_data = uds.load_single_user(user_id)
            if user_data:
                log.debug(f"User.get: Found user data for {user_id}")
                return User(
                    id=user_id,
                    email=user_data.get("email"),
                    password_hash=user_data.get("password_hash"),
                )
            else:
                log.debug(f"User.get: No user data found for {user_id}")
                return None
        except ImportError:
            log.error("User.get: Could not import UserDataService. Is the service defined?")
            return None
        except Exception as e:
            log.error(f"User.get: Error loading user {user_id}: {e}")
            return None


    def check_password(self, password):
        """Check password hash."""
        if not self.password_hash or not password:
            log.debug(f"check_password for {self.id}: Hash or provided password empty.")
            return False
        is_valid = check_password_hash(self.password_hash, password)
        log.debug(f"check_password for {self.id}: Password validation result: {is_valid}")
        return is_valid

    # You might add methods here later to interact with user-specific data
    # e.g., get_devices_config(self), get_geofences(self)
    # These would internally call the UserDataService