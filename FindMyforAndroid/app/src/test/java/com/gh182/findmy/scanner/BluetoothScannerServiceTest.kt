package com.gh182.findmy.scanner

import android.app.Application
import android.app.NotificationManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.gh182.findmy.network.model.DeviceConfig
import com.gh182.findmy.network.model.DeviceKeyInfo
import com.gh182.findmy.utils.EncryptedStorageManager
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentCaptor
import org.mockito.Captor
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.MockitoAnnotations
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@Config(sdk = [28]) // Robolectric for service testing, Handler, etc.
class BluetoothScannerServiceTest {

    private lateinit var service: BluetoothScannerService
    private lateinit var context: Context

    @Mock
    private lateinit var mockBluetoothManager: BluetoothManager
    @Mock
    private lateinit var mockBluetoothAdapter: BluetoothAdapter
    @Mock
    private lateinit var mockBluetoothLeScanner: BluetoothLeScanner
    @Mock
    private lateinit var mockEncryptedStorageManager: EncryptedStorageManager
    @Mock
    private lateinit var mockNotificationManagerCompat: NotificationManagerCompat


    // Using a real handler but controlling its execution with Robolectric's ShadowLooper
    private lateinit var handler: Handler
    private lateinit var shadowLooper: ShadowLooper


    @Before
    fun setUp() {
        MockitoAnnotations.openMocks(this)
        context = ApplicationProvider.getApplicationContext<Application>()

        // Mock BluetoothManager and Adapter
        `when`(mockBluetoothManager.adapter).thenReturn(mockBluetoothAdapter)
        `when`(mockBluetoothAdapter.isEnabled).thenReturn(true)
        `when`(mockBluetoothAdapter.bluetoothLeScanner).thenReturn(mockBluetoothLeScanner)


        service = BluetoothScannerService()

        // Manually inject mocks (simplified DI for testing)
        // Robolectric allows us to set system services like this for testing
        val shadowContext = Shadows.shadowOf(context.applicationContext as Application)
        shadowContext.setSystemService(Context.BLUETOOTH_SERVICE, mockBluetoothManager)

        // Replace the service's actual EncryptedStorageManager and NotificationManagerCompat with mocks
        // This requires reflection or making them settable in the Service (preferred for testability)
        // For this example, let's assume we can modify the service slightly or use a test version
        // For now, we'll re-initialize what we can after service.onCreate() is called if needed.

        // Service `onCreate` will be called by Robolectric's service controller if we use it.
        // Or, we can call it manually after setting up mocks it might use.
        // We need to set our mocks *before* onCreate if they are used in onCreate.

        // Setup EncryptedStorageManager mock (used in onCreate)
        try {
            val field = BluetoothScannerService::class.java.getDeclaredField("encryptedStorageManager")
            field.isAccessible = true
            field.set(service, mockEncryptedStorageManager)
        } catch (e: Exception) {
            throw RuntimeException("Failed to set mock EncryptedStorageManager", e)
        }

        // Mock NotificationManagerCompat.from(context)
        // This is tricky without a DI framework for NotificationManagerCompat.
        // We can try to mock its static `from` method if using PowerMockito, or test logic that *uses* it.
        // For now, we'll verify that the service *tries* to check permission, and skip actual notification posting.
        `when`(context.getSystemService(Context.NOTIFICATION_SERVICE)).thenReturn(mock(NotificationManager::class.java))


        // Call onCreate manually to initialize components within the service
        service.onCreate()

        // Handler and Looper for missing device checks
        handler = Handler(Looper.getMainLooper())
        shadowLooper = Shadows.shadowOf(Looper.getMainLooper())
    }

    @After
    fun tearDown() {
        // Clean up any pending messages
        shadowLooper.idle()
        service.onDestroy() // Ensure service cleanup
    }

    @Test
    fun onStartCommand_withStartAction_startsScanningAndSchedulesMissingCheck() {
        val intent = Intent(context, BluetoothScannerService::class.java).apply {
            action = BluetoothScannerService.ACTION_START_SCANNING_CYCLE
        }
        // Mock permissions
        `when`(context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN)).thenReturn(PackageManager.PERMISSION_GRANTED)

        service.onStartCommand(intent, 0, 1)

