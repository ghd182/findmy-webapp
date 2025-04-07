# app/auth/__init__.py
from flask import Blueprint

# Prefix '/auth' can be added here or during registration in app/__init__.py
# If added here, remove url_prefix from app.register_blueprint
bp = Blueprint('auth', __name__, template_folder='../templates')

# Import routes after blueprint creation to avoid circular imports
from . import routes # noqa