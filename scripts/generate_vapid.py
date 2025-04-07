# scripts/generate_vapid.py

from py_vapid import Vapid
import os
import sys
import logging
from pathlib import Path
# Import serialization enums directly
from cryptography.hazmat.primitives import serialization
from py_vapid.utils import b64urlencode

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

def generate_and_save_keys(output_dir: Path):
    """Generates VAPID keys and saves them as PEM-like strings (b64 encoded)"""
    try:
        log.info(f"Generating new VAPID keys in {output_dir}...")
        output_dir.mkdir(parents=True, exist_ok=True)

        priv_key_path = output_dir / "vapid_private_key.pem"
        pub_key_path = output_dir / "vapid_public_key.pem"

        # Check if keys already exist to avoid overwriting unnecessarily
        if priv_key_path.exists() and pub_key_path.exists():
             log.info("VAPID key files already exist. Skipping generation.")
             return True

        vapid = Vapid()
        vapid.generate_keys()

        # Get public key bytes in uncompressed format
        public_key_bytes = vapid.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint
        )

        # Get private key value (integer) and convert to bytes
        private_key_value = vapid.private_key.private_numbers().private_value
        private_key_bytes = private_key_value.to_bytes(32, byteorder='big') # SECP256r1 uses 32 bytes

        # URL-safe Base64 encode
        public_key_b64 = b64urlencode(public_key_bytes)
        private_key_b64 = b64urlencode(private_key_bytes)

        # Save to files (just the base64 string)
        with open(priv_key_path, "w") as f:
            f.write(private_key_b64)
        with open(pub_key_path, "w") as f:
            f.write(public_key_b64)

        # Optional: Set permissions (e.g., restrict private key read access)
        # os.chmod(priv_key_path, 0o600)

        log.info(f"Successfully generated and saved VAPID keys to {output_dir}")
        return True

    except Exception as e:
        log.exception(f"Error generating/saving VAPID keys: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python generate_vapid.py <output_directory>")
        sys.exit(1)
    output_directory = Path(sys.argv[1])
    if not generate_and_save_keys(output_directory):
        sys.exit(1)