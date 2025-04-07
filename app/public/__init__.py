# app/public/__init__.py
from flask import Blueprint

# Note: url_prefix='/public' will be added during registration in app/__init__.py
bp = Blueprint('public', __name__, template_folder='../templates')

# Import routes after blueprint creation
from . import routes # noqa