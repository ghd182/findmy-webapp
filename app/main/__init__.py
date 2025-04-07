# app/main/__init__.py
from flask import Blueprint

bp = Blueprint('main', __name__, template_folder='../templates', static_folder='../static', static_url_path='/static')

# Import routes and API endpoints after blueprint creation
from . import routes # noqa
from . import api    # noqa