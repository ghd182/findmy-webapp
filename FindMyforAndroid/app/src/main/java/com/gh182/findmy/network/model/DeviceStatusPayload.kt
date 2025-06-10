package com.gh182.findmy.network.model

import com.google.gson.annotations.SerializedName

data class DeviceStatusPayload(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("status") val status: String // e.g., "nearby", "lost", "unknown"
)
