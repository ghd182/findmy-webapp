package com.gh182.findmy.scanner

import android.Manifest
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64 // For Base64 decoding
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.app.PendingIntent
import com.gh182.findmy.FindMyApplication
import com.gh182.findmy.MainActivity
import com.gh182.findmy.R
import com.gh182.findmy.network.ApiService // Will be used for posting results
import com.gh182.findmy.network.model.DeviceConfig
import com.gh182.findmy.network.model.ScanResultPayload
import com.gh182.findmy.utils.EncryptedStorageManager // Added for secure storage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.Date
import java.util.concurrent.TimeUnit
import kotlin.experimental.and

// TODO: Inject ApiService and other dependencies via Hilt/Dagger later
class BluetoothScannerService : Service() {

    private val binder = LocalBinder()
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    // TODO: Inject ApiService properly later
    private var apiService: ApiService? = null // Placeholder for actual injection
    private lateinit var encryptedStorageManager: EncryptedStorageManager // Added
    private lateinit var bluetoothManager: BluetoothManager
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothLeScanner: BluetoothLeScanner? = null

    private var isScanning = false
    private val handler = Handler(Looper.getMainLooper())

    // Store the device configurations and keys obtained from the backend
    @Volatile // Ensure visibility across threads, though updates should be synchronized or on main thread
    private var deviceKeysList: List<DeviceConfig> = emptyList()
    private val lastSeenTimestamps: MutableMap<String, Long> = ConcurrentHashMap() // deviceId to timestamp
    private val missingCheckHandler = Handler(Looper.getMainLooper())
    private var isMissingDeviceCheckScheduled = false


    // LiveData or Callback for notifying UI about found devices
    // val foundDeviceLiveData = MutableLiveData<DeviceConfig>() // Example

    companion object {
        private const val TAG = "BluetoothScannerSvc"
        const val ACTION_START_SCANNING_CYCLE = "com.gh182.findmy.scanner.ACTION_START_SCANNING_CYCLE"
        const val ACTION_STOP_SCANNING_CYCLE = "com.gh182.findmy.scanner.ACTION_STOP_SCANNING_CYCLE"
        private const val MISSING_DEVICE_NOTIFICATION_ID_OFFSET = 1000 // To avoid collision with other notifications
        private const val MISSING_DEVICE_CHECK_INTERVAL_MS: Long = TimeUnit.MINUTES.toMillis(5) // Check every 5 minutes
        private const val DEVICE_MISSING_THRESHOLD_MS: Long = TimeUnit.MINUTES.toMillis(30) // Device considered missing after 30 minutes

        // Scan parameters - adjust as needed
        private const val SCAN_PERIOD: Long = TimeUnit.SECONDS.toMillis(15) // Scan for 15 seconds
        private const val SCAN_INTERVAL: Long = TimeUnit.SECONDS.toMillis(30) // Wait 30 seconds before next scan cycle (includes scan period)
        private const val APPLE_MANUFACTURER_ID = 0x004C // Apple's Manufacturer ID
        private const val FINDMY_AD_TYPE = 0x12 // Find My advertisement type
        private const val EXPECTED_FINDMY_DATA_LENGTH = 25 // Expected length for the relevant part of Find My Offline Ad
                                                        // (public key [22 bytes] + 1 status byte + 2 first public key bytes for hint)
                                                        // This might vary based on the specific Find My version/payload.
    }

    inner class LocalBinder : Binder() {
        fun getService(): BluetoothScannerService = this@BluetoothScannerService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager.adapter
        encryptedStorageManager = EncryptedStorageManager(applicationContext) // Initialize here

        if (bluetoothAdapter == null || !bluetoothAdapter!!.isEnabled) {
            Log.e(TAG, "Bluetooth is not enabled or not available.")
            stopSelf()
            return
        }
        bluetoothLeScanner = bluetoothAdapter?.bluetoothLeScanner

        // Load keys from encrypted storage on service creation
        loadKeysFromStorage()

        // TODO: Initialize ApiService instance, via DI is best.
        // Or, the service could create its own ApiService instance using NetworkModule
        // if NetworkModule is updated to handle dynamic URLs from UserPreferencesRepository.
        // Example:
        // val userPrefs = UserPreferencesRepository.getInstance(applicationContext)
        // val serverUrl = runBlocking { userPrefs.serverUrl.firstOrNull() } // Be careful with runBlocking
        // if (!serverUrl.isNullOrEmpty()) {
        //     apiService = NetworkModule.provideApiService(serverUrl) // Assuming NetworkModule is adapted
        // } else {
        //     Log.e(TAG, "Server URL not available, ApiService not initialized.")
        // }

        Log.d(TAG, "BluetoothScannerService created.")
    }

