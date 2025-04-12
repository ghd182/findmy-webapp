# app/scheduler/tasks.py
import logging
import time
import threading
import traceback
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, Set, List

# Import services and utilities
from app.services.user_data_service import UserDataService
from app.services.apple_data_service import AppleDataService
from app.services.notification_service import NotificationService

from findmy.reports import AppleAccount, LoginState # Add LoginState
from findmy.errors import UnauthorizedError # Import error for re


# Import scheduler components
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.jobstores.base import ConflictingIdError

log = logging.getLogger(__name__)


# --- Individual User Fetch Task ---
def run_fetch_for_user_task(
    user_id: str, apple_id: str, apple_password: str, config_obj: Dict[str, Any]
):
    """
    Performs the background data fetch and processing for a single user.
    Handles potential re-authentication requirements during fetch.
    """
    log.info(f"Starting background fetch task for user '{user_id}'...")
    task_start_time = time.monotonic()
    uds = UserDataService(config_obj)
    apple_service = AppleDataService(config_obj, uds)
    notifier = NotificationService(config_obj, uds)
    account = None
    login_required_message = "Account re-authentication required. Please go to Credentials page and re-save."

    # 1. Load Credentials AND State
    try:
        # --- Use the NEW method ---
        loaded_apple_id, loaded_password, loaded_state = uds.load_apple_credentials_and_state(user_id)
        # --- -------------------- ---

        # Basic validation - ensure we have at least ID and password from the file
        if not loaded_apple_id or not loaded_password:
            log.warning(f"User '{user_id}': Credentials missing or incomplete in storage. Cannot fetch.")
            # Update cache with error
            uds.save_cache_to_file(user_id, {
                "data": None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "error": "Credentials not configured."
            })
            return

        # Restore or Login
        # Pass the loaded state to perform_account_login
        account, state, login_error = apple_service.perform_account_login(
            loaded_apple_id, loaded_password, loaded_state # Pass loaded state
        )

        if state != LoginState.LOGGED_IN:
            # This handles cases where restoration failed, initial login failed,
            # or restored state wasn't LOGGED_IN (including REQUIRE_2FA).
            # Background task cannot proceed if not LOGGED_IN.
            log.error(f"User '{user_id}': Background fetch cannot proceed. Account not in LOGGED_IN state ({state}). Error: {login_error}")
            cache_error_msg = login_error or "Login/Restore failed."
            # Make 2FA error message clearer for background task
            if state == LoginState.REQUIRE_2FA:
                cache_error_msg = login_required_message
            uds.save_cache_to_file(user_id, {
                "data": None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "error": cache_error_msg
            })
            return # Exit task

        # If we reach here, account is in LOGGED_IN state
        log.info(f"User '{user_id}': Account ready for data fetch.")

    except Exception as e:
        log.exception(f"User '{user_id}': Error during initial credential loading/login in background task.")
        uds.save_cache_to_file(user_id, {
            "data": None, "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": f"Internal error loading credentials: {e}"
        })
        return # Exit task

    # 2. Fetch Accessory Data (account is guaranteed to be LOGGED_IN here)
    fetched_data_dict, fetch_errors, found_device_ids = None, None, set()
    try:
        # --- fetch_accessory_data now requires the account object ---
        fetched_data_dict, fetch_errors, found_device_ids = apple_service.fetch_accessory_data(user_id, account)
        # --- ----------------------------------------------------- ---

    except UnauthorizedError as auth_err:
        # Handle session expiry during fetch
        log.warning(f"User '{user_id}': Authorization error during data fetch ({auth_err}). Re-login might be needed.")
        fetch_errors = login_required_message # Signal user to re-auth interactively
        # Set fetched_data_dict to None so cache gets updated with error
        fetched_data_dict = None
    except Exception as fetch_exc:
        log.exception(f"User '{user_id}': Unhandled exception during fetch_accessory_data")
        fetch_errors = f"Fetch failed unexpectedly: {fetch_exc}"
        fetched_data_dict = None

    # Log any non-fatal errors during fetch (if fetch didn't raise UnauthorizedError)
    if fetch_errors and fetch_errors != login_required_message:
        log.warning(f"User '{user_id}': Fetch encountered non-fatal errors: {fetch_errors}")

    # 3. Process Data & Update Cache (Similar logic as before)
    if fetched_data_dict is not None:
        # ... (Keep the existing logic for saving cache, checking notifications, cleanup) ...
         timestamp_now_iso = datetime.now(timezone.utc).isoformat()
         user_cache_data = {
             "data": fetched_data_dict,
             "timestamp": timestamp_now_iso,
             "error": fetch_errors, # Store non-fatal fetch errors
         }
         uds.save_cache_to_file(user_id, user_cache_data)
         log.info(f"User '{user_id}': Cache updated with {len(fetched_data_dict)} devices.")
         # ... Notification checks ...
         log.info(f"User '{user_id}': Starting notification checks...")
         check_start_time = time.monotonic()
         try:
             user_devices_config_for_notify = uds.load_devices_config(user_id) # Load fresh config
             for device_id, device_data in fetched_data_dict.items():
                 device_config = device_data.get("config") # Use config embedded in fetched data
                 if not device_config: continue
                 latest_report = (device_data["reports"][0] if device_data.get("reports") else None)
                 if latest_report:
                     try:
                         notifier.check_device_notifications(user_id, device_id, latest_report, device_config)
                     except Exception as notify_err:
                         log.exception(f"User '{user_id}': Error checking notifications for {device_id}: {notify_err}")
             log.info(f"User '{user_id}': Notification checks finished in {time.monotonic() - check_start_time:.2f}s.")
         except Exception as e:
             log.error(f"User '{user_id}': Error during notification check phase: {e}", exc_info=True)

         # ... Cleanup ...
         cleanup_start_time = time.monotonic()
         try:
             uds.cleanup_user_data_files(user_id, found_device_ids)
             log.debug(f"User '{user_id}': Stale state cleanup finished in {time.monotonic() - cleanup_start_time:.2f}s.")
         except Exception as e:
             log.error(f"User '{user_id}': Error during state cleanup: {e}")

    else: # Handle fetch failure (including UnauthorizedError caught above)
        log.error(f"User '{user_id}': Background fetch failed or requires re-authentication.")
        # Update cache with the specific fetch error
        uds.save_cache_to_file(user_id, {
            "data": None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": fetch_errors or "Fetch failed: Unknown reason."
        })

    # 4. Save updated account state IF login/fetch didn't require re-auth
    #    (FindMy.py might update internal tokens even during fetch)
    if account and account.login_state == LoginState.LOGGED_IN and fetch_errors != login_required_message:
        try:
            # Save the potentially updated state back (using original credentials)
            uds.save_apple_credentials_and_state(user_id, loaded_apple_id, loaded_password, account.export())
            log.debug(f"User '{user_id}': Saved potentially updated account state after fetch.")
        except Exception as e:
            log.error(f"User '{user_id}': Failed to save updated account state after fetch: {e}")


    # 5. Log Task Completion
    log.info(f"Finished background fetch task for user '{user_id}' in {time.monotonic() - task_start_time:.2f}s.")


