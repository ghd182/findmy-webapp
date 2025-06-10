// File: app/src/main/java/com/gh182/findmy/scanner/TokenStorage.kt
// Language: Kotlin
package com.gh182.findmy.scanner // Or a suitable 'util' package

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys // Correct import

object TokenStorage {

    private const val TAG = "TokenStorage"
    private const val PREF_FILE_NAME = "secure_api_prefs"
    private const val PREF_KEY_API_TOKEN = "api_auth_token"

    // Master Key alias for Android Keystore
    // <<< KEEP using MasterKeys.AES256_GCM_SPEC >>>
    // private const val MASTER_KEY_ALIAS = "_findmy_master_key_" // No longer strictly needed with MasterKeys helper

    @Volatile
    private var isInitialized = false
    private var encryptedPrefs: SharedPreferences? = null // Use SharedPreferences interface type

    @Synchronized
    fun initialize(context: Context) {
        if (isInitialized) return
        try {
            // 1. Create or get the Master Key alias using the recommended helper
            val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)

            // 2. Create EncryptedSharedPreferences instance
            encryptedPrefs = EncryptedSharedPreferences.create(
                // File name for the encrypted shared preferences
                PREF_FILE_NAME,
                // The master key alias identifier
                masterKeyAlias,
                // Context, prefer application context to avoid leaks
                context.applicationContext,
                // Key encryption scheme
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                // Value encryption scheme
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )

            isInitialized = true
            Log.i(TAG, "Secure Token Storage initialized successfully.")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize secure token storage", e)
            // Consider alternatives if secure storage fails:
            // - Fallback to regular SharedPreferences (less secure)
            // - Disable features requiring the token
            // - Notify the user
            encryptedPrefs = null // Ensure it's null on failure
            isInitialized = false
        }
    }

    // Private helper to check initialization
    private fun checkInitialized() {
        if (!isInitialized || encryptedPrefs == null) {
            // Log error and maybe throw an exception or return default/error value
            Log.e(TAG, "TokenStorage accessed before successful initialization!")
            // Depending on strictness, you might throw:
            // throw IllegalStateException("TokenStorage must be initialized successfully first!")
        }
    }

    /** Saves the API token securely. Pass null to clear the token. */
    fun saveToken(token: String?) {
        checkInitialized() // Check if initialized (logs error if not)
        if (!isInitialized || encryptedPrefs == null) return // Don't proceed if not initialized

        try {
            encryptedPrefs?.edit()?.putString(PREF_KEY_API_TOKEN, token)?.apply()
            if (token != null) {
                Log.i(TAG, "API Token saved securely.")
            } else {
                Log.i(TAG, "API Token cleared from secure storage.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save API Token", e)
            // Handle error appropriately, maybe notify user or retry logic
        }
    }

    /** Retrieves the saved API token. Returns null if not found or on error. */
    fun getToken(): String? {
        checkInitialized() // Check if initialized
        if (!isInitialized || encryptedPrefs == null) return null // Return null if not initialized

        return try {
            val token = encryptedPrefs?.getString(PREF_KEY_API_TOKEN, null)
            if (token != null) {
                Log.d(TAG, "Retrieved API Token from secure storage (length: ${token.length})")
            } else {
                Log.d(TAG, "No API Token found in secure storage.")
            }
            token
        } catch (e: Exception) {
            Log.e(TAG, "Failed to retrieve API Token", e)
            null // Return null on error
        }
    }

    /** Clears the stored API token. */
    fun clearToken() {
        saveToken(null)
    }
}