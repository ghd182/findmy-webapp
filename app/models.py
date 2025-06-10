# app/models.py
from typing import Optional
from werkzeug.security import check_password_hash, generate_password_hash
from flask_login import UserMixin
from flask import current_app
from datetime import datetime, timezone
import logging
import json

import secrets # For token generation

from . import db

log = logging.getLogger(__name__)

# --- Association Table for Device <-> Geofence Links ---
device_geofence_link = db.Table(
    "device_geofence_link",
    db.Column(
        "device_id", db.String(128), db.ForeignKey("device.id"), primary_key=True
    ),
    db.Column(
        "geofence_id", db.String(64), db.ForeignKey("geofence.id"), primary_key=True
    ),
    db.Column("notify_entry", db.Boolean, default=False, nullable=False),
    db.Column("notify_exit", db.Boolean, default=False, nullable=False),
)


class User(UserMixin, db.Model):
    __tablename__ = "user"

    id_internal = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True, nullable=False)
    email = db.Column(db.String(120), index=True, unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    theme_mode = db.Column(db.String(10), default="system")
    theme_color = db.Column(db.String(7), default="#4285F4")

    # Relationships
    apple_credential = db.relationship(
        "AppleCredentialState",
        back_populates="user",
        uselist=False,
        lazy="joined",
        cascade="all, delete-orphan",
    )
    devices = db.relationship(
        "Device", back_populates="owner", lazy="dynamic", cascade="all, delete-orphan"
    )
    geofences = db.relationship(
        "Geofence", back_populates="owner", lazy="dynamic", cascade="all, delete-orphan"
    )
    push_subscriptions = db.relationship(
        "PushSubscription",
        back_populates="user",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    notification_history = db.relationship(
        "NotificationHistory",
        back_populates="user",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    shares = db.relationship(
        "Share", back_populates="owner", lazy="dynamic", cascade="all, delete-orphan"
    )

    # Add relationship to API tokens
    api_tokens = db.relationship(
        "ApiToken",
        back_populates="user",
        lazy="dynamic",
        cascade="all, delete-orphan" # Delete tokens if user is deleted
    )

    # --- START MODIFICATION ---
    # Add the 'id' property expected by Flask-Login
    @property
    def id(self):
        return str(self.username)

    # --- END MODIFICATION ---

    # Override Flask-Login's get_id to use our logical username
    # This remains correct.
    def get_id(self):
        return str(self.username)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        if not self.password_hash or not password:
            log.debug(
                f"check_password for {self.username}: Hash or provided password empty."
            )
            return False
        is_valid = check_password_hash(self.password_hash, password)
        log.debug(
            f"check_password for {self.username}: Password validation result: {is_valid}"
        )
        return is_valid

    @staticmethod
    def get(user_id):
        """Load user by username using the database."""
        log.debug(f"User.get (DB): Attempting to load user by username: {user_id}")
        try:
            user = db.session.execute(
                db.select(User).filter_by(username=user_id)
            ).scalar_one_or_none()
            if user:
                log.debug(f"User.get (DB): Found user data for {user_id}")
            else:
                log.debug(f"User.get (DB): No user data found for {user_id}")
            return user
        except Exception as e:
            log.error(f"User.get (DB): Error loading user {user_id}: {e}")
            return None

    def __repr__(self):
        return f"<User {self.username} ({self.email})>"

class ApiToken(db.Model):
    """Stores API tokens for users, allowing external app access."""
    __tablename__ = "api_token"

    id = db.Column(db.Integer, primary_key=True)
    user_username = db.Column(db.String(64), db.ForeignKey("user.username"), nullable=False, index=True)
    token_hash = db.Column(db.String(256), nullable=False, unique=True) # Store hash, not plain token
    description = db.Column(db.String(100), nullable=True) # e.g., "Android Scanner - Pixel 7"
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at = db.Column(db.DateTime(timezone=True), nullable=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True) # Optional expiry

    user = db.relationship("User", back_populates="api_tokens")

    def set_token(self, plain_token: str):
        """Hashes the plain token before storing."""
        self.token_hash = generate_password_hash(plain_token)

    def check_token(self, plain_token: str) -> bool:
        """Checks if the provided plain token matches the stored hash."""
        return check_password_hash(self.token_hash, plain_token)

    def is_valid(self) -> bool:
        """Checks if the token is expired (if expiry is set)."""
        if self.expires_at and self.expires_at < datetime.now(timezone.utc):
            return False
        return True

    def __repr__(self):
        return f"<ApiToken User:{self.user_username} Desc:{self.description} ID:{self.id}>"

class AppleCredentialState(db.Model):
    """Stores Apple credentials and FindMy.py account state."""

    __tablename__ = "apple_credential_state"
    id = db.Column(db.Integer, primary_key=True)
    user_username = db.Column(
        db.String(64),
        db.ForeignKey("user.username"),
        nullable=False,
        index=True,
        unique=True,
    )
    apple_id = db.Column(db.String(120), nullable=False, index=True)
    apple_password_encrypted = db.Column(db.String(512))
    account_state_json = db.Column(db.Text)
    last_updated = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    user = db.relationship("User", back_populates="apple_credential")

    def set_account_state(self, state_dict: dict):
        try:
            self.account_state_json = json.dumps(state_dict)
        except TypeError as e:
            log.error(f"Failed to serialize account state for {self.apple_id}: {e}")
            self.account_state_json = None

    def get_account_state(self) -> Optional[dict]:
        if not self.account_state_json:
            return None
        try:
            return json.loads(self.account_state_json)
        except json.JSONDecodeError as e:
            log.error(f"Failed to deserialize account state for {self.apple_id}: {e}")
            return None

    def __repr__(self):
        return f"<AppleCredentialState for {self.user_username}>"


class Device(db.Model):
    """Represents a user's tracked device."""

    __tablename__ = "device"
    id = db.Column(
        db.String(128), primary_key=True
    )  # Device ID (e.g., plist/keys filename stem)
    user_username = db.Column(
        db.String(64), db.ForeignKey("user.username"), nullable=False, index=True
    )
    name = db.Column(db.String(100))  # User-defined display name
    label = db.Column(db.String(5), default="❓")  # Emoji label for map
    color = db.Column(db.String(7))  # Hex color for map/UI
    model = db.Column(
        db.String(100), default="Accessory/Tag"
    )  # e.g., "AirTag", "iPhone", derived from plist if possible
    icon = db.Column(
        db.String(50), default="tag"
    )  # Material icon name hint (e.g., 'tag', 'smartphone')

    # Last known battery status reported by FindMy network (parsed string like "Low", "Medium")
    last_battery_status = db.Column(db.String(20), nullable=True)
    # Timestamp when this device was last seen by the NATIVE SCANNER (nearby)
    last_seen_local = db.Column(
        db.DateTime(timezone=True), nullable=True, index=True
    )

    # Relationships
    owner = db.relationship("User", back_populates="devices")
    linked_geofences = db.relationship(
        "Geofence",
        secondary=device_geofence_link,
        back_populates="linked_devices",
        lazy="dynamic",  # Use dynamic loading for links
    )
    shares = db.relationship(
        "Share", back_populates="device", lazy="dynamic", cascade="all, delete-orphan"
    )
    geofence_statuses = db.relationship(
        "GeofenceDeviceStatus",
        back_populates="device",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    cooldowns = db.relationship(
        "NotificationCooldown",
        back_populates="device",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Device {self.id} (User: {self.user_username})>"


class Geofence(db.Model):
    """Represents a user-defined geofence."""

    __tablename__ = "geofence"
    id = db.Column(db.String(64), primary_key=True)
    user_username = db.Column(
        db.String(64), db.ForeignKey("user.username"), nullable=False, index=True
    )
    name = db.Column(db.String(100), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    radius = db.Column(db.Float, nullable=False)
    owner = db.relationship("User", back_populates="geofences")
    linked_devices = db.relationship(
        "Device",
        secondary=device_geofence_link,
        back_populates="linked_geofences",
        lazy="dynamic",
    )
    device_statuses = db.relationship(
        "GeofenceDeviceStatus",
        back_populates="geofence",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Geofence {self.name} ({self.id})>"


class PushSubscription(db.Model):
    """Stores web push subscription information."""

    __tablename__ = "push_subscription"
    id = db.Column(db.Integer, primary_key=True)
    user_username = db.Column(
        db.String(64), db.ForeignKey("user.username"), nullable=False, index=True
    )
    endpoint = db.Column(db.String(1024), nullable=False)
    subscription_json = db.Column(db.Text, nullable=False)
    subscribed_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    user = db.relationship("User", back_populates="push_subscriptions")
    __table_args__ = (
        db.UniqueConstraint("user_username", "endpoint", name="_user_endpoint_uc"),
    )

    def get_subscription_info(self) -> Optional[dict]:
        try:
            return json.loads(self.subscription_json)
        except json.JSONDecodeError:
            return None

    def set_subscription_info(self, sub_info: dict):
        self.subscription_json = json.dumps(sub_info)

    def __repr__(self):
        return (
            f"<PushSubscription {self.endpoint[:30]}... (User: {self.user_username})>"
        )


class NotificationHistory(db.Model):
    """Stores history of sent notifications."""

    __tablename__ = "notification_history"
    id = db.Column(db.String(64), primary_key=True)
    user_username = db.Column(
        db.String(64), db.ForeignKey("user.username"), nullable=False, index=True
    )
    timestamp = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        index=True,
        default=lambda: datetime.now(timezone.utc),
    )
    title = db.Column(db.String(255), nullable=False)
    body = db.Column(db.Text)
    data_json = db.Column(db.Text)
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    user = db.relationship("User", back_populates="notification_history")

    def get_data(self) -> Optional[dict]:
        try:
            return json.loads(self.data_json) if self.data_json else None
        except json.JSONDecodeError:
            return None

    def set_data(self, data_dict: dict):
        self.data_json = json.dumps(data_dict)

    def __repr__(self):
        return f"<NotificationHistory {self.id} @ {self.timestamp}>"


class Share(db.Model):
    """Stores information about publicly shared devices."""

    __tablename__ = "share"
    id = db.Column(db.String(64), primary_key=True)
    user_username = db.Column(
        db.String(64), db.ForeignKey("user.username"), nullable=False, index=True
    )
    device_id = db.Column(
        db.String(128), db.ForeignKey("device.id"), nullable=False, index=True
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    active = db.Column(db.Boolean, default=True, nullable=False)
    note = db.Column(db.String(100))
    owner = db.relationship("User", back_populates="shares")
    device = db.relationship("Device", back_populates="shares")

    def __repr__(self):
        return f"<Share {self.id} for Device {self.device_id}>"


class GeofenceDeviceStatus(db.Model):
    """Stores the last known status (inside/outside) of a device relative to a geofence."""

    __tablename__ = "geofence_device_status"
    device_id = db.Column(db.String(128), db.ForeignKey("device.id"), primary_key=True)
    geofence_id = db.Column(
        db.String(64), db.ForeignKey("geofence.id"), primary_key=True
    )
    status = db.Column(
        db.String(10), nullable=False
    )  # e.g., 'inside', 'outside', 'unknown'
    last_updated = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    device = db.relationship("Device", back_populates="geofence_statuses")
    geofence = db.relationship("Geofence", back_populates="device_statuses")

    def __repr__(self):
        return f"<GeofenceStatus Dev:{self.device_id} GF:{self.geofence_id} Status:{self.status}>"


class NotificationCooldown(db.Model):
    """Stores the last time a specific notification event was sent for a device."""

    __tablename__ = "notification_cooldown"
    # Composite primary key: one entry per device per unique event type
    device_id = db.Column(db.String(128), db.ForeignKey("device.id"), primary_key=True)
    event_key = db.Column(
        db.String(100), primary_key=True
    )  # e.g., 'battery_low', 'geofence_gf123_entry'
    last_sent_timestamp = db.Column(
        db.Float, nullable=False
    )  # Store as Unix timestamp (float)
    device = db.relationship("Device", back_populates="cooldowns")

    def __repr__(self):
        return f"<Cooldown Dev:{self.device_id} Event:{self.event_key}>"
