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
    This function is intended to be run in a separate thread.

    Args:
        user_id: The ID of the user to fetch data for.
        apple_id: The user's Apple ID (decrypted).
        apple_password: The user's Apple password or ASP (decrypted).
        config_obj: The application configuration dictionary.
    """
    log.info(f"Starting background fetch task for user '{user_id}'...")
    task_start_time = time.monotonic()
    uds = UserDataService(config_obj)
    apple_service = AppleDataService(config_obj, uds)
    notifier = NotificationService(config_obj, uds)

    # 1. Perform Login
    account, login_error_msg = apple_service.perform_account_login(
        apple_id, apple_password
    )

    # Handle login failure
    if login_error_msg or not account:
        log.error(
            f"User '{user_id}': Background fetch failed during login: {login_error_msg}"
        )
        try:
            user_cache = uds.load_cache_from_file(user_id) or {"data": None}
            # *** IMPROVED ERROR MESSAGE FOR CACHE ***
            cache_error_msg = login_error_msg or "Login failed: Unknown reason."
            if "Two-Factor Authentication required" in cache_error_msg:
                cache_error_msg = (
                    "Login Failed: 2FA Required. Use App-Specific Password."
                )
            # *** END IMPROVEMENT ***
            user_cache["error"] = cache_error_msg  # Store user-friendlier message
            user_cache["timestamp"] = datetime.now(timezone.utc).isoformat()
            uds.save_cache_to_file(user_id, user_cache)
            log.debug(
                f"User '{user_id}': Updated cache with login error: {cache_error_msg}"
            )
        except Exception as e:
            log.error(f"User '{user_id}': Failed to update cache with login error: {e}")
        log.info(f"Exiting fetch task early for user '{user_id}' due to login failure.")
        return

    # 2. Fetch Accessory Data
    fetched_data_dict, fetch_errors, found_device_ids = None, None, set()
    try:
        fetched_data_dict, fetch_errors, found_device_ids = (
            apple_service.fetch_accessory_data(user_id, account)
        )
    except Exception as fetch_exc:
        log.exception(
            f"User '{user_id}': Unhandled exception during fetch_accessory_data"
        )
        fetch_errors = f"Fetch failed unexpectedly: {fetch_exc}"

    # Log any non-fatal errors during fetch
    if fetch_errors:
        log.warning(f"User '{user_id}': Fetch encountered errors: {fetch_errors}")

    # 3. Process Fetched Data (if successful)
    if fetched_data_dict is not None:
        timestamp_now_iso = datetime.now(timezone.utc).isoformat()
        user_cache_data = {
            "data": fetched_data_dict,
            "timestamp": timestamp_now_iso,
            "error": fetch_errors,  # Store non-fatal errors in cache
        }

        # Save data to cache file
        try:
            uds.save_cache_to_file(user_id, user_cache_data)
            log.info(
                f"User '{user_id}': Cache updated with {len(fetched_data_dict)} devices."
            )
        except Exception as e:
            log.error(f"User '{user_id}': Failed to save cache file: {e}")
            # Continue processing even if cache save fails

        # Check for notifications based on the new data
        log.info(f"User '{user_id}': Starting notification checks...")
        check_start_time = time.monotonic()
        try:
            # Load fresh device config for notification checks
            user_devices_config_for_notify = uds.load_devices_config(user_id)

            for device_id, device_data in fetched_data_dict.items():
                # Use the config embedded within the fetched data (already validated)
                device_config = device_data.get("config")
                if not device_config:
                    log.debug(
                        f"User '{user_id}': No config found for device '{device_id}' in fetched data during notification check, skipping."
                    )
                    continue

                # Get the latest report from the list (should be sorted newest first)
                latest_report = (
                    device_data["reports"][0] if device_data.get("reports") else None
                )

                if latest_report:
                    try:
                        # Perform geofence and battery checks
                        notifier.check_device_notifications(
                            user_id, device_id, latest_report, device_config
                        )
                    except Exception as notify_err:
                        log.exception(
                            f"User '{user_id}': Error checking notifications for {device_id}: {notify_err}"
                        )
            log.info(
                f"User '{user_id}': Notification checks finished in {time.monotonic() - check_start_time:.2f}s."
            )
        except Exception as e:
            log.error(
                f"User '{user_id}': Error during notification check phase: {e}",
                exc_info=True,
            )

        # Cleanup stale state files (geofence, battery, notifications times)
        cleanup_start_time = time.monotonic()
        try:
            uds.cleanup_user_data_files(user_id, found_device_ids)
            log.debug(
                f"User '{user_id}': Stale state cleanup finished in {time.monotonic() - cleanup_start_time:.2f}s."
            )
        except Exception as e:
            log.error(f"User '{user_id}': Error during state cleanup: {e}")

    # 4. Handle Case Where Fetch Returned No Data
    else:
        log.error(
            f"User '{user_id}': Background fetch did not return any data dictionary (fetch_accessory_data returned None)."
        )
        # Update cache with the fetch error
        try:
            user_cache = uds.load_cache_from_file(user_id) or {"data": None}
            user_cache["error"] = (
                fetch_errors or "Failed to retrieve data dictionary from fetch service."
            )
            user_cache["timestamp"] = datetime.now(timezone.utc).isoformat()
            uds.save_cache_to_file(user_id, user_cache)
            log.debug(f"User '{user_id}': Updated cache with fetch failure error.")
        except Exception as e:
            log.error(f"User '{user_id}': Failed to update cache with fetch error: {e}")

    # 5. Log Task Completion
    log.info(
        f"Finished background fetch task for user '{user_id}' in {time.monotonic() - task_start_time:.2f}s."
    )


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
            # Load DECRYPTED credentials for the user
            apple_id, apple_password = uds.load_apple_credentials(user_id)

            # Check if credentials exist
            if not apple_id or not apple_password:
                log.warning(
                    f"Master fetch: Skipping user '{user_id}', Apple credentials not found or incomplete."
                )
                # Optionally update cache to reflect missing credentials if needed
                try:
                    user_cache = uds.load_cache_from_file(user_id) or {"data": None}
                    # Only update error if it's different or cache is missing error
                    if (
                        user_cache.get("error")
                        != "Apple credentials not set. Cannot fetch data."
                    ):
                        user_cache["error"] = (
                            "Apple credentials not set. Cannot fetch data."
                        )
                        user_cache["timestamp"] = datetime.now(timezone.utc).isoformat()
                        uds.save_cache_to_file(user_id, user_cache)
                except Exception as e:
                    log.error(
                        f"Master fetch: Failed to update cache for skipped user '{user_id}': {e}"
                    )
                skipped_count += 1
                continue  # Skip to the next user

            # Spawn a new thread for the user fetch task
            log.debug(f"Master fetch: Spawning fetch task thread for user '{user_id}'")
            fetch_thread = threading.Thread(
                target=run_fetch_for_user_task,
                args=(
                    user_id,
                    apple_id,
                    apple_password,
                    config_obj,
                ),  # Pass necessary args
                name=f"FetchUser-{user_id}",  # Helpful thread name
                daemon=True,  # Allow main process to exit even if threads are running
            )
            fetch_thread.start()
            thread_list.append(fetch_thread)
            spawned_count += 1

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
