// File: app/src/main/java/com/gh182/findmy/FindMyApplication.kt
// Language: Kotlin
package com.gh182.findmy

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.gh182.findmy.network.RetrofitClient // Import RetrofitClient
import com.gh182.findmy.scanner.BluetoothScanWorker
import com.gh182.findmy.scanner.TokenStorage // Import TokenStorage if needed elsewhere early
import java.util.concurrent.TimeUnit

class FindMyApplication : Application() {

    companion object {
        const val TAG = "FindMyApplication"
        private const val BLUETOOTH_SCAN_WORK_TAG = "bluetooth_scan_work"
        const val MISSING_DEVICE_CHANNEL_ID = "missing_device_channel"
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Application onCreate - Initializing singletons...")

        // Initialize RetrofitClient (which also initializes TokenStorage)
        // Pass the application context
        try {
            RetrofitClient.initialize(this)
            Log.i(TAG, "RetrofitClient and dependencies initialized.")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize RetrofitClient in Application class!", e)
            // Handle critical initialization failure if necessary
        }

        // You can initialize other app-wide singletons here too
        setupPeriodicScanWorker()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Missing Device Channel
            val missingDeviceChannelName = getString(R.string.notification_channel_missing_device_name) // Assuming you'll add this to strings.xml
            val missingDeviceChannelDescription = getString(R.string.notification_channel_missing_device_description) // Assuming you'll add this
            val missingDeviceImportance = NotificationManager.IMPORTANCE_HIGH
            val missingDeviceChannel = NotificationChannel(MISSING_DEVICE_CHANNEL_ID, missingDeviceChannelName, missingDeviceImportance).apply {
                description = missingDeviceChannelDescription
                // Configure other channel properties if needed (e.g., lights, vibration)
                enableLights(true)
                lightColor = android.graphics.Color.RED
                enableVibration(true)
            }

            // General Notifications Channel (example, if you have others)
            // val generalChannelName = getString(R.string.channel_name_general)
            // val generalChannelDescription = getString(R.string.channel_description_general)
            // val generalImportance = NotificationManager.IMPORTANCE_DEFAULT
            // val generalChannel = NotificationChannel(GENERAL_CHANNEL_ID, generalChannelName, generalImportance).apply {
            //    description = generalChannelDescription
            // }

            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(missingDeviceChannel)
            // notificationManager.createNotificationChannel(generalChannel) // If you add more channels

            Log.i(TAG, "Notification channels created.")
        }
    }

    private fun setupPeriodicScanWorker() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED) // Only run when network is available
            .build()

        // Minimum interval for periodic work is 15 minutes
        val scanWorkRequest = PeriodicWorkRequestBuilder<BluetoothScanWorker>(
            15, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(BLUETOOTH_SCAN_WORK_TAG) // Optional: add a tag for easier identification/cancellation
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            BluetoothScanWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP, // KEEP: If work with the same name exists, do nothing.
                                             // REPLACE: Cancel existing and schedule new one. Choose based on desired behavior.
            scanWorkRequest
        )
        Log.i(TAG, "BluetoothScanWorker scheduled to run periodically.")
    }
}