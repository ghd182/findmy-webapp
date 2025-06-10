# File: app/public_api/__init__.py
# Purpose: Defines the Blueprint for publicly accessible scanner API endpoints.

from flask import Blueprint

# Define the blueprint. The URL prefix will be added during registration.
bp = Blueprint('public_api', __name__)

# Import routes AFTER blueprint creation to avoid circular imports
from . import routes # noqa