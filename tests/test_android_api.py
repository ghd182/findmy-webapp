import pytest
import json
from flask import Flask
from app import create_app, db
from app.models import User, Device, ApiToken
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock
import base64
from pathlib import Path

# Placeholder for FindMyAccessory and KeyPair if they are complex to instantiate directly
# from findmy.accessory import FindMyAccessory (mocked later)
# from findmy.keys import KeyPair (mocked later)

@pytest.fixture
def app_fixture():
    """Create and configure a new app instance for each test."""
    app = create_app(config_name='testing')
    app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "WTF_CSRF_ENABLED": False, # Disable CSRF for testing forms if any
        "LOGIN_DISABLED": False, # Ensure login is not disabled unless testing that
        "SERVER_NAME": "localhost.test" # Required for url_for outside of request context
    })

    with app.app_context():
        db.create_all()
        # Create a test user
        test_user = User(username="testuser", email="test@example.com")
        test_user.set_password("testpassword")
        db.session.add(test_user)
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()

@pytest.fixture
def client(app_fixture):
    """A test client for the app."""
    return app_fixture.test_client()

@pytest.fixture
def logged_in_client(client, app_fixture):
    """A test client that is logged in."""
    client.post('/auth/login', data=dict(
        username='testuser',
        password='testpassword'
    ), follow_redirects=True)
    yield client
    # No explicit logout needed as each test gets a fresh client
    # client.get('/auth/logout', follow_redirects=True)


# --- Mocks for external dependencies ---
@pytest.fixture
def mock_uds(mocker):
    """Mocks UserDataService."""
    mock_service = MagicMock()
    # Setup default return values for methods that will be called
    mock_service._get_user_data_dir.return_value = Path("/tmp/test_user_data") # Example path
    mock_service.load_devices_config.return_value = {} # Default empty config
    mock_service._load_private_keys_from_keys_file.return_value = [] # Default no keys
    mocker.patch('app.main.api.UserDataService', return_value=mock_service)
    return mock_service

@pytest.fixture
def mock_findmy_accessory(mocker):
    """Mocks FindMyAccessory."""
    mock = MagicMock()
    mock.from_plist.return_value = mock # Make from_plist return the mock instance
    mock.keys_between.return_value = [] # Default no keys
    mocker.patch('app.main.api.FindMyAccessory', new=mock) # Patch where it's used
    return mock

@pytest.fixture
def mock_keypair(mocker):
    """Mocks KeyPair."""
    mock = MagicMock()
    mock.from_b64.return_value = mock
    mock.adv_key_bytes = b"test_adv_key_bytes"
    mocker.patch('app.main.api.KeyPair', new=mock) # Patch where it's used
    return mock


