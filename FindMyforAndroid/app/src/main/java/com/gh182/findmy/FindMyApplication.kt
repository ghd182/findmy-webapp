// File: app/src/main/java/com/gh182/findmy/FindMyApplication.kt
// Language: Kotlin
package com.gh182.findmy

import android.app.Application
import android.util.Log
import com.gh182.findmy.network.RetrofitClient // Import RetrofitClient
import com.gh182.findmy.scanner.TokenStorage // Import TokenStorage if needed elsewhere early

class FindMyApplication : Application() {

    companion object {
        const val TAG = "FindMyApplication"
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
    }
}