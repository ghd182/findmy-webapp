package com.gh182.findmy.network.model

import com.google.gson.annotations.SerializedName

data class ScanResultPayload(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("timestamp") val timestamp: String, // ISO 8601 format
    @SerializedName("battery_level") val batteryLevel: Int? = null,
    // Potentially add other relevant scan data fields here later
    // e.g., @SerializedName("rssi") val rssi: Int? = null,
    // @SerializedName("location_accuracy") val locationAccuracy: Float? = null
)
