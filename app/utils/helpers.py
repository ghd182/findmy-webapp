# app/utils/helpers.py
import math
from typing import Optional
import uuid
import base64
import logging
import requests
import re
from cryptography.fernet import InvalidToken

try:
    import regex

    _REGEX_AVAILABLE = True
except ImportError:
    _REGEX_AVAILABLE = False


log = logging.getLogger(__name__)

DEFAULT_SOURCE_COLOR = '#6750A4'


def haversine(lat1, lon1, lat2, lon2):
    """Calculate the great-circle distance between two points on the Earth."""
    try:
        lat1, lon1, lat2, lon2 = map(
            math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)]
        )
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        r = 6371000  # Earth radius in meters
        return c * r
    except (ValueError, TypeError):
        log.warning(
            f"Invalid input for haversine calculation: ({lat1}, {lon1}), ({lat2}, {lon2})"
        )
        return float("inf")  # Return infinity or handle error appropriately


def generate_geofence_id():
    """Generates a unique ID for a geofence."""
    return f"gf_{uuid.uuid4()}"


def generate_device_icon_svg(label: str, color: str, size: int = 36) -> str:
    """
    Generates an SVG icon with a colored border, white background, and text label.
    Text color contrasts with the *border* color for better visual association.
    """
    label = label or "?"
    try:
        if _REGEX_AVAILABLE:
            label_chars = regex.findall(r"\X", label, regex.UNICODE)
            label = "".join(label_chars[:2]).upper()
        else:
            if len(label) > 0 and 0xD800 <= ord(label[0]) <= 0xDBFF:
                label = label[:2].upper()
            else:
                label = label[:1].upper()
    except Exception as e:
        log.warning(f"Error processing label '{label}' for SVG: {e}")
        label = (label or "?")[:2].upper()

    color = color or "#70757a"
    if not re.match(r"^#[0-9a-fA-F]{6}$", color):
        color = getDefaultColorForId(label)

    border_width = max(1, round(size * 0.1))
    inner_radius = max(1, round(size / 2) - border_width)
    text_size = size * (0.50 if len(label) == 1 else 0.40)
    # text_y_adjust = size * 0.04 # Keep text centered vertically

    # --- UPDATED TEXT COLOR LOGIC ---
    # Determine text color based on the BORDER color's luminance for contrast
    text_color = "#FFFFFF"  # Default to white text (contrasts with dark borders)
    try:
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
        # Calculate luminance (0=black, 1=white)
        luminance = (
            0.2126 * r + 0.7152 * g + 0.0722 * b
        ) / 255  # More accurate luminance calculation
        # Use dark text (#333) if the BORDER color is light (high luminance)
        if luminance > 0.5:  # Threshold for light/dark background
            text_color = "#333333"
    except Exception as e:
        log.warning(f"Could not parse color '{color}' for luminance check: {e}")
    # --- ------------------------- ---

    label_safe = label.replace("&", "&").replace("<", "<").replace(">", ">")

    svg_template = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
<circle cx="{size/2}" cy="{size/2}" r="{size/2}" fill="{color}" />
<circle cx="{size/2}" cy="{size/2}" r="{inner_radius}" fill="#FFFFFF" />
<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
        font-family="sans-serif" font-size="{text_size}px" font-weight="bold" fill="{text_color}">
    {label_safe}