class TestAndroidApiEndpoints:

    def test_get_android_devices_unauthenticated(self, client):
        """Test /api/android/devices when not authenticated."""
        response = client.get('/api/android/devices')
        assert response.status_code == 302 # Redirect to login

    def test_get_android_devices_empty(self, logged_in_client, mock_uds):
        """Test /api/android/devices with no devices configured."""
        mock_uds.load_devices_config.return_value = {} # Ensure it returns empty
        # Ensure user data dir exists for glob to not fail
        mock_uds._get_user_data_dir.return_value.mkdir(parents=True, exist_ok=True)

        response = logged_in_client.get('/api/android/devices')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert "devices" in data
        assert len(data["devices"]) == 0

    def test_get_android_devices_with_data(self, logged_in_client, mock_uds, mock_findmy_accessory, mock_keypair, app_fixture):
        """Test /api/android/devices with some device data and keys."""
        user_data_dir_mock = Path("/tmp/test_user_data/testuser")
        user_data_dir_mock.mkdir(parents=True, exist_ok=True)
        mock_uds._get_user_data_dir.return_value = user_data_dir_mock

        # Mock device config from DB
        mock_uds.load_devices_config.return_value = {
            "device1_plist": {"id": "device1_plist", "name": "Test AirTag", "label": "🏷️", "color": "#FF0000", "model": "AirTag", "icon": "tag"},
            "device2_keys": {"id": "device2_keys", "name": "Test Keys", "label": "🔑", "color": "#00FF00", "model": "FindMyItem", "icon": "key"}
        }

        # Create dummy .plist file for device1_plist
        with open(user_data_dir_mock / "device1_plist.plist", "w") as f:
            f.write("dummy plist content")

        # Mock keys_between for the plist device
        mock_key_pair_instance_plist = MagicMock()
        mock_key_pair_instance_plist.adv_key_bytes = b"plist_adv_key"
        mock_key_pair_instance_plist.key_type.name = "ROLLING_PUBLIC_KEY"
        mock_findmy_accessory.keys_between.return_value = {mock_key_pair_instance_plist}


        # Create dummy .keys file for device2_keys and mock its key loading
        with open(user_data_dir_mock / "device2_keys.keys", "w") as f:
            f.write("private key: somebase64keydata==") # Content doesn't matter due to mock

        mock_uds._load_private_keys_from_keys_file.return_value = ["dummybase64keydata=="]
        # Mock KeyPair.from_b64 for the .keys device
        mock_key_pair_instance_keys = MagicMock()
        mock_key_pair_instance_keys.adv_key_bytes = b"keys_adv_key"
        mock_keypair.from_b64.return_value = mock_key_pair_instance_keys # Ensure from_b64 returns this mock

        response = logged_in_client.get('/api/android/devices')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert "devices" in data
        assert len(data["devices"]) == 2

        device1_data = next((d for d in data["devices"] if d["id"] == "device1_plist"), None)
        assert device1_data is not None
        assert device1_data["name"] == "Test AirTag"
        assert len(device1_data["keys"]) == 1
        assert device1_data["keys"][0]["adv_key_b64"] == base64.urlsafe_b64encode(b"plist_adv_key").decode().rstrip("=")
        assert device1_data["keys"][0]["key_type"] == "ROLLING_PUBLIC_KEY"

        device2_data = next((d for d in data["devices"] if d["id"] == "device2_keys"), None)
        assert device2_data is not None
        assert device2_data["name"] == "Test Keys"
        assert len(device2_data["keys"]) == 1
        assert device2_data["keys"][0]["adv_key_b64"] == base64.urlsafe_b64encode(b"keys_adv_key").decode().rstrip("=")
        assert device2_data["keys"][0]["key_type"] == "STATIC_KEYS_FILE"

        # Clean up dummy files
        (user_data_dir_mock / "device1_plist.plist").unlink()
        (user_data_dir_mock / "device2_keys.keys").unlink()


    def test_post_android_scan_result_unauthenticated(self, client):
        response = client.post('/api/android/scan_result', json={})
        assert response.status_code == 302 # Redirect to login

    def test_post_android_scan_result_valid(self, logged_in_client, app_fixture):
        with app_fixture.app_context():
            user = User.query.filter_by(username="testuser").first()
            device = Device(id="testdevice1", user_username=user.username, name="Test Device")
            db.session.add(device)
            db.session.commit()

        payload = {
            "device_id": "testdevice1",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "battery_level": 80
        }
        response = logged_in_client.post('/api/android/scan_result', json=payload)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["message"] == "Scan result processed"

        with app_fixture.app_context():
            updated_device = Device.query.get("testdevice1")
            assert updated_device is not None
            assert updated_device.last_seen_by_android is not None
            assert updated_device.android_battery_level == 80
            # Compare timestamp more carefully if needed, allowing for minor differences
            assert abs((updated_device.last_seen_by_android - datetime.fromisoformat(payload["timestamp"])).total_seconds()) < 1

    def test_post_android_scan_result_invalid_payload(self, logged_in_client):
        response = logged_in_client.post('/api/android/scan_result', json={"device_id": "testdevice"}) # Missing timestamp
        assert response.status_code == 400
        data = json.loads(response.data)
        assert "Missing device_id or timestamp" in data["error"] # Corrected expected error message

    def test_post_android_scan_result_device_not_found(self, logged_in_client):
        payload = {
            "device_id": "nonexistentdevice",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "battery_level": 70
        }
        response = logged_in_client.post('/api/android/scan_result', json=payload)
        assert response.status_code == 404
        data = json.loads(response.data)
        assert "Device not found" in data["error"]


    def test_post_android_device_status_unauthenticated(self, client):
        response = client.post('/api/android/device_status', json={})
        assert response.status_code == 302

    def test_post_android_device_status_valid(self, logged_in_client, app_fixture):
        with app_fixture.app_context():
            user = User.query.filter_by(username="testuser").first()
            device = Device(id="testdevice2", user_username=user.username, name="Status Device")
            db.session.add(device)
            db.session.commit()

        payload = {
            "device_id": "testdevice2",
            "status": "nearby"
        }
        response = logged_in_client.post('/api/android/device_status', json=payload)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["message"] == "Device status updated"

        with app_fixture.app_context():
            updated_device = Device.query.get("testdevice2")
            assert updated_device is not None
            assert updated_device.android_device_status == "nearby"
            assert updated_device.last_seen_by_android is not None # Should be updated too

    def test_post_android_device_status_invalid_status_value(self, logged_in_client, app_fixture):
        with app_fixture.app_context(): # Ensure device exists
            user = User.query.filter_by(username="testuser").first()
            device = Device(id="testdevice3", user_username=user.username, name="Status Device Invalid")
            db.session.add(device)
            db.session.commit()

        payload = {
            "device_id": "testdevice3",
            "status": "invalid_status_value"
        }
        response = logged_in_client.post('/api/android/device_status', json=payload)
        assert response.status_code == 400
        data = json.loads(response.data)
        assert "Invalid status" in data["error"]

    def test_post_android_device_status_device_not_found(self, logged_in_client):
        payload = {
            "device_id": "nonexistentdevice_status",
            "status": "lost"
        }
        response = logged_in_client.post('/api/android/device_status', json=payload)
        assert response.status_code == 404
        data = json.loads(response.data)
        assert "Device not found" in data["error"]

    # TODO: Add more tests:
    # - Test for /api/android/devices with various key file contents (empty, malformed)
    # - Test for /api/android/devices with devices that have no .plist or .keys files (should still appear from DB)
    # - Test for /api/android/scan_result with invalid timestamp format
    # - Test for /api/android/scan_result with missing optional battery_level
    # - Test for /api/android/device_status with missing payload fields
    # - Test that another user cannot access/update devices of 'testuser'
    # - Consider testing the UserDataService._load_private_keys_from_keys_file directly if it's complex

    def test_another_user_cannot_access_devices(self, client, app_fixture):
        # Create another user
        with app_fixture.app_context():
            other_user = User(username="otheruser", email="other@example.com")
            other_user.set_password("otherpassword")
            db.session.add(other_user)
            db.session.commit()

            # Device for testuser
            test_user_device = Device(id="testuserdevice", user_username="testuser", name="TestUser's Device")
            db.session.add(test_user_device)
            db.session.commit()

        # Log in as otheruser
        client.post('/auth/login', data=dict(username='otheruser', password='otherpassword'), follow_redirects=True)

        # Try to update testuser's device
        payload_scan = {
            "device_id": "testuserdevice",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "battery_level": 50
        }
        response_scan = client.post('/api/android/scan_result', json=payload_scan)
        assert response_scan.status_code == 404 # Device not found for otheruser

        payload_status = {
            "device_id": "testuserdevice",
            "status": "nearby"
        }
        response_status = client.post('/api/android/device_status', json=payload_status)
        assert response_status.status_code == 404 # Device not found for otheruser

        # Log out otheruser
        client.get('/auth/logout', follow_redirects=True)

        # Verify testuser's device was not changed
        with app_fixture.app_context():
            original_device = Device.query.get("testuserdevice")
            assert original_device.android_battery_level is None
            assert original_device.android_device_status is None

```