# --- Master Scheduler Job ---
def master_fetch_scheduler_job(config_obj: Dict[str, Any]):
    """
    Scheduler job that iterates through registered users and triggers
    individual fetch tasks (`run_fetch_for_user_task`) in separate threads.

    Args:
        config_obj: The application configuration dictionary.
    """
    log.critical(
        "########## PERIODIC 'master_fetch_scheduler_job' EXECUTION STARTING ##########"
    )
    job_start_time = time.monotonic()

    uds = UserDataService(config_obj)  # Initialize service for this job run

    try:
        users = uds.load_users()  # Load list of registered users
    except Exception as e:
        log.error(f"Master fetch: Failed to load users file ({uds.users_file}): {e}")
        log.critical(
            "########## PERIODIC 'master_fetch_scheduler_job' FAILED (Cannot Load Users) ##########"
        )
        return  # Cannot proceed

    if not users:
        log.info("Master fetch: No users found in database. Periodic job exiting.")
        log.critical(
            "########## PERIODIC 'master_fetch_scheduler_job' FINISHED (No Users) ##########"
        )
        return

    users_to_fetch = list(users.keys())
    log.info(
        f"Master fetch: Found {len(users_to_fetch)} users. Checking credentials and spawning tasks..."
    )
    active_threads_before = threading.active_count()

    spawned_count = 0
    skipped_count = 0
    thread_list = []  # Keep track of spawned threads

    for user_id in users_to_fetch:
        try:
            # --- Use the NEW method to load creds and state ---
            apple_id, apple_password, _ = uds.load_apple_credentials_and_state(user_id)
            # --- ------------------------------------------- ---

            # Check if credentials exist (only need password for the task)
            if not apple_id or not apple_password: # Check for decrypted password here
                log.warning(f"Master fetch: Skipping user '{user_id}', credentials missing/incomplete or decryption failed.")
                # ... (keep cache update logic for skipped user) ...
                skipped_count += 1
                continue # Skip to the next user

            # --- Spawn thread with UNENCRYPTED password ---
            log.debug(f"Master fetch: Spawning fetch task thread for user '{user_id}'")
            fetch_thread = threading.Thread(
                target=run_fetch_for_user_task,
                args=(user_id, apple_id, apple_password, config_obj), # Pass UNENCRYPTED password
                name=f"FetchUser-{user_id}", daemon=True,
            )
            fetch_thread.start()
            thread_list.append(fetch_thread)
            spawned_count += 1
            # --- --------------------------------------- ---

        except Exception as e:
            # Catch errors during credential loading or thread spawning for a specific user
            log.error(
                f"Master fetch: Failed to prepare or start fetch thread for user '{user_id}': {e}",
                exc_info=True,  # Log traceback
            )
            # Continue to the next user

    # --- Job Completion Logging ---
    active_threads_after = threading.active_count()
    log.info(
        f"Master fetch scheduler job finished spawning tasks in {time.monotonic() - job_start_time:.2f}s. "
        f"Tasks Spawned: {spawned_count}, Skipped (No Creds): {skipped_count}. "
        f"Threads before: {active_threads_before}, after start: {active_threads_after}."
        # Note: 'active_threads_after' includes the threads just spawned.
    )
    log.critical(
        "########## PERIODIC 'master_fetch_scheduler_job' EXECUTION FINISHED ##########"
    )


