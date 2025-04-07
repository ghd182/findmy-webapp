# app/utils/key_utils.py

import os
import logging
import base64
from typing import Optional, Tuple

# Cryptography imports
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature
from cryptography.fernet import InvalidToken

log = logging.getLogger(__name__)

# --- Key Derivation Constants ---
HKDF_SALT = b"findmyapp-hkdf-salt-v1.1"
DERIVED_KEY_LENGTH = 32

# --- Constants for SECP256R1 ---
# The order 'n' of the SECP256R1 curve (prime256v1). Needed for validation.
# Value from SEC 2: Recommended Elliptic Curve Domain Parameters (Version 2.0, Jan 27, 2010)
# http://www.secg.org/sec2-v2.pdf
SECP256R1_ORDER = (
    115792089210356248762697446949407573529996955224135760342422259061068512044369
)


# --- Helper Functions (urlsafe_b64encode_str, derive_key_hkdf - same as before) ---
def urlsafe_b64encode_str(data: bytes) -> str:
    """URL-safe Base64 encodes bytes and returns a UTF-8 decoded string."""
    return base64.urlsafe_b64encode(data).decode("utf-8")


def derive_key_hkdf(seed: Optional[str], info: bytes, length: int) -> Optional[bytes]:
    """
    Derives a key of specified length from a seed string using HKDF-SHA256.
    Returns None if the seed is empty or invalid.
    """
    if not seed or not isinstance(seed, str) or len(seed.strip()) == 0:
        log.error(
            f"Invalid or empty seed provided for HKDF derivation (info: {info.decode()})."
        )
        return None
    try:
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=length,
            salt=HKDF_SALT,
            info=info,
        )
        derived_key = hkdf.derive(seed.encode("utf-8"))
        log.debug(f"HKDF derived {length} bytes for info: {info.decode()}")
        return derived_key
    except Exception as e:
        log.exception(f"Error during HKDF derivation (info: {info.decode()}): {e}")
        return None


# --- Specific Key Generation Functions (generate_fernet_key_from_seed, generate_secret_key_bytes_from_seed - same as before) ---
def generate_fernet_key_from_seed(seed: Optional[str]) -> Optional[str]:
    """Generates a URL-safe Base64 encoded Fernet key (32 bytes) from a seed."""
    derived_bytes = derive_key_hkdf(seed, b"fernet-key", DERIVED_KEY_LENGTH)
    if derived_bytes:
        return urlsafe_b64encode_str(derived_bytes)
    return None


def generate_secret_key_bytes_from_seed(seed: Optional[str]) -> Optional[bytes]:
    """Generates Flask SECRET_KEY bytes (typically 32 bytes) from a seed."""
    return derive_key_hkdf(seed, b"flask-secret-key", DERIVED_KEY_LENGTH)


# --- VAPID Key Generation (Corrected) ---
def generate_vapid_keys_from_seed(seed: Optional[str]) -> Optional[Tuple[str, str]]:
    """
    Generates VAPID private/public key pair (URL-safe Base64) from a seed.
    Uses HKDF output to derive the private scalar for SECP256R1.
    Returns (private_key_b64, public_key_b64) or None on failure or invalid scalar.
    """
    curve = ec.SECP256R1()  # Use correct curve name
    private_key_seed_bytes = derive_key_hkdf(seed, b"vapid-private-key", 32)

    if not private_key_seed_bytes:
        log.error("Failed to derive seed bytes for VAPID private key.")
        return None

    private_scalar = int.from_bytes(private_key_seed_bytes, "big")

    # --- CRITICAL VALIDATION (Using the constant SECP256R1_ORDER) ---
    if not (1 <= private_scalar < SECP256R1_ORDER):  # <<< CORRECTED VALIDATION
        log.error(
            f"Derived VAPID private key scalar from seed is outside the valid range [1, n-1] for SECP256R1 curve (n={SECP256R1_ORDER}). "
            f"This specific seed cannot generate a valid VAPID key pair deterministically using this method. "
            f"VAPID will be disabled unless keys are provided directly via environment variables."
        )
        return None  # Indicate generation failure

    try:
        private_key = ec.derive_private_key(private_scalar, curve)
        public_key = private_key.public_key()
        private_key_bytes = private_key_seed_bytes  # Reuse derived bytes
        public_key_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        private_key_b64 = urlsafe_b64encode_str(private_key_bytes)
        public_key_b64 = urlsafe_b64encode_str(public_key_bytes)
        log.debug("Successfully generated VAPID key pair from seed.")
        return private_key_b64, public_key_b64

    except Exception as e:
        log.exception(f"Unexpected error generating VAPID keys from seed: {e}")
        return None
