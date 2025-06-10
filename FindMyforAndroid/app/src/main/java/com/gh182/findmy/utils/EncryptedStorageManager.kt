package com.gh182.findmy.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.gh182.findmy.network.model.DeviceConfig // Assuming DeviceConfig is Parcelable or using Gson for serialization
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.IOException
import java.security.GeneralSecurityException

class EncryptedStorageManager(context: Context) {

    companion object {
        private const val PREF_FILE_NAME = "findmy_encrypted_prefs"
        private const val KEY_DEVICE_CONFIGS = "device_configs_list"
        // Add other keys as needed, e.g.:
        // private const val KEY_USER_TOKEN = "user_token"
    }

    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private var sharedPreferences: SharedPreferences? = null
    private val gson = Gson()

    init {
        try {
            sharedPreferences = EncryptedSharedPreferences.create(
                context,
                PREF_FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: GeneralSecurityException) {
            // Handle error: Possibly fallback to regular SharedPreferences or log critical error
            // For simplicity, we'll let it crash or return null if sharedPreferences is not initialized.
            // In a production app, consider a more robust error handling strategy.
            throw RuntimeException("Failed to create EncryptedSharedPreferences", e)
        } catch (e: IOException) {
            throw RuntimeException("Failed to create EncryptedSharedPreferences due to IO issue", e)
        }
    }

    // --- DeviceConfigs Storage ---

    fun saveDeviceConfigs(deviceConfigs: List<DeviceConfig>) {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        val jsonString = gson.toJson(deviceConfigs)
        sharedPreferences?.edit()?.putString(KEY_DEVICE_CONFIGS, jsonString)?.apply()
    }

    fun getDeviceConfigs(): List<DeviceConfig>? {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        val jsonString = sharedPreferences?.getString(KEY_DEVICE_CONFIGS, null)
        return if (jsonString != null) {
            val type = object : TypeToken<List<DeviceConfig>>() {}.type
            gson.fromJson(jsonString, type)
        } else {
            null // Or return emptyList() depending on desired behavior
        }
    }

    fun clearDeviceConfigs() {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        sharedPreferences?.edit()?.remove(KEY_DEVICE_CONFIGS)?.apply()
    }

    // --- Example: Storing a simple String (e.g., a token) ---
    /*
    fun saveUserToken(token: String) {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        sharedPreferences?.edit()?.putString(KEY_USER_TOKEN, token)?.apply()
    }

    fun getUserToken(): String? {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        return sharedPreferences?.getString(KEY_USER_TOKEN, null)
    }

    fun clearUserToken() {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        sharedPreferences?.edit()?.remove(KEY_USER_TOKEN)?.apply()
    }
    */

    // Method to clear all data stored in these encrypted preferences
    fun clearAllData() {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        sharedPreferences?.edit()?.clear()?.apply()
    }
}
