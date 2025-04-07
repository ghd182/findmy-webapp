# app/utils/json_utils.py
import json
import os
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any

log = logging.getLogger(__name__)

def save_json_atomic(file_path: Path, data: Dict[str, Any], lock: threading.Lock, indent: Optional[int] = 2):
    """
    Atomically saves a dictionary to a JSON file using a temporary file and a lock.

    Args:
        file_path: The final path for the JSON file.
        data: The dictionary data to save.
        lock: The threading lock specific to this file/resource.
        indent: The indentation level for the JSON file (default: 2). Use None for no indentation.
    """
    temp_file_path = None
    try:
        # Create directory if it doesn't exist before acquiring lock
        file_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log.error(f"Failed to create directory {file_path.parent}: {e}")
        # Depending on severity, you might want to raise this exception
        return # Or raise e

    with lock:
        try:
            # Use a unique temporary file name in the same directory
            temp_file_path = file_path.with_suffix(f".{os.getpid()}.tmp")

            with open(temp_file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=indent, ensure_ascii=False) # ensure_ascii=False for proper unicode

            # Atomic replace operation
            os.replace(temp_file_path, file_path)
            log.debug(f"Successfully saved data to {file_path}")

        except (IOError, OSError, json.JSONDecodeError) as e:
            log.error(f"Failed to save JSON atomically to {file_path}: {e}")
            # Clean up temporary file if it exists and saving failed
            if temp_file_path and temp_file_path.exists():
                try:
                    os.remove(temp_file_path)
                    log.debug(f"Removed temporary file {temp_file_path} after save failure.")
                except OSError as cleanup_err:
                    log.error(f"Failed to remove temporary file {temp_file_path}: {cleanup_err}")
            # Re-raise the exception or handle it as needed
            raise # Or return False / specific error code

        except Exception as e:
            # Catch any other unexpected errors during the locked operation
            log.exception(f"Unexpected error during atomic JSON save to {file_path}")
            if temp_file_path and temp_file_path.exists():
                 try: os.remove(temp_file_path)
                 except OSError: pass
            raise # Re-raise unexpected errors


def load_json_file(file_path: Path, lock: threading.Lock) -> Optional[Dict[str, Any]]:
    """
    Loads data from a JSON file using a lock, returning None if file not found or invalid.

    Args:
        file_path: The path to the JSON file.
        lock: The threading lock specific to this file/resource.

    Returns:
        The loaded dictionary, or None if the file doesn't exist, is empty, or invalid.
    """
    with lock:
        if not file_path.exists():
            log.debug(f"JSON file not found: {file_path}")
            return None
        if file_path.stat().st_size == 0:
             log.warning(f"JSON file is empty: {file_path}")
             return None # Treat empty file as non-existent/invalid

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if not isinstance(data, dict):
                log.warning(f"Invalid format (not a dict) in {file_path}. Content: {str(data)[:100]}...")
                # Optionally: Backup or rename the corrupted file here
                # e.g., file_path.rename(file_path.with_suffix(".invalid"))
                return None

            # log.debug(f"Successfully loaded JSON from {file_path}")
            return data

        except json.JSONDecodeError as e:
            log.error(f"Failed to parse JSON from {file_path}: {e}")
            # Optionally: Backup or rename the corrupted file
            return None
        except (IOError, OSError) as e:
            log.error(f"Failed to read file {file_path}: {e}")
            return None
        except Exception as e:
            log.exception(f"Unexpected error loading JSON from {file_path}")
            return None