# test_import.py
try:
    import flask_wtf
    print("Flask-WTF imported successfully")
    print(f"Version: {flask_wtf.__version__}")
    print(f"Path: {flask_wtf.__file__}")
except ImportError as e:
    print(f"Import error: {e}")