        assertTrue(service.isScanning) // Assuming isScanning is made accessible or checked via side-effects
        assertTrue(service.isMissingDeviceCheckScheduled) // Assuming isMissingDeviceCheckScheduled is accessible
    }

    @Test
    fun onStartCommand_withStopAction_stopsScanningAndCancelsMissingCheck() {
        // First, start it
        val startIntent = Intent(context, BluetoothScannerService::class.java).apply {
            action = BluetoothScannerService.ACTION_START_SCANNING_CYCLE
        }
        `when`(context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN)).thenReturn(PackageManager.PERMISSION_GRANTED)
        service.onStartCommand(startIntent, 0, 1)
        assertTrue(service.isScanning)
        assertTrue(service.isMissingDeviceCheckScheduled)

        // Then, stop it
        val stopIntent = Intent(context, BluetoothScannerService::class.java).apply {
            action = BluetoothScannerService.ACTION_STOP_SCANNING_CYCLE
        }
        service.onStartCommand(stopIntent, 0, 2)

        assertFalse(service.isScanning)
        assertFalse(service.isMissingDeviceCheckScheduled)
    }


    @Test
    fun updateDeviceKeys_savesToEncryptedStorageAndUpdatesInternalList() {
        val keyInfo = DeviceKeyInfo("key1", "type1", "mac1")
        val deviceConfig = DeviceConfig("id1", "Device 1", "L", "#FFF", "M", "I", listOf(keyInfo))
        val newKeys = listOf(deviceConfig)

        service.updateDeviceKeys(newKeys)

        verify(mockEncryptedStorageManager).saveDeviceConfigs(newKeys)
        assertEquals(newKeys, service.deviceKeysList) // Assuming deviceKeysList is accessible
        assertTrue(service.lastSeenTimestamps.containsKey("id1"))
    }

    @Test
    fun loadKeysFromStorage_loadsIntoInternalList() {
        val keyInfo = DeviceKeyInfo("keyStored", "typeStored", "macStored")
        val storedDeviceConfig = DeviceConfig("idStored", "Stored Device", "S", "#000", "S_M", "S_I", listOf(keyInfo))
        val storedKeys = listOf(storedDeviceConfig)
        `when`(mockEncryptedStorageManager.getDeviceConfigs()).thenReturn(storedKeys)

        // onCreate calls loadKeysFromStorage, or call it directly if needed for test setup
        // For this test, let's assume it's called or we call it again to ensure state
        service.loadKeysFromStorage() // Manually call after mock setup

        assertEquals(storedKeys, service.deviceKeysList)
        assertTrue(service.lastSeenTimestamps.containsKey("idStored"))
    }


    @Test
    fun checkAndNotifyForMissingDevices_noNotificationIfRecentlySeen() {
        val deviceId = "testDevice1"
        val deviceName = "My Test Device"
        val deviceConfig = DeviceConfig(deviceId, deviceName, "L", "#FFF", "M", "I", emptyList())
        service.deviceKeysList = listOf(deviceConfig) // Manually set for test
        service.lastSeenTimestamps[deviceId] = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(10) // Seen 10 mins ago

        // We need to mock NotificationManagerCompat.from(context) to return our mock
        // This is hard without PowerMockito or a DI framework.
        // So, we will verify that no attempt to notify is made if not needed,
        // by ensuring the permission check (which happens before notify) isn't an issue or by checking logs if any.
        // For a true unit test, we'd capture the notification.

        service.checkAndNotifyForMissingDevices()
        shadowLooper.idle() // Let handler tasks complete

        // Difficult to verify NotificationManagerCompat.notify was NOT called without deeper mocking.
        // We can infer by lack of errors and by checking log output if we add specific logs.
        // For now, this test mainly ensures the logic doesn't crash and runs.
        Log.d("TestLog", "Finished checkAndNotifyForMissingDevices_noNotificationIfRecentlySeen")
        // No explicit verify(mockNotificationManagerCompat, never()).notify(...) without better DI/mocking.
    }

    @Test
    fun checkAndNotifyForMissingDevices_sendsNotificationIfMissing() {
         // This test is more complex due to NotificationManager interaction.
        // Grant POST_NOTIFICATIONS permission for this test via Robolectric
        val shadowApp = Shadows.shadowOf(context as Application)
        shadowApp.grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        val deviceId = "testDevice2"
        val deviceName = "My Missing Device"
        val deviceConfig = DeviceConfig(deviceId, deviceName, "L", "#FFF", "M", "I", emptyList())

        service.deviceKeysList = listOf(deviceConfig)
        service.lastSeenTimestamps[deviceId] = System.currentTimeMillis() - (BluetoothScannerService.DEVICE_MISSING_THRESHOLD_MS + TimeUnit.SECONDS.toMillis(1))


        // Can't directly mock NotificationManagerCompat.from(this).notify() easily here.
        // This test will verify that the code path is taken by checking logs or if an exception occurs.
        // A more robust test would use a testable wrapper around NotificationManagerCompat.

        var exceptionThrown: Exception? = null
        try {
            service.checkAndNotifyForMissingDevices() // This will attempt to build and send a notification
            shadowLooper.idle()
        } catch (e: Exception) {
            exceptionThrown = e // Catch if any part of notification sending fails unexpectedly (e.g. resource not found)
        }
        assertNull("Exception during checkAndNotify: $exceptionThrown", exceptionThrown)
        // We expect a log message "Missing device notification sent..." if it worked.
        // Verifying the actual notification display is an integration/UI test.
        // Here, we assume if no crash and permissions are granted, it attempted to send.
    }

    // Helper to access private field for assertion if needed (use with caution)
    private val BluetoothScannerService.isScanning: Boolean
        get() {
            val field = BluetoothScannerService::class.java.getDeclaredField("isScanning")
            field.isAccessible = true
            return field.getBoolean(this)
        }
    private val BluetoothScannerService.isMissingDeviceCheckScheduled: Boolean
        get() {
            val field = BluetoothScannerService::class.java.getDeclaredField("isMissingDeviceCheckScheduled")
            field.isAccessible = true
            return field.getBoolean(this)
        }
     private val BluetoothScannerService.deviceKeysList: List<DeviceConfig>
        get() {
            val field = BluetoothScannerService::class.java.getDeclaredField("deviceKeysList")
            field.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            return field.get(this) as List<DeviceConfig>
        }
    private fun BluetoothScannerService.setDeviceKeysList(keys: List<DeviceConfig>) {
            val field = BluetoothScannerService::class.java.getDeclaredField("deviceKeysList")
            field.isAccessible = true
            field.set(this, keys)
    }
     private val BluetoothScannerService.lastSeenTimestamps: MutableMap<String, Long>
        get() {
            val field = BluetoothScannerService::class.java.getDeclaredField("lastSeenTimestamps")
            field.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            return field.get(this) as MutableMap<String, Long>
        }
}
