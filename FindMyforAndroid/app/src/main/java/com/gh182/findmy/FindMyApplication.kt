// File: app/src/main/java/com/gh182/findmy/FindMyApplication.kt
package com.gh182.findmy

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
// <<< START ADDED IMPORTS >>>
import android.content.Context
import android.os.Build
// <<< END ADDED IMPORTS >>>
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.gh182.findmy.network.RetrofitClient
import com.gh182.findmy.scanner.BluetoothScanWorker
import java.util.concurrent.TimeUnit

class FindMyApplication : Application() {

    companion object {
        const val TAG = "FindMyApplication"
        private const val BLUETOOTH_SCAN_WORK_TAG = "bluetooth_scan_work"
        const val MISSING_DEVICE_CHANNEL_ID = "missing_device_channel"
        const val GEOFENCE_EVENT_CHANNEL_ID = "geofence_event_channel"
        const val BATTERY_ALERTS_CHANNEL_ID = "battery_alerts_channel"
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Application onCreate - Initializing singletons...")

        try {
            RetrofitClient.initialize(this)
            Log.i(TAG, "RetrofitClient and dependencies initialized.")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize RetrofitClient in Application class!", e)
        }

        setupPeriodicScanWorker()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val missingDeviceChannelName = getString(R.string.notification_channel_missing_device_name)
            val missingDeviceChannelDescription = getString(R.string.notification_channel_missing_device_description)
            val missingDeviceImportance = NotificationManager.IMPORTANCE_HIGH
            val missingDeviceChannel = NotificationChannel(MISSING_DEVICE_CHANNEL_ID, missingDeviceChannelName, missingDeviceImportance).apply {
                description = missingDeviceChannelDescription
                enableLights(true)
                lightColor = android.graphics.Color.RED
                enableVibration(true)
            }

            val geofenceChannelName = getString(R.string.notification_channel_geofence_event_name)
            val geofenceChannelDescription = getString(R.string.notification_channel_geofence_event_description)
            val geofenceImportance = NotificationManager.IMPORTANCE_HIGH
            val geofenceChannel = NotificationChannel(GEOFENCE_EVENT_CHANNEL_ID, geofenceChannelName, geofenceImportance).apply {
                description = geofenceChannelDescription
                enableLights(true)
                lightColor = android.graphics.Color.BLUE
                enableVibration(true)
            }

            val batteryChannelName = getString(R.string.notification_channel_battery_alerts_name)
            val batteryChannelDescription = getString(R.string.notification_channel_battery_alerts_description)
            val batteryImportance = NotificationManager.IMPORTANCE_DEFAULT
            val batteryChannel = NotificationChannel(BATTERY_ALERTS_CHANNEL_ID, batteryChannelName, batteryImportance).apply {
                description = batteryChannelDescription
                enableVibration(false)
            }

            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(missingDeviceChannel)
            notificationManager.createNotificationChannel(geofenceChannel)
            notificationManager.createNotificationChannel(batteryChannel)

            Log.i(TAG, "Notification channels created.")
        }
    }

    private fun setupPeriodicScanWorker() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val scanWorkRequest = PeriodicWorkRequestBuilder<BluetoothScanWorker>(
            15, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(BLUETOOTH_SCAN_WORK_TAG)
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            BluetoothScanWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            scanWorkRequest
        )
        Log.i(TAG, "BluetoothScanWorker scheduled to run periodically.")
    }
}