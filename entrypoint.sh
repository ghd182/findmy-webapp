#!/bin/sh
# File: entrypoint.sh (Standard Version)
# Purpose: Applies DB migrations (and exits on failure) and then runs the main CMD

set -e

echo "Entrypoint: Applying database migrations (if any)..."
export FLASK_APP=run.py
flask db upgrade -d /app/migrations
upgrade_exit_code=$?

if [ $upgrade_exit_code -ne 0 ]; then
  echo "############################################################"
  echo "!!! ERROR: Database migration failed with exit code $upgrade_exit_code !!!"
  echo "!!!        Application will not start. Check logs above.  !!!"
  echo "############################################################"
  exit $upgrade_exit_code
fi

echo "Entrypoint: Database migrations completed successfully."

echo "Entrypoint: Executing CMD: $@"
exec "$@"