# --- Notification History Pruning Job ---
def prune_all_notification_histories_job(config_obj: Dict[str, Any]):
    """
    Scheduler job that iterates through users and prunes old notification history entries.

    Args:
        config_obj: The application configuration dictionary.
    """
    log.info(
        "########## PERIODIC 'prune_notification_history' EXECUTION STARTING ##########"
    )
    job_start_time = time.monotonic()
    uds = UserDataService(config_obj)

    try:
        users = uds.load_users()
    except Exception as e:
        log.error(f"Pruning job: Failed to load users file ({uds.users_file}): {e}")
        log.warning(
            "########## PERIODIC 'prune_notification_history' FAILED (Cannot Load Users) ##########"
        )
        return

    if not users:
        log.info("Pruning job: No users found.")
        log.info(
            "########## PERIODIC 'prune_notification_history' FINISHED (No Users) ##########"
        )
        return

    users_to_prune = list(users.keys())
    log.info(f"Pruning job: Found {len(users_to_prune)} users. Starting pruning...")
    pruned_user_count = 0
    error_count = 0

    for user_id in users_to_prune:
        try:
            # UserDataService.prune_notification_history handles file locking
            uds.prune_notification_history(user_id)
            pruned_user_count += 1
        except Exception as e:
            log.error(
                f"Error pruning notification history for user '{user_id}': {e}",
                exc_info=True,
            )
            error_count += 1

    log.info(
        f"Finished notification history pruning job in {time.monotonic() - job_start_time:.2f}s. "
        f"Users checked: {len(users_to_prune)}, Errors: {error_count}."
    )
    log.info(
        "########## PERIODIC 'prune_notification_history' EXECUTION FINISHED ##########"
    )


# --- NEW: Share Pruning Job ---
def prune_shares_job(config_obj: Dict[str, Any]):
    """Scheduler job that triggers pruning of expired/inactive shares."""
    log.info("########## PERIODIC 'prune_shares_job' EXECUTION STARTING ##########")
    job_start_time = time.monotonic()
    uds = UserDataService(config_obj)

    try:
        uds.prune_expired_shares()
    except Exception as e:
        log.exception("Error occurred during prune_expired_shares execution.")

    log.info(
        f"Finished share pruning job in {time.monotonic() - job_start_time:.2f}s."
    )
    log.info(
        "########## PERIODIC 'prune_shares_job' EXECUTION FINISHED ##########"
    )



