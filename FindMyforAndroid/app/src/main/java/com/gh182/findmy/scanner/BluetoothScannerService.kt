// File: app/src/main/java/com/gh182/findmy/scanner/BluetoothScannerService.kt
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
import android.util.Base64
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
import com.gh182.findmy.network.ApiService
import com.gh182.findmy.network.model.DeviceConfig
import com.gh182.findmy.network.model.GeofenceInfo
import com.gh182.findmy.network.model.ScanResultPayload
import com.gh182.findmy.utils.EncryptedStorageManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.Date
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import android.os.Build

class BluetoothScannerService : Service() {

    private val binder = LocalBinder()
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private var apiService: ApiService? = null
    private lateinit var encryptedStorageManager: EncryptedStorageManager
    private lateinit var bluetoothManager: BluetoothManager
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothLeScanner: BluetoothLeScanner? = null
    private var isScanning = false
    private val handler = Handler(Looper.getMainLooper())
    @Volatile
    private var deviceKeysList: List<DeviceConfig> = emptyList()
    private val lastSeenTimestamps: MutableMap<String, Long> = ConcurrentHashMap()
    private val missingCheckHandler = Handler(Looper.getMainLooper())
    private var isMissingDeviceCheckScheduled = false
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var isGeofenceMonitoringActive = false
    private val deviceGeofenceStates: MutableMap<Pair<String, String>, Boolean> = ConcurrentHashMap()
    private var locationRequest: LocationRequest? = null
    private var locationCallback: LocationCallback? = null
    private val prolongedAbsenceNotificationTimestamps: MutableMap<String, Long> = ConcurrentHashMap()
    private val missingNotificationTimestamps: MutableMap<String, Long> = ConcurrentHashMap()
    private val lowBatteryNotificationTimestamps: MutableMap<String, Long> = ConcurrentHashMap()

