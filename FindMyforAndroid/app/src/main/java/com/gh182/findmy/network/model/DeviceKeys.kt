package com.gh182.findmy.network.model

import com.google.gson.annotations.SerializedName

data class DeviceKeyInfo(
    @SerializedName("adv_key_b64") val advKeyB64: String,
    @SerializedName("key_type") val keyType: String,
    @SerializedName("potential_mac") val potentialMac: String?
)

data class DeviceConfig(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("label") val label: String?,
    @SerializedName("color") val color: String?,
    @SerializedName("model") val model: String?,
    @SerializedName("icon") val icon: String?,
    @SerializedName("keys") val keys: List<DeviceKeyInfo>
)

// The API returns a JSON object with a single key "devices" that holds the list.
data class DevicesResponse(
    @SerializedName("devices") val devices: List<DeviceConfig>
)
