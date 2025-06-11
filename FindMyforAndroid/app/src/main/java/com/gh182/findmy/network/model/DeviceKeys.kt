package com.gh182.findmy.network.model

import com.google.gson.annotations.SerializedName

data class DeviceKeyInfo(
    @SerializedName("adv_key_b64") val advKeyB64: String,
    @SerializedName("key_type") val keyType: String,
    @SerializedName("potential_mac") val potentialMac: String?
)

data class GeofenceInfo(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("latitude") val latitude: Double,
    @SerializedName("longitude") val longitude: Double,
    @SerializedName("radius") val radius: Double,
    @SerializedName("notify_on_entry") val notifyOnEntry: Boolean,
    @SerializedName("notify_on_exit") val notifyOnExit: Boolean
)

data class CurrentBatteryInfo(
    @SerializedName("level_percentage") val levelPercentage: Int?,
    @SerializedName("status_text") val statusText: String?,
    @SerializedName("source") val source: String?
)

data class DeviceConfig(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("label") val label: String?,
    @SerializedName("color") val color: String?,
    @SerializedName("model") val model: String?,
    @SerializedName("icon") val icon: String?,
    @SerializedName("keys") val keys: List<DeviceKeyInfo>,

    // Added fields based on the updated API
    @SerializedName("last_battery_status") val lastBatteryStatus: String?, // From FindMy network
    @SerializedName("android_battery_level") val androidBatteryLevel: Int?,
    @SerializedName("android_device_status") val androidDeviceStatus: String?,
    @SerializedName("last_seen_by_android") val lastSeenByAndroid: String?, // ISO 8601 timestamp
    @SerializedName("last_seen_local") val lastSeenLocal: String?, // ISO 8601 timestamp, from native scanner

    @SerializedName("linked_geofences") val linkedGeofences: List<GeofenceInfo>,
    @SerializedName("current_battery_info") val currentBatteryInfo: CurrentBatteryInfo?
)

// The API returns a JSON object with a single key "devices" that holds the list.
data class DevicesResponse(
    @SerializedName("devices") val devices: List<DeviceConfig>
)
