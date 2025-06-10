# File: app/auth_api/__init__.py (NEW FILE)

from flask import Blueprint

# Define a new blueprint specifically for unauthenticated API endpoints
# No URL prefix here, we'll add it during registration
bp = Blueprint('auth_api', __name__)

# Import routes after blueprint creation
from . import routes # noqa