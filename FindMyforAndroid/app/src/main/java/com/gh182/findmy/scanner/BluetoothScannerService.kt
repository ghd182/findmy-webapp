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
import android.location.Location
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.gh182.findmy.R
import com.gh182.findmy.network.ApiService // Will be used for posting results
import com.gh182.findmy.network.model.DeviceConfig
import com.gh182.findmy.network.model.GeofenceInfo // Added
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
    private val lastSeenTimestamps: MutableMap<String, Long> = ConcurrentHashMap()
    private val missingCheckHandler = Handler(Looper.getMainLooper())
    private var isMissingDeviceCheckScheduled = false

    // Location and Geofence members
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var isGeofenceMonitoringActive = false
    private val deviceGeofenceStates: MutableMap<Pair<String, String>, Boolean> = ConcurrentHashMap() // Pair(deviceId, geofenceId) -> isInside
    private var locationRequest: LocationRequest? = null
    private var locationCallback: LocationCallback? = null


    // LiveData or Callback for notifying UI about found devices
    // val foundDeviceLiveData = MutableLiveData<DeviceConfig>() // Example

    companion object {
        private const val TAG = "BluetoothScannerSvc"
        const val ACTION_START_SCANNING_CYCLE = "com.gh182.findmy.scanner.ACTION_START_SCANNING_CYCLE"
        const val ACTION_STOP_SCANNING_CYCLE = "com.gh182.findmy.scanner.ACTION_STOP_SCANNING_CYCLE"
        const val ACTION_START_GEOFENCE_MONITORING = "com.gh182.findmy.scanner.ACTION_START_GEOFENCE_MONITORING"
        const val ACTION_STOP_GEOFENCE_MONITORING = "com.gh182.findmy.scanner.ACTION_STOP_GEOFENCE_MONITORING"

        private const val MISSING_DEVICE_NOTIFICATION_ID_OFFSET = 1000
        private const val GEOFENCE_NOTIFICATION_ID_OFFSET = 2000
        private const val LOW_BATTERY_NOTIFICATION_ID_OFFSET = 3000 // New for low battery
        const val GEOFENCE_EVENT_CHANNEL_ID = "geofence_event_channel"
        const val BATTERY_ALERTS_CHANNEL_ID = "battery_alerts_channel" // New channel for battery

        private const val MISSING_DEVICE_CHECK_INTERVAL_MS: Long = TimeUnit.MINUTES.toMillis(5)
        private const val DEVICE_MISSING_THRESHOLD_MS: Long = TimeUnit.MINUTES.toMillis(30)
        private const val LOCATION_UPDATE_INTERVAL_MS: Long = TimeUnit.MINUTES.toMillis(1)
        private const val FASTEST_LOCATION_UPDATE_INTERVAL_MS: Long = TimeUnit.SECONDS.toMillis(30)

        const val LOW_BATTERY_THRESHOLD_PERCENTAGE = 20 // Threshold for low battery
        private const val LOW_BATTERY_NOTIFICATION_COOLDOWN_MS: Long = TimeUnit.HOURS.toMillis(4) // Notify every 4 hours for low battery


        // Scan parameters - adjust as needed
        private const val SCAN_PERIOD: Long = TimeUnit.SECONDS.toMillis(20) // Scan for 20 seconds per worker trigger
        // SCAN_INTERVAL is now primarily controlled by the Worker's periodicity (e.g., 15 mins)
        // private const val SCAN_INTERVAL: Long = TimeUnit.SECONDS.toMillis(30)
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
        encryptedStorageManager = EncryptedStorageManager(applicationContext)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this) // Initialize FusedLocationProviderClient

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
            val currentTime = System.currentTimeMillis()
            loadedKeys.forEach { device ->
                lastSeenTimestamps.putIfAbsent(device.id, currentTime)
                device.linkedGeofences.forEach { geofence ->
                    deviceGeofenceStates.putIfAbsent(Pair(device.id, geofence.id), false)
                }
                device.currentBatteryInfo?.let { info -> checkAndNotifyLowBattery(device, info) }
            }
            Log.i(TAG, "Loaded ${loadedKeys.size} device configs from encrypted storage.")
        } else {
            Log.i(TAG, "No device configs found in encrypted storage, or failed to load.")
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
                    scheduleMissingDeviceCheck() // schedules and sets isMissingDeviceCheckScheduled = true
                }
            }
            ACTION_STOP_SCANNING_CYCLE -> {
                Log.i(TAG, "Scan cycle explicitly stopped via onStartCommand.")
                stopScanning()
                missingCheckHandler.removeCallbacksAndMessages(null)
                isMissingDeviceCheckScheduled = false
                if (!isGeofenceMonitoringActive) {
                    stopSelf()
                }
            }
            ACTION_START_GEOFENCE_MONITORING -> {
                Log.i(TAG, "Geofence monitoring explicitly started via onStartCommand.")
                startGeofenceMonitoring()
            }
            ACTION_STOP_GEOFENCE_MONITORING -> {
                Log.i(TAG, "Geofence monitoring explicitly stopped via onStartCommand.")
                stopGeofenceMonitoring()
                if (!isScanning) {
                    stopSelf()
                }
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

        lastSeenTimestamps.keys.retainAll { it in newDeviceIds }
        deviceGeofenceStates.keys.retainAll { it.first in newDeviceIds }

        newKeys.forEach { device ->
            lastSeenTimestamps.putIfAbsent(device.id, currentTime) // Initialize for missing/prolonged checks
            device.linkedGeofences.forEach { geofence ->
                deviceGeofenceStates.putIfAbsent(Pair(device.id, geofence.id), false)
            }
            device.currentBatteryInfo?.let { info -> checkAndNotifyLowBattery(device, info) }
        }

        this.deviceKeysList = newKeys
        encryptedStorageManager.saveDeviceConfigs(newKeys)
        Log.i(TAG, "Device keys saved to encrypted storage. LastSeen, GeofenceStates, and initial battery checks updated.")

        if (isScanning) {
            Log.d(TAG, "Device keys updated during an active scan.")
        }
        if (isGeofenceMonitoringActive) {
            Log.d(TAG, "Geofence monitoring active, may need to re-evaluate states for new/updated devices.")
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
                Log.d(TAG, "Scan period of ${SCAN_PERIOD}ms finished.")
                stopBleScanActual()
                // No longer self-schedules next scan; worker will trigger next cycle.
                isScanning = false // Mark scanning as completed for this cycle
            }, SCAN_PERIOD)
            Log.i(TAG, "BLE Scan scheduled to run for ${SCAN_PERIOD}ms.")
        }, delayMillis)
        // isScanning is set to true inside startBleScanActual if successful
    }


    private fun startBleScanActual() {
        if (isScanning) {
            Log.d(TAG, "Scan already active, not starting another.")
            return
        }
        if (bluetoothLeScanner == null || !bluetoothAdapter!!.isEnabled) {
            Log.e(TAG, "Cannot start actual scan: BluetoothLeScanner not available or Bluetooth disabled.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission not granted when trying to start actual scan.")
            return
        }

        val scanFilters: MutableList<ScanFilter> = ArrayList()
        // Consider adding filters if specific Service UUIDs are known for FindMy devices,
        // though filtering on manufacturer data is often more reliable for these.
        // Example: val appleFilter = ScanFilter.Builder().setManufacturerData(APPLE_MANUFACTURER_ID, ByteArray(0) /*, mask */).build()
        // scanFilters.add(appleFilter)

        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED) // Changed from LOW_LATENCY for better battery
            .setReportDelay(0) // Report results immediately
            .build()

        Log.d(TAG, "Starting actual BLE scan with BALANCED mode...")
        isScanning = true // Set scanning to true before starting
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
                        lastSeenTimestamps[deviceConfig.id] = System.currentTimeMillis()

                        // Reset prolonged absence notification timestamp as device is now seen
                        prolongedAbsenceNotificationTimestamps.remove(deviceConfig.id)
                        // Reset regular missing notification timestamp as well
                        missingNotificationTimestamps.remove(deviceConfig.id)

                        deviceConfig.currentBatteryInfo?.let { info -> checkAndNotifyLowBattery(deviceConfig, info) }

                        if (apiService != null) {
                            val timestamp = Date().toInstant().toString()
                            val batteryLevelForPayload = if (deviceConfig.currentBatteryInfo?.source == "android_app") {
                                deviceConfig.currentBatteryInfo.levelPercentage
                            } else {
                                null
                            }
                            val payload = ScanResultPayload(deviceConfig.id, timestamp, batteryLevelForPayload)
                            serviceScope.launch {
                                try {
                                    val response = apiService?.postScanResult(payload)
                                    if (response != null && response.isSuccessful) {
                                        Log.d(TAG, "Scan result posted successfully for ${deviceConfig.id}")
                                    } else {
                                        Log.e(TAG, "Failed to post scan result for ${deviceConfig.id}. Code: ${response?.code()}, Message: ${response?.message()}")
                                    }
                                } catch (e: Exception) {
                                    Log.e(TAG, "Exception posting scan result for ${deviceConfig.id}", e)
                                }
                            }
                        } else {
                            Log.w(TAG, "ApiService not available. Cannot post scan result for ${deviceConfig.id}")
                        }
                        return
                    }
                } catch (e: IllegalArgumentException) {
                    Log.w(TAG, "Error decoding Base64 key ${keyInfo.advKeyB64} for device ${deviceConfig.name}", e)
                } catch (e: Exception) {
                    Log.e(TAG, "Unexpected error during key matching for ${deviceConfig.name}", e)
                }
            }
        }
    }

    override fun onDestroy() {
        Log.d(TAG, "BluetoothScannerService destroyed.")
        stopScanning()
        stopGeofenceMonitoring()
        missingCheckHandler.removeCallbacksAndMessages(null)
        isMissingDeviceCheckScheduled = false
        serviceJob.cancel()
        super.onDestroy()
    }

    private fun scheduleMissingDeviceCheck() {
        if (isMissingDeviceCheckScheduled) {
            Log.d(TAG, "Missing device check already scheduled.")
            return
        }
        Log.d(TAG, "Scheduling missing device check.")
        isMissingDeviceCheckScheduled = true
        missingCheckHandler.postDelayed(object : Runnable {
            override fun run() {
                // Check if still scheduled before running and rescheduling
                if (!isMissingDeviceCheckScheduled) {
                    Log.d(TAG, "Missing device check was cancelled. Not running or rescheduling.")
                    return
                }
                checkAndNotifyForMissingDevices()
                missingCheckHandler.postDelayed(this, MISSING_DEVICE_CHECK_INTERVAL_MS)
            }
        }, MISSING_DEVICE_CHECK_INTERVAL_MS)
    }

    private fun checkAndNotifyForMissingDevices() {
        val currentTime = System.currentTimeMillis()
        Log.d(TAG, "Checking for missing devices at $currentTime")
        val currentDeviceList = ArrayList(deviceKeysList)

        currentDeviceList.forEach { device ->
            val lastSeen = lastSeenTimestamps[device.id] ?: currentTime
            val deviceId = device.id
            val deviceName = device.name ?: device.id

            if ((currentTime - lastSeen) > PROLONGED_ABSENCE_THRESHOLD_MS) {
                val lastProlongedNotified = prolongedAbsenceNotificationTimestamps[deviceId] ?: 0
                if ((currentTime - lastProlongedNotified) > PROLONGED_ABSENCE_NOTIFICATION_COOLDOWN_MS) {
                    Log.w(TAG, "Device $deviceName (${deviceId}) has a PROLONGED ABSENCE. Last seen: $lastSeen")
                    sendMissingDeviceNotification(device, isProlongedAbsence = true)
                    prolongedAbsenceNotificationTimestamps[deviceId] = currentTime
                    missingNotificationTimestamps[deviceId] = currentTime // Also update regular missing timestamp to avoid double notification
                } else {
                    Log.d(TAG, "Device $deviceName (${deviceId}) prolonged absence notification on cooldown.")
                }
            } else if ((currentTime - lastSeen) > DEVICE_MISSING_THRESHOLD_MS) {
                val lastMissingNotified = missingNotificationTimestamps[deviceId] ?: 0
                if ((currentTime - lastMissingNotified) > MISSING_NOTIFICATION_COOLDOWN_MS) {
                    Log.w(TAG, "Device $deviceName (${deviceId}) is considered MISSING. Last seen: $lastSeen")
                    sendMissingDeviceNotification(device, isProlongedAbsence = false)
                    missingNotificationTimestamps[deviceId] = currentTime
                } else {
                     Log.d(TAG, "Device $deviceName (${deviceId}) missing notification on cooldown.")
                }
            }
        }
    }

    private fun sendMissingDeviceNotification(device: DeviceConfig, isProlongedAbsence: Boolean) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted. Cannot send missing device notification.")
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("device_id_to_show", device.id)
        }
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        // Ensure requestCode is different for prolonged vs regular to allow both notifications if timings align
        val requestCodeSalt = if (isProlongedAbsence) "_prolonged".hashCode() else "_missing".hashCode()
        val pendingIntent: PendingIntent = PendingIntent.getActivity(this, device.id.hashCode() + requestCodeSalt, intent, pendingIntentFlags)

        val deviceName = device.name ?: device.id
        val notificationTitle: String
        val notificationText: String

        if (isProlongedAbsence) {
            notificationTitle = getString(R.string.notification_prolonged_absence_title_template, deviceName)
            notificationText = getString(R.string.notification_prolonged_absence_text_template, deviceName)
        } else {
            notificationTitle = getString(R.string.notification_missing_device_title_template, deviceName)
            notificationText = getString(R.string.notification_missing_device_text_template, deviceName)
        }

        val builder = NotificationCompat.Builder(this, FindMyApplication.MISSING_DEVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_icon) // Placeholder icon
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false) // Allow re-notification after cooldown

        with(NotificationManagerCompat.from(this)) {
            // Unique notification ID: offset + device hash + type specific salt
            val notificationId = MISSING_DEVICE_NOTIFICATION_ID_OFFSET + device.id.hashCode() + requestCodeSalt
            try {
                notify(notificationId, builder.build())
                Log.i(TAG, "Missing/Prolonged notification sent for $deviceName (${device.id}). Prolonged: $isProlongedAbsence. ID: $notificationId")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException while sending missing/prolonged notification for $deviceName. POST_NOTIFICATIONS permission revoked?", e)
            }
        }
    }

    // --- Low Battery Notification Logic ---
    private fun checkAndNotifyLowBattery(device: DeviceConfig, batteryInfo: com.gh182.findmy.network.model.CurrentBatteryInfo) {
        val deviceId = device.id
        val currentTime = System.currentTimeMillis()
        val lastNotified = lowBatteryNotificationTimestamps[deviceId] ?: 0

        var isLow = false
        var levelText = batteryInfo.statusText ?: "N/A"

        if (batteryInfo.levelPercentage != null) {
            levelText = "${batteryInfo.levelPercentage}%"
            if (batteryInfo.levelPercentage <= LOW_BATTERY_THRESHOLD_PERCENTAGE) {
                isLow = true
            }
        } else {
            if (batteryInfo.statusText == "Low" || batteryInfo.statusText == "Very Low") {
                isLow = true
            }
        }

        if (isLow) {
            if ((currentTime - lastNotified) > LOW_BATTERY_NOTIFICATION_COOLDOWN_MS) {
                Log.i(TAG, "Device ${device.name} battery is low ($levelText). Sending notification.")
                sendLowBatteryNotification(device, batteryInfo)
                lowBatteryNotificationTimestamps[deviceId] = currentTime
            } else {
                Log.d(TAG, "Device ${device.name} battery is low ($levelText), but notification is on cooldown.")
            }
        } else {
            // lowBatteryNotificationTimestamps.remove(deviceId) // Optionally reset cooldown if not low
            Log.d(TAG, "Device ${device.name} battery is not low ($levelText).")
        }
    }

    private fun sendLowBatteryNotification(device: DeviceConfig, batteryInfo: com.gh182.findmy.network.model.CurrentBatteryInfo) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted. Cannot send low battery notification.")
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("device_id_to_show", device.id)
        }
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val requestCode = device.id.hashCode() + LOW_BATTERY_NOTIFICATION_ID_OFFSET
        val pendingIntent: PendingIntent = PendingIntent.getActivity(this, requestCode, intent, pendingIntentFlags)

        val batteryLevelString = batteryInfo.levelPercentage?.let { "$it%" } ?: batteryInfo.statusText ?: "Unknown"
        val notificationTitle = getString(R.string.notification_low_battery_title_template, device.name ?: device.id)
        val notificationText = getString(R.string.notification_low_battery_text_template, device.name ?: device.id, batteryLevelString)

        val builder = NotificationCompat.Builder(this, BATTERY_ALERTS_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_icon_battery) // TODO: Create a specific battery icon
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)

        with(NotificationManagerCompat.from(this)) {
            val notificationId = LOW_BATTERY_NOTIFICATION_ID_OFFSET + device.id.hashCode()
            try {
                notify(notificationId, builder.build())
                Log.i(TAG, "Low battery notification sent for ${device.name} (${device.id}) with ID $notificationId")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException while sending low battery notification for ${device.name}. POST_NOTIFICATIONS permission revoked?", e)
            }
        }
    }


    // --- Geofence Methods ---
    private fun startGeofenceMonitoring() {
        if (isGeofenceMonitoringActive) {
            Log.d(TAG, "Geofence monitoring is already active.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Location permission not granted. Cannot start geofence monitoring.")
            // TODO: Notify UI or stop service if this is critical and cannot be obtained.
            return
        }

        // Initialize geofence states based on current known location if possible
        try {
            fusedLocationClient.lastLocation.addOnSuccessListener { location: Location? ->
                if (location != null) {
                    Log.d(TAG, "Initializing geofence states with last known location.")
                    initializeGeofenceStates(location)
                } else {
                    Log.w(TAG, "Last known location is null, geofence states might be initially inaccurate.")
                    initializeGeofenceStates(null) // Initialize all as outside
                }
            }.addOnFailureListener { e ->
                Log.e(TAG, "Error getting last known location for geofence init.", e)
                initializeGeofenceStates(null) // Initialize all as outside on error
            }
        } catch (se: SecurityException) {
             Log.e(TAG, "SecurityException on getLastLocation for geofence init. Perms likely missing.", se)
             initializeGeofenceStates(null)
        }


        locationRequest = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, LOCATION_UPDATE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(FASTEST_LOCATION_UPDATE_INTERVAL_MS)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                locationResult.lastLocation?.let { location ->
                    Log.d(TAG, "Location Update: ${location.latitude}, ${location.longitude}")
                    checkGeofences(location)
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest!!, locationCallback!!, Looper.getMainLooper())
            isGeofenceMonitoringActive = true
            Log.i(TAG, "Started geofence monitoring with location updates.")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException while starting location updates.", e)
            isGeofenceMonitoringActive = false
        }
    }

    private fun initializeGeofenceStates(currentLocation: Location?) {
        deviceKeysList.forEach { device ->
            device.linkedGeofences.forEach { geofence ->
                val stateKey = Pair(device.id, geofence.id)
                if (currentLocation != null) {
                    val distance = FloatArray(1)
                    Location.distanceBetween(currentLocation.latitude, currentLocation.longitude, geofence.latitude, geofence.longitude, distance)
                    deviceGeofenceStates[stateKey] = distance[0] <= geofence.radius
                     Log.d(TAG, "Init state for ${device.name}/${geofence.name}: Inside=${deviceGeofenceStates[stateKey]}, Dist=${distance[0]}")
                } else {
                    deviceGeofenceStates[stateKey] = false // Assume outside if no current location
                }
            }
        }
    }


    private fun stopGeofenceMonitoring() {
        if (!isGeofenceMonitoringActive) {
            Log.d(TAG, "Geofence monitoring is not active.")
            return
        }
        locationCallback?.let {
            try {
                fusedLocationClient.removeLocationUpdates(it)
                Log.i(TAG, "Requested removal of location updates.")
            } catch (e: Exception) {
                 Log.e(TAG, "Error removing location updates: ${e.message}")
            }
        }
        locationCallback = null // Clear callback
        locationRequest = null   // Clear request
        isGeofenceMonitoringActive = false
        Log.i(TAG, "Stopped geofence monitoring.")
    }

    private fun checkGeofences(location: Location) {
        Log.d(TAG, "Checking geofences for ${deviceKeysList.size} devices at location: ${location.latitude}, ${location.longitude}")
        val currentDeviceList = ArrayList(deviceKeysList) // Iterate on a copy

        currentDeviceList.forEach { device ->
            device.linkedGeofences.forEach { geofence ->
                val stateKey = Pair(device.id, geofence.id)
                val previousStateIsInside = deviceGeofenceStates[stateKey] ?: false

                val distanceResults = FloatArray(1)
                Location.distanceBetween(
                    location.latitude, location.longitude,
                    geofence.latitude, geofence.longitude,
                    distanceResults
                )
                val distanceToCenter = distanceResults[0]
                val currentStateIsInside = distanceToCenter <= geofence.radius

                Log.v(TAG, "Device ${device.name} to Geofence ${geofence.name}: Dist=${distanceToCenter}m, Radius=${geofence.radius}m. Inside: $currentStateIsInside (was $previousStateIsInside)")

                if (currentStateIsInside != previousStateIsInside) {
                    deviceGeofenceStates[stateKey] = currentStateIsInside
                    if (currentStateIsInside && geofence.notifyOnEntry) {
                        Log.i(TAG, "Device ${device.name} entered geofence ${geofence.name}")
                        sendGeofenceNotification(device, geofence, isEntry = true)
                    } else if (!currentStateIsInside && geofence.notifyOnExit) {
                        Log.i(TAG, "Device ${device.name} exited geofence ${geofence.name}")
                        sendGeofenceNotification(device, geofence, isEntry = false)
                    }
                }
            }
        }
    }

    private fun sendGeofenceNotification(device: DeviceConfig, geofence: GeofenceInfo, isEntry: Boolean) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "POST_NOTIFICATIONS permission not granted. Cannot send geofence notification.")
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            // TODO: Add extras to navigate to device or geofence details
            // putExtra("device_id", device.id)
            // putExtra("geofence_id", geofence.id)
        }
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val requestCode = (device.id + geofence.id + (if(isEntry) "entry" else "exit")).hashCode()
        val pendingIntent: PendingIntent = PendingIntent.getActivity(this, requestCode, intent, pendingIntentFlags)

        val eventTypeString = if (isEntry) getString(R.string.geofence_event_entered) else getString(R.string.geofence_event_exited)
        val notificationTitle = getString(R.string.notification_geofence_event_title_template, device.name ?: device.id, eventTypeString, geofence.name)
        val notificationText = getString(R.string.notification_geofence_event_text_template, device.name ?: device.id, eventTypeString, geofence.name)


        val builder = NotificationCompat.Builder(this, GEOFENCE_EVENT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_icon) // Placeholder: Replace with actual app icon
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)

        with(NotificationManagerCompat.from(this)) {
            val notificationId = GEOFENCE_NOTIFICATION_ID_OFFSET + requestCode
            try {
                notify(notificationId, builder.build())
                Log.i(TAG, "Geofence notification sent for ${device.name} ${eventTypeString} ${geofence.name} (ID: $notificationId)")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException while sending geofence notification. POST_NOTIFICATIONS permission revoked?", e)
            }
        }
    }

    }
}