</text>
</svg>"""
    return svg_template


def getDefaultColorForId(id_str: str) -> str:
    """Generates a default hex color based on a string ID."""
    if not id_str:
        return "#70757a"  # Grey for empty ID
    try:
        hash_val = 0
        for char in str(id_str):  # Ensure it's a string
            hash_val = ord(char) + ((hash_val << 5) - hash_val)
            hash_val &= hash_val  # Convert to 32bit integer
        hash_val = abs(hash_val)

        # Extract RGB components
        r = (hash_val & 0xFF0000) >> 16
        g = (hash_val & 0x00FF00) >> 8
        b = hash_val & 0x0000FF

        # Simple adjustment to avoid extremely dark/light colors and increase saturation
        # Aim for a luminance range (approx 0.3 - 0.7) and ensure some color variance
        avg = (r + g + b) / 3.0
        min_comp = min(r, g, b)
        max_comp = max(r, g, b)

        # Adjust brightness/saturation slightly
        factor = 0.5  # Adjust factor to control brightness shift
        nr = min(255, max(0, r + (128 - avg) * factor))
        ng = min(255, max(0, g + (128 - avg) * factor))
        nb = min(255, max(0, b + (128 - avg) * factor))

        # Ensure minimum difference between components for saturation
        if max(nr, ng, nb) - min(nr, ng, nb) < 30:
            # If too gray, slightly boost the max component and reduce the min
            components = [(nr, "r"), (ng, "g"), (nb, "b")]
            components.sort()
            # Increase max, decrease min (crude saturation boost)
            max_val, max_idx = components[2]
            min_val, min_idx = components[0]
            components[2] = (min(255, max_val + 20), max_idx)
            components[0] = (max(0, min_val - 10), min_idx)
            # Reassign based on index
            for val, idx in components:
                if idx == "r":
                    nr = val
                elif idx == "g":
                    ng = val
                else:
                    nb = val

        return f"#{int(nr):02x}{int(ng):02x}{int(nb):02x}"
    except Exception as e:
        log.error(f"Error generating color for ID '{id_str}': {e}")
        return "#70757a"  # Fallback grey


def get_available_anisette_server(anisette_server_list: list[str]) -> str | None:
    """
    Finds the first responsive Anisette server from the provided list.
    Prioritizes localhost:6969 if present.
    """
    local_anisette = "http://localhost:6969"

    # Check local first if it's in the list or implicitly preferred
    if local_anisette in anisette_server_list:
        try:
            response = requests.get(local_anisette, timeout=1)
            response.raise_for_status()
            log.info(f"Using local Anisette server: {local_anisette}")
            return local_anisette
        except requests.exceptions.RequestException as e:
            log.warning(f"Local Anisette server ({local_anisette}) not responsive: {e}")
        except Exception as e:
            log.error(f"Unexpected error checking local Anisette server: {e}")

    # Check other configured servers
    for server_url in anisette_server_list:
        if server_url == local_anisette:
            continue  # Already checked or not present
        try:
            headers = {"User-Agent": "Mozilla/5.0 FindMyApp/2.0"}  # Identify client
            response = requests.get(server_url, timeout=3, headers=headers)
            if response.status_code == 200:
                # Optional: Add further validation? Check response content?
                log.info(f"Using public Anisette server: {server_url}")
                return server_url
            else:
                log.warning(
                    f"Public Anisette server {server_url} responded with status {response.status_code}"
                )
        except requests.exceptions.RequestException as e:
            log.warning(f"Public Anisette server {server_url} not responsive: {e}")
        except Exception as e:
            log.error(
                f"Unexpected error checking public Anisette server {server_url}: {e}"
            )

    log.error("No Anisette server configured or available.")
    return None


# --- Encryption Helpers ---
_cipher_suite = None


def _get_cipher_suite(config):
    """Initializes and returns the Fernet cipher suite."""
    global _cipher_suite
    if _cipher_suite is None and config.get("ENCRYPTION_ENABLED"):
        try:
            from cryptography.fernet import Fernet

            key = config.get("FERNET_KEY")
            if key:
                _cipher_suite = Fernet(key.encode())
                log.info("Fernet cipher suite initialized.")
            else:
                log.error("Encryption enabled but FERNET_KEY is missing.")
        except ImportError:
            log.error(
                "Cryptography library not installed. Cannot use Fernet encryption."
            )
            config["ENCRYPTION_ENABLED"] = False
        except Exception as e:
            log.error(f"Failed to initialize Fernet encryption (invalid key?): {e}")
            config["ENCRYPTION_ENABLED"] = False
            _cipher_suite = None
    return _cipher_suite


def encrypt_password(password: str, config) -> str:
    """Encrypts a password using Fernet or Base64 fallback."""
    if not password:
        return ""
    if config.get("ENCRYPTION_ENABLED"):
        cipher = _get_cipher_suite(config)
        if cipher:
            try:
                return cipher.encrypt(password.encode()).decode()
            except Exception as e:
                log.error(f"Fernet encryption failed: {e}")
                return ""
        else:
            log.warning(
                "Encryption enabled but cipher failed, falling back to Base64 (INSECURE)."
            )
            return base64.b64encode(password.encode()).decode()
    else:
        # Use Base64 if encryption is explicitly disabled
        return base64.b64encode(password.encode()).decode()


def decrypt_password(encrypted_password: str, config) -> str:
    """Decrypts a password using Fernet or Base64 fallback."""
    if not encrypted_password:
        return ""
    if config.get("ENCRYPTION_ENABLED"):
        cipher = _get_cipher_suite(config)
        if cipher:
            try:
                # Attempt Fernet decryption first
                return cipher.decrypt(encrypted_password.encode()).decode()
            except InvalidToken:
                log.warning(
                    "Fernet decryption failed (InvalidToken). Trying Base64 fallback."
                )
                try:
                    # Try Base64 only if Fernet fails with InvalidToken
                    return base64.b64decode(encrypted_password.encode()).decode()
                except Exception as b64_e:
                    log.error(f"Base64 fallback decryption also failed: {b64_e}")
                    return ""
            except Exception as e:
                log.error(f"Fernet decryption failed with unexpected error: {e}")
                return ""
        else:
            # If cipher init failed but encryption was enabled, try Base64
            log.warning(
                "Encryption enabled but cipher failed, attempting Base64 decryption."
            )
            try:
                return base64.b64decode(encrypted_password.encode()).decode()
            except Exception as e:
                log.error(f"Base64 decryption failed (cipher disabled): {e}")
                return ""
    else:
        # Fallback to Base64 if encryption was never enabled
        try:
            return base64.b64decode(encrypted_password.encode()).decode()
        except Exception as e:
            log.error(f"Base64 decryption failed: {e}")
            return ""


def get_potential_mac_from_public_key(adv_key_bytes: bytes) -> Optional[str]:
    """
    Calculates the potential Locally Administered MAC Address
    associated with a 28-byte public advertisement key.

    Args:
        adv_key_bytes: The 28-byte public advertisement key.

    Returns:
        The potential MAC address as a string (e.g., "XX:XX:XX:XX:XX:XX")
        or None if the key is invalid.
    """
    if not isinstance(adv_key_bytes, bytes) or len(adv_key_bytes) != 28:
        log.warning(f"Invalid public key bytes provided for MAC calculation (length {len(adv_key_bytes)}).")
        return None
    try:
        # Apply the standard modification to the first byte
        mac_bytes = bytes([adv_key_bytes[0] | 0b11000000]) + adv_key_bytes[1:6]
        # Format as colon-separated hex string
        return ':'.join(f'{byte:02X}' for byte in mac_bytes)
    except Exception as e:
        log.error(f"Error calculating potential MAC from public key: {e}")
        return None