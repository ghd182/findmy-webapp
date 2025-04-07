# run.py
import os
import logging
import signal
import sys
import time
from dotenv import load_dotenv

load_dotenv()

# Import create_app and the background_scheduler instance
from app import create_app, background_scheduler

# --- Logging Setup ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
numeric_level = getattr(logging, LOG_LEVEL, None)
if not isinstance(numeric_level, int):
    logging.warning(f"Invalid LOG_LEVEL '{LOG_LEVEL}'. Defaulting to INFO.")
    LOG_LEVEL = "INFO"
    numeric_level = logging.INFO
logging.basicConfig(
    level=numeric_level,
    format="%(asctime)s - %(levelname)s - [%(threadName)s:%(name)s] - %(message)s",
)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("apscheduler").setLevel(
    logging.INFO
)  # Keep INFO level for debugging startup
logging.getLogger("pywebpush").setLevel(logging.INFO)
logging.getLogger("findmy").setLevel(logging.INFO)
log = logging.getLogger(__name__)
log.critical(
    f"########## LOGGING LEVEL IS SET TO: {LOG_LEVEL} ({logging.getLogger().getEffectiveLevel()}) ##########"
)
# --- End Logging Setup ---

# --- Create the Flask App ---
# This adds the jobs via create_app -> schedule_jobs
log.info("Creating Flask app instance...")
app = create_app()
log.info("Flask app instance created.")

# --- Start Scheduler (Moved Here) ---
# This logic now runs whether run.py is executed directly or imported by WSGI server
if not app.config.get("TESTING", False):
    log.info(
        f"Checking scheduler status before start. Is running: {background_scheduler.running}, State: {background_scheduler.state}"
    )
    if not background_scheduler.running:
        try:
            log.info("Attempting to start the background scheduler...")
            background_scheduler.start()
            time.sleep(0.1)  # Give a moment for state update
            log.info(
                f"Scheduler start() called. Current state: {background_scheduler.state}, Is running: {background_scheduler.running}"
            )
        except Exception as e:
            log.error(f"Failed to start scheduler: {e}", exc_info=True)
    else:
        # This might happen if the WSGI server somehow restarts the worker/thread
        # without restarting the main process where the scheduler was initially started.
        # It's less common with Waitress but good to log.
        log.warning("Scheduler reported as already running before explicit start call.")
else:
    log.info("Detected TESTING environment, scheduler start skipped.")
# --- End Scheduler Start ---


# --- Signal Handling for Graceful Shutdown ---
def shutdown_handler(signum, frame):
    log.warning(f"Received signal {signum}. Shutting down scheduler...")
    # Check if scheduler exists and is running before trying to shut down
    if "background_scheduler" in globals() and background_scheduler.running:
        try:
            background_scheduler.shutdown(wait=False)
            log.info("Scheduler shut down.")
        except Exception as e:
            log.error(f"Error shutting down scheduler: {e}")
    else:
        log.info("Scheduler not running or not initialized, skipping shutdown.")
    log.warning("Exiting application.")
    sys.exit(0)


signal.signal(signal.SIGTERM, shutdown_handler)
signal.signal(signal.SIGINT, shutdown_handler)


# --- Main Execution Block ---
# This block now *only* runs when executing 'python run.py' directly.
# It's primarily for local development or if the Docker CMD was 'python run.py'.
if __name__ == "__main__":
    log.info("Entered __main__ block (direct execution).")
    # The scheduler is already started above. We just need to start Waitress.
    try:
        from waitress import serve

        host = os.getenv("HOST", "0.0.0.0")
        port = int(os.getenv("PORT", 5000))
        threads = int(os.getenv("WAITRESS_THREADS", 4))
        log.info(
            f"Starting Waitress server via __main__ on http://{host}:{port} with {threads} threads..."
        )

        serve(app, host=host, port=port, threads=threads, backlog=2048)

    except ImportError:
        log.critical("Waitress not found! Cannot start server.")
        sys.exit(1)
    except Exception as e:
        log.exception(f"An error occurred starting Waitress via __main__: {e}")
        # Attempt to shut down scheduler before exiting
        if "background_scheduler" in globals() and background_scheduler.running:
            try:
                background_scheduler.shutdown(wait=False)
            except:
                pass
        sys.exit(1)

# This 'else' block runs when the script is imported (e.g., by Waitress via Docker CMD 'run:app')
else:
    log.info(
        "Script imported, not run directly. Assuming WSGI server manages execution. Scheduler started above."
    )
    # No need to do anything here, the scheduler was started globally above,
    # and the WSGI server (Waitress) will serve the 'app' object created earlier.
