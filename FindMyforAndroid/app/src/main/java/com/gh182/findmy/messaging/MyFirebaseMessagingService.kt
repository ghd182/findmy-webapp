// File: app/src/main/java/com/gh182/findmy/messaging/MyFirebaseMessagingService.kt
// Language: Kotlin
package com.gh182.findmy.messaging

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat // <<< ADDED for getting color resource
import com.gh182.findmy.MainActivity // Import your main activity
import com.gh182.findmy.R // Import your R class
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MyFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "MyFirebaseMsgService"
        // Use the string resource for channel ID - Use context to get string value
        private fun getChannelId(context: Context): String = context.getString(R.string.default_notification_channel_id)

        private const val CHANNEL_NAME = "FindMy Alerts"
        private const val CHANNEL_DESCRIPTION = "Notifications for device status and geofences"
    }

    /**
     * Called when message is received.
     * Handles both data messages and notification messages.
     */
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "FCM Message From: ${remoteMessage.from}")

        var notificationTitle: String? = null
        var notificationBody: String? = null
        var deviceId: String? = null // For deep linking
        var notificationType: String = "general" // Default type

        // 1. Prefer Data Payload (sent from your backend)
        if (remoteMessage.data.isNotEmpty()) {
            Log.d(TAG, "Message data payload: " + remoteMessage.data)
            notificationTitle = remoteMessage.data["title"]
            notificationBody = remoteMessage.data["body"]
            deviceId = remoteMessage.data["deviceId"] // Get device ID if sent
            notificationType = remoteMessage.data["type"] ?: notificationType // Get type if sent
            // You can add more custom data fields here (e.g., iconUrl, badgeUrl, tag)
        }

        // 2. Fallback to Notification Payload (if console or simple push)
        remoteMessage.notification?.let {
            Log.d(TAG, "Message Notification Payload: Title='${it.title}', Body='${it.body}'")
            if (notificationTitle == null) notificationTitle = it.title
            if (notificationBody == null) notificationBody = it.body
            // Note: Other fields like icon, tag might be in `it` but are less common for data pushes
        }

        // 3. Send Notification if we have the basics
        if (notificationTitle != null && notificationBody != null) {
            sendNotification(notificationTitle, notificationBody, deviceId, notificationType)
        } else {
            Log.w(TAG, "Received FCM message without sufficient data/notification payload.")
        }
    }

    /**
     * Called if the FCM registration token is updated.
     */
    override fun onNewToken(token: String) {
        Log.d(TAG, "Refreshed FCM token: $token")
        sendRegistrationToServer(token)
    }

    /**
     * Persist token to third-party servers.
     */
    private fun sendRegistrationToServer(token: String?) {
        if (token != null) {
            try {
                // Store locally - WebApp should pick this up via JS bridge when subscribing
                val prefs = getSharedPreferences("fcm_prefs", Context.MODE_PRIVATE).edit()
                prefs.putString("fcm_token", token)
                prefs.apply()
                Log.i(TAG, "Stored new FCM token locally: ${token.take(10)}...")
                // TODO: Add a mechanism to trigger sending this to the backend if needed independently,
                // e.g., using WorkManager or a dedicated Repository/API call.
                // For now, relies on WebApp JS reading it via getFCMToken() during its subscribe process.
            } catch (e: Exception) {
                Log.e(TAG, "Failed to store FCM token locally", e)
            }
        }
        Log.i(TAG, "FCM Token updated locally. WebApp interface should retrieve and send it.")
    }

    /**
     * Create and show a simple notification containing the received FCM message.
     */
    private fun sendNotification(
        title: String,
        messageBody: String,
        deviceId: String?,
        notificationType: String
    ) {
        // --- Intent for launching MainActivity ---
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            // Add deep link data if deviceId is present
            if (deviceId != null) {
                putExtra("focusDevice", deviceId) // Key for JS to read
                // Create a unique data URI for this notification intent
                data = Uri.parse("findmy://device/$notificationType/$deviceId/${System.currentTimeMillis()}")
                Log.d(TAG, "Notification intent includes focusDevice=$deviceId")
            } else {
                data = Uri.parse("findmy://general/$notificationType/${System.currentTimeMillis()}")
            }
        }

        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(this, 0 /* Request code */, intent, pendingIntentFlags)
        // --- --------------------------------- ---

        val channelId = getChannelId(this) // Get channel ID using context
        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        // --- Determine Small Icon ---
        val smallIconResId = when (notificationType.lowercase()) {
            "geofence_entry", "geofence_exit" -> R.drawable.ic_baseline_radar_24 // Reuse radar icon
            "battery_low" -> R.drawable.ic_baseline_battery_alert_24
            "test", "welcome" -> R.drawable.ic_baseline_check_circle_24
            else -> R.mipmap.ic_launcher // Default app icon
        }
        if (smallIconResId == R.mipmap.ic_launcher) {
            Log.w(TAG, "Using default app icon for notification type: $notificationType")
        }
        // --- --------------------- ---

        // --- Build Notification ---
        val notificationBuilder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(smallIconResId) // Set specific small icon
            .setContentTitle(title)
            .setContentText(messageBody)
            .setAutoCancel(true)
            .setSound(defaultSoundUri)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setStyle(NotificationCompat.BigTextStyle().bigText(messageBody))
            // Use ContextCompat.getColor for backward compatibility
            .setColor(ContextCompat.getColor(this, R.color.notification_color)) // Use color resource
        // Optional: Add actions based on type/data later

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // --- Create Notification Channel (Android O+) ---
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Check if channel already exists (optional, but good practice)
            if (notificationManager.getNotificationChannel(channelId) == null) {
                val channel = NotificationChannel(
                    channelId,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = CHANNEL_DESCRIPTION
                    enableLights(true)
                    lightColor = ContextCompat.getColor(applicationContext, R.color.notification_color) // Use color resource
                    enableVibration(true)
                    // You could create different channels for different IMPORTANCE levels too
                }
                notificationManager.createNotificationChannel(channel)
                Log.d(TAG, "Notification channel created: ID=$channelId")
            } else {
                Log.d(TAG, "Notification channel already exists: ID=$channelId")
            }
        }

        // --- Show Notification ---
        // Use a semi-unique ID based on device and timestamp for potentially stacking/updating
        val notificationId = (deviceId?.hashCode() ?: notificationType.hashCode()) + (System.currentTimeMillis() / 1000).toInt()
        try {
            notificationManager.notify(notificationId, notificationBuilder.build())
            Log.d(TAG, "Notification sent: ID=$notificationId, Title=$title")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to notify manager", e)
        }
    }

} // End MyFirebaseMessagingService