# --- Job Scheduling Function ---
def schedule_jobs(app, scheduler_instance: BackgroundScheduler):
    """
    Adds the required background jobs to the APScheduler instance.

    Args:
        app: The Flask application instance (used to get config).
        scheduler_instance: The APScheduler BackgroundScheduler instance.
    """
    config_obj = app.config  # Get config from the app instance

    # --- Schedule Master Fetch Job ---
    fetch_job_id = "master_fetch"
    fetch_interval_minutes = config_obj.get("FETCH_INTERVAL_MINUTES", 15)
    log.info(f"Configured FETCH_INTERVAL_MINUTES = {fetch_interval_minutes}")

    if fetch_interval_minutes <= 0:
        log.error(
            f"Invalid FETCH_INTERVAL_MINUTES ({fetch_interval_minutes}). Fetch job not scheduled."
        )
    elif scheduler_instance.get_job(fetch_job_id):
        log.info(f"Scheduler job '{fetch_job_id}' already exists. Skipping add.")
    else:
        log.info(
            f"Attempting to schedule job '{fetch_job_id}' every {fetch_interval_minutes} minutes."
        )
        try:
            scheduler_instance.add_job(
                master_fetch_scheduler_job,
                trigger=IntervalTrigger(
                    minutes=fetch_interval_minutes,
                    jitter=30,  # Add 30s jitter to spread load
                ),
                args=[config_obj],  # Pass config to the job function
                id=fetch_job_id,
                name="Master User Data Fetch Trigger",
                replace_existing=True,  # Replace if somehow exists with different settings
                misfire_grace_time=max(
                    60, fetch_interval_minutes * 15
                ),  # Allow grace time based on interval
                # Start the first run shortly after app start
                next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            )
            log.info(f"Job '{fetch_job_id}' added successfully.")
        except ConflictingIdError:
            # This shouldn't happen with the get_job check, but handle defensively
            log.warning(f"Scheduler job '{fetch_job_id}' conflict error on add.")
        except Exception as e:
            log.error(
                f"Failed to add scheduler job '{fetch_job_id}': {e}", exc_info=True
            )

    # --- Schedule Notification History Pruning Job ---
    pruning_job_id = "prune_notification_history"
    pruning_interval_hours = 24  # Default: Run once daily

    if scheduler_instance.get_job(pruning_job_id):
        log.info(f"Scheduler job '{pruning_job_id}' already exists. Skipping add.")
    else:
        log.info(
            f"Attempting to schedule job '{pruning_job_id}' every {pruning_interval_hours} hours."
        )
        try:
            scheduler_instance.add_job(
                prune_all_notification_histories_job,
                trigger=IntervalTrigger(
                    hours=pruning_interval_hours, jitter=300  # Add 5 min jitter
                ),
                args=[config_obj],
                id=pruning_job_id,
                name="Prune Notification History",
                replace_existing=True,
                misfire_grace_time=3600,  # Allow 1 hour grace time
                # Start slightly offset from the main fetch job's potential first run
                next_run_time=datetime.now(timezone.utc) + timedelta(minutes=5),
            )
            log.info(f"Job '{pruning_job_id}' added successfully.")
        except ConflictingIdError:
            log.warning(f"Scheduler job '{pruning_job_id}' conflict error on add.")
        except Exception as e:
            log.error(
                f"Failed to add scheduler job '{pruning_job_id}': {e}", exc_info=True
            )

    # --- Schedule Share Pruning Job ---
    share_pruning_job_id = "prune_shares"
    share_pruning_interval_hours = 1 # e.g., Run hourly

    if scheduler_instance.get_job(share_pruning_job_id):
        log.info(f"Scheduler job '{share_pruning_job_id}' already exists. Skipping add.")
    else:
        log.info(f"Attempting to schedule job '{share_pruning_job_id}' every {share_pruning_interval_hours} hours.")
        try:
            scheduler_instance.add_job(
                prune_shares_job,
                trigger=IntervalTrigger(
                    hours=share_pruning_interval_hours,
                    jitter=120 # Add 2 min jitter
                ),
                args=[config_obj],
                id=share_pruning_job_id,
                name="Prune Expired Shares",
                replace_existing=True,
                misfire_grace_time=600, # Allow 10 min grace time
                next_run_time=datetime.now(timezone.utc) + timedelta(minutes=10), # Start slightly offset
            )
            log.info(f"Job '{share_pruning_job_id}' added successfully.")
        except ConflictingIdError:
            log.warning(f"Scheduler job '{share_pruning_job_id}' conflict error on add.")
        except Exception as e:
            log.error(f"Failed to add scheduler job '{share_pruning_job_id}': {e}", exc_info=True)
