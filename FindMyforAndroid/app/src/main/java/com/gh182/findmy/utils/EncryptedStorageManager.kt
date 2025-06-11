// File: app/src/main/java/com/gh182/findmy/utils/EncryptedStorageManager.kt
package com.gh182.findmy.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
// <<< START MODIFIED IMPORT >>>
import androidx.security.crypto.MasterKeys
// <<< END MODIFIED IMPORT >>>
import com.gh182.findmy.network.model.DeviceConfig
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.IOException
import java.security.GeneralSecurityException

class EncryptedStorageManager(context: Context) {

    companion object {
        private const val PREF_FILE_NAME = "findmy_encrypted_prefs"
        private const val KEY_DEVICE_CONFIGS = "device_configs_list"
    }

    // <<< START MODIFIED SECTION >>>
    private val masterKeyAlias: String = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
    // <<< END MODIFIED SECTION >>>

    private var sharedPreferences: SharedPreferences? = null
    private val gson = Gson()

    init {
        try {
            // <<< START MODIFIED SECTION: Correct argument order and master key usage >>>
            sharedPreferences = EncryptedSharedPreferences.create(
                PREF_FILE_NAME,
                masterKeyAlias,
                context,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            // <<< END MODIFIED SECTION >>>
        } catch (e: GeneralSecurityException) {
            throw RuntimeException("Failed to create EncryptedSharedPreferences", e)
        } catch (e: IOException) {
            throw RuntimeException("Failed to create EncryptedSharedPreferences due to IO issue", e)
        }
    }

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
            null
        }
    }

    fun clearDeviceConfigs() {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        sharedPreferences?.edit()?.remove(KEY_DEVICE_CONFIGS)?.apply()
    }

    fun clearAllData() {
        if (sharedPreferences == null) throw IllegalStateException("EncryptedSharedPreferences not initialized")
        sharedPreferences?.edit()?.clear()?.apply()
    }
}