// File: app/src/main/java/com/gh182/findmy/adapter/ScanDisplayItem.kt
// Language: Kotlin
package com.gh182.findmy.adapter

// This data class holds the processed information ready for display in the RecyclerView
data class ScanDisplayItem(
    val id: String, // Unique ID (e.g., matchedDeviceId from worker OR device_id from config)
    val displayName: String,
    val rssi: Int?,
    val batteryStatus: String, // e.g., "High", "Medium", "Low", "N/A"
    val keyType: String, // e.g., "ROLLING", "STATIC", "N/A"
    val lastSeenTimestampMillis: Long,
    val rawStatusByte: Int, // For additional info if needed, like the first byte of OF payload
    val isMatched: Boolean, // True if successfully matched by KeyManager in a scan cycle
    // <<< START ADDED FIELDS >>>
    val iconLabel: String?, // e.g. "LP" for "Lost Phone"
    val iconColorHex: String? // e.g. "#FF0000" for red
    // <<< END ADDED FIELDS >>>
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as ScanDisplayItem

        if (id != other.id) return false
        if (displayName != other.displayName) return false
        if (rssi != other.rssi) return false
        if (batteryStatus != other.batteryStatus) return false
        if (keyType != other.keyType) return false
        if (lastSeenTimestampMillis != other.lastSeenTimestampMillis) return false
        if (rawStatusByte != other.rawStatusByte) return false
        if (isMatched != other.isMatched) return false
        if (iconLabel != other.iconLabel) return false
        if (iconColorHex != other.iconColorHex) return false

        return true
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + displayName.hashCode()
        result = 31 * result + (rssi ?: 0)
        result = 31 * result + batteryStatus.hashCode()
        result = 31 * result + keyType.hashCode()
        result = 31 * result + lastSeenTimestampMillis.hashCode()
        result = 31 * result + rawStatusByte
        result = 31 * result + isMatched.hashCode()
        result = 31 * result + (iconLabel?.hashCode() ?: 0)
        result = 31 * result + (iconColorHex?.hashCode() ?: 0)
        return result
    }
}