    companion object {
        private const val TAG = "BluetoothScannerSvc"
        const val ACTION_START_SCANNING_CYCLE = "com.gh182.findmy.scanner.ACTION_START_SCANNING_CYCLE"
        const val ACTION_STOP_SCANNING_CYCLE = "com.gh182.findmy.scanner.ACTION_STOP_SCANNING_CYCLE"
        const val ACTION_START_GEOFENCE_MONITORING = "com.gh182.findmy.scanner.ACTION_START_GEOFENCE_MONITORING"
        const val ACTION_STOP_GEOFENCE_MONITORING = "com.gh182.findmy.scanner.ACTION_STOP_GEOFENCE_MONITORING"
        private const val MISSING_DEVICE_NOTIFICATION_ID_OFFSET = 1000
        private const val GEOFENCE_NOTIFICATION_ID_OFFSET = 2000
        private const val LOW_BATTERY_NOTIFICATION_ID_OFFSET = 3000
        const val GEOFENCE_EVENT_CHANNEL_ID = "geofence_event_channel"
        const val BATTERY_ALERTS_CHANNEL_ID = "battery_alerts_channel"
        private const val MISSING_DEVICE_CHECK_INTERVAL_MS: Long = 5 * 60 * 1000L
        private const val DEVICE_MISSING_THRESHOLD_MS: Long = 30 * 60 * 1000L
        private const val PROLONGED_ABSENCE_THRESHOLD_MS: Long = 4 * 60 * 60 * 1000L
        private const val PROLONGED_ABSENCE_NOTIFICATION_COOLDOWN_MS: Long = 12 * 60 * 60 * 1000L
        private const val MISSING_NOTIFICATION_COOLDOWN_MS: Long = 2 * 60 * 60 * 1000L
        private const val LOCATION_UPDATE_INTERVAL_MS: Long = 1 * 60 * 1000L
        private const val FASTEST_LOCATION_UPDATE_INTERVAL_MS: Long = 30 * 1000L
        const val LOW_BATTERY_THRESHOLD_PERCENTAGE = 20
        private const val LOW_BATTERY_NOTIFICATION_COOLDOWN_MS: Long = 4 * 60 * 60 * 1000L
        private const val SCAN_PERIOD: Long = 20 * 1000L
        private const val APPLE_MANUFACTURER_ID = 0x004C
        private const val FINDMY_AD_TYPE = 0x12
        private const val EXPECTED_FINDMY_DATA_LENGTH = 25
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
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        if (bluetoothAdapter == null || !bluetoothAdapter!!.isEnabled) {
            Log.e(TAG, "Bluetooth is not enabled or not available.")
            stopSelf()
            return
        }
        bluetoothLeScanner = bluetoothAdapter?.bluetoothLeScanner
        loadKeysFromStorage()
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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand received: ${intent?.action}")
        when (intent?.action) {
            ACTION_START_SCANNING_CYCLE -> {
                Log.i(TAG, "Scan cycle explicitly started via onStartCommand.")
                startScanning()
                if (!isMissingDeviceCheckScheduled) {
                    scheduleMissingDeviceCheck()
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
            lastSeenTimestamps.putIfAbsent(device.id, currentTime)
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
            }
        }
        if (isScanning) {
            Log.d(TAG, "Scan cycle already in progress (re-checked).")
            return
        }
        if (bluetoothLeScanner == null) {
            Log.e(TAG, "BluetoothLeScanner not initialized. Cannot start scan.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission not granted. Cannot start scan.")
            return
        }
        Log.i(TAG, "Starting BLE scan cycle (scan -> wait -> scan ...).")
        scheduleNextScan(0)
    }

    fun stopScanning() {
        Log.i(TAG, "Stopping BLE scan cycle permanently.")
        isScanning = false
        handler.removeCallbacksAndMessages(null)
        stopBleScanActual()
    }

    private fun scheduleNextScan(delayMillis: Long) {
        handler.postDelayed({
            if (bluetoothAdapter?.isEnabled != true) {
                Log.e(TAG, "Bluetooth disabled, stopping scan cycle.")
                stopScanning()
                return@postDelayed
            }
            startBleScanActual()
            handler.postDelayed({
                Log.d(TAG, "Scan period of ${SCAN_PERIOD}ms finished.")
                stopBleScanActual()
                isScanning = false
            }, SCAN_PERIOD)
            Log.i(TAG, "BLE Scan scheduled to run for ${SCAN_PERIOD}ms.")
        }, delayMillis)
    }

    private fun startBleScanActual() {
        if (isScanning) {
            Log.d(TAG, "Scan already active, not starting another.")
            return
        }
        if (bluetoothLeScanner == null || bluetoothAdapter?.isEnabled != true) {
            Log.e(TAG, "Cannot start actual scan: BluetoothLeScanner not available or Bluetooth disabled.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission not granted when trying to start actual scan.")
            return
        }
        val scanFilters: MutableList<ScanFilter> = ArrayList()
        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setReportDelay(0)
            .build()
        Log.d(TAG, "Starting actual BLE scan with BALANCED mode...")
        isScanning = true
        bluetoothLeScanner?.startScan(scanFilters, scanSettings, leScanCallback)
    }

    private fun stopBleScanActual() {
        if (bluetoothLeScanner == null) {
            Log.e(TAG, "BluetoothLeScanner not available when trying to stop scan.")
            return
        }
        if (bluetoothAdapter?.isEnabled != true) {
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
            if (errorCode == SCAN_FAILED_APPLICATION_REGISTRATION_FAILED || errorCode == SCAN_FAILED_FEATURE_UNSUPPORTED) {
                stopScanning()
            }
        }
    }

    private fun processScanResult(scanResult: ScanResult) {
        val scanRecord = scanResult.scanRecord ?: return
        val manufacturerData = scanRecord.getManufacturerSpecificData(APPLE_MANUFACTURER_ID)
        if (manufacturerData == null || manufacturerData.size < EXPECTED_FINDMY_DATA_LENGTH) {
            return
        }
        if (manufacturerData[0] != FINDMY_AD_TYPE.toByte()) {
            return
        }
        val keyOffset = 5
        val publicKeyCandidateBytes = try {
            manufacturerData.sliceArray(keyOffset until keyOffset + 22)
        } catch (e: Exception) {
            Log.e(TAG, "Error slicing manufacturer data for ${scanResult.device.address}", e)
            return
        }

        for (deviceConfig in deviceKeysList) {
            for (keyInfo in deviceConfig.keys) {
                try {
                    val expectedKeyBytes = Base64.decode(keyInfo.advKeyB64, Base64.URL_SAFE)
                    if (publicKeyCandidateBytes.contentEquals(expectedKeyBytes)) {
                        Log.i(TAG, "MATCH FOUND for device: ${deviceConfig.name} (${deviceConfig.id}) with key ${keyInfo.advKeyB64}")
                        lastSeenTimestamps[deviceConfig.id] = System.currentTimeMillis()
                        prolongedAbsenceNotificationTimestamps.remove(deviceConfig.id)
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
                } catch (e: Exception) {
                    Log.w(TAG, "Error during key matching for ${deviceConfig.name}", e)
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
                    Log.w(TAG, "Device $deviceName ($deviceId) has a PROLONGED ABSENCE. Last seen: $lastSeen")
                    sendMissingDeviceNotification(device, isProlongedAbsence = true)
                    prolongedAbsenceNotificationTimestamps[deviceId] = currentTime
                    missingNotificationTimestamps[deviceId] = currentTime
                } else {
                    Log.d(TAG, "Device $deviceName ($deviceId) prolonged absence notification on cooldown.")
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
            .setSmallIcon(R.drawable.ic_baseline_devices_24)
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
        with(NotificationManagerCompat.from(this)) {
            val notificationId = MISSING_DEVICE_NOTIFICATION_ID_OFFSET + device.id.hashCode() + requestCodeSalt
            try {
                notify(notificationId, builder.build())
                Log.i(TAG, "Missing/Prolonged notification sent for $deviceName (${device.id}). Prolonged: $isProlongedAbsence. ID: $notificationId")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException while sending missing/prolonged notification for $deviceName. POST_NOTIFICATIONS permission revoked?", e)
            }
        }
    }

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
            .setSmallIcon(R.drawable.ic_notification_icon_battery)
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

    private fun startGeofenceMonitoring() {
        if (isGeofenceMonitoringActive) {
            Log.d(TAG, "Geofence monitoring is already active.")
            return
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Location permission not granted. Cannot start geofence monitoring.")
            return
        }
        try {
            fusedLocationClient.lastLocation.addOnSuccessListener { location: Location? ->
                if (location != null) {
                    Log.d(TAG, "Initializing geofence states with last known location.")
                    initializeGeofenceStates(location)
                } else {
                    Log.w(TAG, "Last known location is null, geofence states might be initially inaccurate.")
                    initializeGeofenceStates(null)
                }
            }.addOnFailureListener { e ->
                Log.e(TAG, "Error getting last known location for geofence init.", e)
                initializeGeofenceStates(null)
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
                    deviceGeofenceStates[stateKey] = false
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
        locationCallback = null
        locationRequest = null
        isGeofenceMonitoringActive = false
        Log.i(TAG, "Stopped geofence monitoring.")
    }

    private fun checkGeofences(location: Location) {
        Log.d(TAG, "Checking geofences for ${deviceKeysList.size} devices at location: ${location.latitude}, ${location.longitude}")
        val currentDeviceList = ArrayList(deviceKeysList)
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
            .setSmallIcon(R.drawable.ic_baseline_devices_24)
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