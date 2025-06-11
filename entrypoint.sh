#!/bin/sh
# File: entrypoint.sh (Revised to forcefully fix migration history)
# Purpose: Corrects DB migration state, applies all migrations, then runs the main CMD.

set -e

DB_FILE="/app/data/app.db"

echo "--- FindMy Start-up Script Initializing ---"

# Step 1: Forcefully correct the Alembic revision number if the DB exists.
# This is a safe operation that fixes broken migration histories from previous versions.
if [ -f "$DB_FILE" ]; then
    echo "Database file found. Attempting to fix alembic_version head if necessary..."
    # This sqlite3 command will update the version number ONLY if it's one of the known problematic revisions.
    # This makes the command safe to run on every start. It does nothing on fresh installs or correct databases.
    # The '|| true' ensures the script continues even if this command fails (e.g., table doesn't exist).
    sqlite3 "$DB_FILE" "UPDATE alembic_version SET version_num = '5a8b8bcdeeb1' WHERE version_num IN ('e1b980186eba', 'c5d8a9e7f0b1', 'e1a1b1c1d1e1');" || true
    echo "Alembic version fix attempt complete."
else
    echo "No database file found at $DB_FILE. Assuming fresh installation."
fi

# Step 2: Apply all available migrations to bring the database to the latest version.
# This will now work because the history is corrected.
echo "Step 2: Applying database migrations to head..."
export FLASK_APP=run.py
flask db upgrade -d /app/migrations
upgrade_exit_code=$?

if [ $upgrade_exit_code -ne 0 ]; then
  echo "############################################################"
  echo "!!! CRITICAL ERROR: Database migration upgrade failed with exit code $upgrade_exit_code !!!"
  echo "!!!        The application cannot start. Check logs above.       !!!"
  echo "############################################################"
  exit $upgrade_exit_code
fi

echo "Step 3: Database migrations completed successfully."

# Step 4: Execute the main command passed from the Dockerfile (e.g., waitress-serve).
echo "Step 4: Executing main application command: $@"
exec "$@"