    private fun loadKeysFromStorage() {
        val loadedKeys = encryptedStorageManager.getDeviceConfigs()
        if (!loadedKeys.isNullOrEmpty()) {
            this.deviceKeysList = loadedKeys
            // Initialize lastSeenTimestamps for newly loaded keys if not already present
            val currentTime = System.currentTimeMillis()
            loadedKeys.forEach { device ->
                lastSeenTimestamps.putIfAbsent(device.id, currentTime)
            }
            Log.i(TAG, "Loaded ${loadedKeys.size} device configs from encrypted storage.")
        } else {
            Log.i(TAG, "No device configs found in encrypted storage, or failed to load.")
            // Optionally, trigger a key fetch from backend if keys are essential for immediate operation
            // fetchKeysFromBackendIfNeeded()
        }
    }

    // TODO: Implement fetchKeysFromBackendIfNeeded() that uses apiService to get keys
    // and then calls updateDeviceKeys(). This could be called if storage is empty
    // or periodically.

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand received: ${intent?.action}")
        when (intent?.action) {
            ACTION_START_SCANNING_CYCLE -> {
                Log.i(TAG, "Scan cycle explicitly started via onStartCommand.")
                startScanning()
                if (!isMissingDeviceCheckScheduled) {
                    scheduleMissingDeviceCheck()
                    isMissingDeviceCheckScheduled = true
                }
            }
            ACTION_STOP_SCANNING_CYCLE -> {
                Log.i(TAG, "Scan cycle explicitly stopped via onStartCommand.")
                stopScanning()
                missingCheckHandler.removeCallbacksAndMessages(null)
                isMissingDeviceCheckScheduled = false
                stopSelf()
            }
        }
        return START_STICKY
    }


    // Call this method when ApiService is available (e.g., from a DI framework or activity binding)
    // If the service is started by the worker, direct DI or a application-level singleton might be better.
    fun setApiService(apiService: ApiService) {
        this.apiService = apiService
    }

    fun updateDeviceKeys(newKeys: List<DeviceConfig>) {
        Log.d(TAG, "Updating and saving device keys. New count: ${newKeys.size}")
        val currentTime = System.currentTimeMillis()
        val newDeviceIds = newKeys.map { it.id }.toSet()

        // Update timestamps: add new devices, remove old ones no longer in the list
        lastSeenTimestamps.keys.retainAll { it in newDeviceIds } // Remove old
        newKeys.forEach { device ->
            lastSeenTimestamps.putIfAbsent(device.id, currentTime) // Add new, keep existing if present
        }

        this.deviceKeysList = newKeys // Update the list used for scanning
        encryptedStorageManager.saveDeviceConfigs(newKeys)
        Log.i(TAG, "Device keys saved to encrypted storage.")

        if (isScanning) {
            Log.d(TAG, "Device keys updated during an active scan. New keys will be used for subsequent matches.")
        }
    }

    fun startScanning() {
        if (isScanning) {
            Log.d(TAG, "Scan cycle already in progress; ensuring keys are loaded.")
        }
        if (deviceKeysList.isEmpty()) {
            Log.w(TAG, "Device keys list is empty. Attempting to load from storage before starting scan.")
            loadKeysFromStorage()
            if (deviceKeysList.isEmpty()) {
                Log.e(TAG, "Device keys are still empty after trying to load. Scan might be ineffective. Consider fetching from backend.")
                // Optionally, prevent scan or trigger a fetch:
                // fetchKeysFromBackendIfNeeded()
                // return // if keys are essential to even start
            }
        }
        if (isScanning) { // Re-check after potential key load
            Log.d(TAG, "Scan cycle already in progress (re-checked).")
            return
        }
        if (bluetoothLeScanner == null) {
            Log.e(TAG, "BluetoothLeScanner not initialized. Cannot start scan.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission not granted. Cannot start scan.")
            // TODO: Notify UI to request permission if this happens after initial app launch checks
            return
        }
        Log.i(TAG, "Starting BLE scan cycle (scan -> wait -> scan ...).")
        scheduleNextScan(0) // Start immediately
    }

    fun stopScanning() {
        Log.i(TAG, "Stopping BLE scan cycle permanently.")
        isScanning = false // Prevent further scans from being scheduled by onScanFailed or postDelayed
        handler.removeCallbacksAndMessages(null) // Clear any pending scan operations
        stopBleScanActual() // Stop any active scan
    }

    private fun scheduleNextScan(delayMillis: Long) {
        handler.postDelayed({
            if (!bluetoothAdapter!!.isEnabled) {
                Log.e(TAG, "Bluetooth disabled, stopping scan cycle.")
                stopScanning()
                return@postDelayed
            }
            startBleScanActual() // Start the scan
            // Schedule the scan to stop after SCAN_PERIOD
            handler.postDelayed({
                stopBleScanActual()
                // Schedule the next scan after SCAN_INTERVAL (from the start of the current scan)
                if(isScanning) { // Check if stopScanning() was called externally
                    Log.d(TAG, "Scan period ended. Scheduling next scan.")
                    scheduleNextScan(SCAN_INTERVAL - SCAN_PERIOD)
                }
            }, SCAN_PERIOD)
        }, delayMillis)
        isScanning = true // Mark that a scan cycle is active or scheduled
    }


    private fun startBleScanActual() {
        if (bluetoothLeScanner == null || !bluetoothAdapter!!.isEnabled) {
            Log.e(TAG, "Cannot start actual scan: BluetoothLeScanner not available or Bluetooth disabled.")
            isScanning = false
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission not granted when trying to start actual scan.")
            isScanning = false
            return
        }

        val scanFilters: MutableList<ScanFilter> = ArrayList()
        // Example: Filter for Apple devices if desired, though not strictly necessary as we check manufacturer data
        // val appleFilter = ScanFilter.Builder().setManufacturerData(APPLE_MANUFACTURER_ID, ByteArray(0)).build()
        // scanFilters.add(appleFilter)

        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0) // Report results immediately
            .build()

        Log.d(TAG, "Starting actual BLE scan...")
        bluetoothLeScanner?.startScan(scanFilters, scanSettings, leScanCallback)
    }

    private fun stopBleScanActual() {
        if (bluetoothLeScanner == null) {
             Log.e(TAG, "BluetoothLeScanner not available when trying to stop scan.")
            return
        }
         if (!bluetoothAdapter!!.isEnabled) {
            // Don't attempt to stop scan if BT is off, it might cause issues or be unnecessary
            Log.w(TAG, "Bluetooth disabled, no need to explicitly stop scan through LeScanner.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission not granted when trying to stop scan.")
            return
        }
        Log.d(TAG, "Stopping actual BLE scan.")
        bluetoothLeScanner?.stopScan(leScanCallback)
    }

    private val leScanCallback: ScanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            super.onScanResult(callbackType, result)
            // Log.v(TAG, "Device found: ${result.device.address} - RSSI: ${result.rssi}")
            processScanResult(result)
        }

        override fun onBatchScanResults(results: List<ScanResult>) {
            super.onBatchScanResults(results)
            Log.d(TAG, "Batch scan results received: ${results.size}")
            for (result in results) {
                processScanResult(result)
            }
        }

        override fun onScanFailed(errorCode: Int) {
            super.onScanFailed(errorCode)
            Log.e(TAG, "BLE Scan Failed: Error Code: $errorCode")
            // Consider a backoff strategy or attempt to restart scan after a delay
            // For now, it will stop the current scan attempt, and the cycle will try to restart if `isScanning` is true.
            // If it fails consistently, the scan cycle might effectively stop.
            // Potentially call stopScanning() to halt the cycle if error is persistent or critical
            if (errorCode == SCAN_FAILED_ALREADY_STARTED) {
                Log.w(TAG, "Scan failed because it was already started. This might be a race condition or an issue with start/stop logic.")
            } else if (errorCode == SCAN_FAILED_APPLICATION_REGISTRATION_FAILED) {
                Log.e(TAG, "Scan failed because app could not be registered. Critical error.")
                stopScanning() // Stop the cycle on critical errors
            } else if (errorCode == SCAN_FAILED_INTERNAL_ERROR) {
                Log.e(TAG, "Scan failed due to internal error. May recover.")
            } else if (errorCode == SCAN_FAILED_FEATURE_UNSUPPORTED) {
                Log.e(TAG, "Scan failed because feature is unsupported. Critical error.")
                stopScanning() // Stop the cycle
            }
        }
    }

    private fun processScanResult(scanResult: ScanResult) {
        val scanRecord = scanResult.scanRecord ?: return
        val manufacturerData = scanRecord.getManufacturerSpecificData(APPLE_MANUFACTURER_ID)

        if (manufacturerData == null || manufacturerData.size < EXPECTED_FINDMY_DATA_LENGTH) {
            // Log.v(TAG, "Device ${scanResult.device.address} - Not Apple or too short Manufacturer Data (${manufacturerData?.size ?: "null"})")
            return
        }

        // The relevant part of the Find My advertisement payload (Offline GATTPacket)
        // This usually starts with the type (0x12 for Find My) and length.
        // The actual public key might be offset within these bytes.
        // Assuming the first byte is the type (e.g., 0x12 for Find My)
        // and the second byte is the length of the rest of the data.
        // This parsing is highly dependent on Apple's current specification.
        // For Find My, it's often:
        // Byte 0: Type (e.g., 0x12)
        // Byte 1: Length of remaining data (e.g., 0x1C for 28 bytes total after this)
        // Byte 2: Status byte
        // Byte 3-4: Hint (first 2 bytes of public key)
        // Byte 5-26: Actual 22 bytes of the public key
        // Byte 27: First byte of MAC address (if present and part of this payload)
        // Byte 28: Second byte of MAC address (if present)
        // This is a simplified example. The actual structure needs verification.

        if (manufacturerData[0] != FINDMY_AD_TYPE.toByte()) {
            // Log.v(TAG, "Device ${scanResult.device.address} - Not FindMy type (Type: ${manufacturerData[0]})")
            return
        }

        // Extract the part of the advertisement data that is likely the public key
        // This needs to be the 22-byte public key for comparison.
        // The exact offset and length depend on the Find My advertisement structure.
        // Assuming bytes 5-26 (inclusive) are the 22-byte public key in this example.
        val publicKeyCandidateBytes: ByteArray
        try {
            // Example: Extracting a 22-byte key starting from a certain offset
            // The offset 5 is based on the example structure: Type(1) + Length(1) + Status(1) + Hint(2) = 5
            val keyOffset = 5
            if (manufacturerData.size >= keyOffset + 22) {
                publicKeyCandidateBytes = manufacturerData.sliceArray(keyOffset until keyOffset + 22)
            } else {
                // Log.d(TAG, "Device ${scanResult.device.address} - FindMy Ad data too short for key (Size: ${manufacturerData.size})")
                return
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error slicing manufacturer data for ${scanResult.device.address}", e)
            return
        }


        for (deviceConfig in deviceKeysList) {
            for (keyInfo in deviceConfig.keys) {
                try {
                    val expectedKeyBytes = Base64.decode(keyInfo.advKeyB64, Base64.URL_SAFE)

                    // Direct comparison for now.
                    // TODO: Implement time-based key generation/matching for .plist and interval logic for .keys if needed.
                    // For .keys (STATIC_KEYS_FILE): The backend currently sends derived advertisement keys.
                    // For .plist (ROLLING_PUBLIC_KEY, etc.): The backend sends a list of currently valid keys.
                    if (publicKeyCandidateBytes.contentEquals(expectedKeyBytes)) {
                        Log.i(TAG, "MATCH FOUND for device: ${deviceConfig.name} (${deviceConfig.id}) with key ${keyInfo.advKeyB64}")
                        lastSeenTimestamps[deviceConfig.id] = System.currentTimeMillis() // Update last seen time
                        // foundDeviceLiveData.postValue(deviceConfig) // Notify UI

                        // Send result to backend
                        if (apiService != null) {
                            val timestamp = Date().toInstant().toString() // ISO 8601
                            val battery: Int? = null // Placeholder: TODO: Extract battery level
                            val payload = ScanResultPayload(deviceConfig.id, timestamp, battery)
                            serviceScope.launch {
                                try {
                                    apiService?.postScanResult(payload)
                                    Log.d(TAG, "Scan result posted for ${deviceConfig.id}")
                                } catch (e: Exception) {
                                    Log.e(TAG, "Error posting scan result for ${deviceConfig.id}", e)
                                }
                            }
                        } else {
                            Log.w(TAG, "ApiService not available. Cannot post scan result for ${deviceConfig.id}")
                        }
                        return // Found a match for this scan result, process next scan result
                    }
                } catch (e: IllegalArgumentException) {
                    Log.e(TAG, "Error decoding Base64 key ${keyInfo.advKeyB64} for device ${deviceConfig.name}", e)
                } catch (e: Exception) {
                    Log.e(TAG, "Unexpected error during key matching for ${deviceConfig.name}", e)
                }
            }
        }
    }

    override fun onDestroy() {
        Log.d(TAG, "BluetoothScannerService destroyed.")
        stopScanning()
        missingCheckHandler.removeCallbacksAndMessages(null)
        isMissingDeviceCheckScheduled = false
        serviceJob.cancel() // Cancel coroutines
        super.onDestroy()
    }

    private fun scheduleMissingDeviceCheck() {
        missingCheckHandler.postDelayed(object : Runnable {
            override fun run() {
                checkAndNotifyForMissingDevices()
                if (isScanning || isMissingDeviceCheckScheduled) { // Reschedule only if service is meant to be active
                    missingCheckHandler.postDelayed(this, MISSING_DEVICE_CHECK_INTERVAL_MS)
                }
            }
        }, MISSING_DEVICE_CHECK_INTERVAL_MS)
    }

    private fun checkAndNotifyForMissingDevices() {
        val currentTime = System.currentTimeMillis()
        Log.d(TAG, "Checking for missing devices at $currentTime")
        // Create a copy of deviceKeysList for safe iteration if it can be modified concurrently
        val currentDeviceList = ArrayList(deviceKeysList)

        currentDeviceList.forEach { device ->
            val lastSeen = lastSeenTimestamps[device.id] ?: currentTime // Assume current time if never seen (won't trigger missing yet)
            if ((currentTime - lastSeen) > DEVICE_MISSING_THRESHOLD_MS) {
                Log.w(TAG, "Device ${device.name} (${device.id}) is considered missing. Last seen: $lastSeen")
                sendMissingDeviceNotification(device)
                // Optionally, update device status on backend if needed
                // To prevent re-notifying immediately, one might update lastSeenTimestamp here to currentTime,
                // or maintain a separate set of 'notifiedMissing' devices.
                // For simplicity, current logic might re-notify every check interval if device remains unseen.
            }
        }
    }

    private fun sendMissingDeviceNotification(device: DeviceConfig) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted. Cannot send missing device notification.")
            // TODO: App should ideally request this permission at runtime if not granted.
            return
        }

        // Intent to open MainActivity when notification is tapped
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            // TODO: Optionally add extras to navigate to a specific device details page
            // putExtra("device_id_to_show", device.id)
        }
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        // Unique request code for each PendingIntent using device.id.hashCode()
        val pendingIntent: PendingIntent = PendingIntent.getActivity(this, device.id.hashCode(), intent, pendingIntentFlags)


        val notificationTitle = getString(R.string.notification_missing_device_title_template, device.name ?: device.id)
        val notificationText = getString(R.string.notification_missing_device_text_template, device.name ?: device.id)

        val builder = NotificationCompat.Builder(this, FindMyApplication.MISSING_DEVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_icon) // Replace with actual app icon (e.g. ic_stat_tracker_alert)
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true) // Dismiss notification when tapped
            .setOnlyAlertOnce(true) // Alert once per device being marked missing (until seen again or state changes)
            // .setDeleteIntent(createOnDismissIntent(device.id)) // Optional: Handle swipe dismissal for re-arming

        with(NotificationManagerCompat.from(this)) {
            // notificationId is a unique int for each notification.
            // Using device.id.hashCode() to try and get a unique ID per device.
            // Add offset to avoid collision with other potential notifications from other app parts.
            val notificationId = MISSING_DEVICE_NOTIFICATION_ID_OFFSET + device.id.hashCode()
            try {
                notify(notificationId, builder.build())
                Log.i(TAG, "Missing device notification sent for ${device.name} (${device.id}) with ID $notificationId")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException while sending notification for ${device.name}. POST_NOTIFICATIONS permission revoked?", e)
            }
        }
    }
}
