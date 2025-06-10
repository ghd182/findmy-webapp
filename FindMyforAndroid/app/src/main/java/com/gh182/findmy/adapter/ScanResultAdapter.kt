// File: app/src/main/java/com/gh182/findmy/adapter/ScanResultAdapter.kt
// Language: Kotlin
package com.gh182.findmy.adapter

import android.graphics.Color
import android.graphics.drawable.PictureDrawable
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.caverock.androidsvg.SVG
import com.gh182.findmy.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

class ScanResultAdapter : ListAdapter<ScanDisplayItem, ScanResultAdapter.ScanResultViewHolder>(ScanDisplayItemDiffCallback()) {

    companion object {
        private const val ADAPTER_TAG = "ScanResultAdapterNew"
        private const val NEVER_SEEN_TIMESTAMP_VALUE = 0L // Define constant locally for clarity
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ScanResultViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.list_item_scan_result, parent, false)
        Log.d(ADAPTER_TAG, "onCreateViewHolder: View inflated.")
        return ScanResultViewHolder(view)
    }

    override fun onBindViewHolder(holder: ScanResultViewHolder, position: Int) {
        val item = getItem(position)
        Log.d(ADAPTER_TAG, "onBindViewHolder for position $position: Device ID ${item.id}, Name: ${item.displayName}")
        holder.bind(item)
    }

    class ScanResultViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val iconImageView: ImageView = itemView.findViewById(R.id.scan_item_icon_view)
        private val nameTextView: TextView = itemView.findViewById(R.id.scan_item_name_text)
        private val detailsTextView: TextView = itemView.findViewById(R.id.scan_item_details_text)
        private val lastSeenTextView: TextView = itemView.findViewById(R.id.scan_item_last_seen_text)
        private val matchedIndicator: ImageView = itemView.findViewById(R.id.scan_item_matched_indicator_icon)

        fun bind(item: ScanDisplayItem) {
            Log.d(ADAPTER_TAG, "Binding item: ${item.displayName}, RSSI: ${item.rssi}, Batt: ${item.batteryStatus}, LastSeen: ${item.lastSeenTimestampMillis}")
            nameTextView.text = item.displayName

            val rssiText = item.rssi?.let { itemView.context.getString(R.string.scanner_details_rssi_value, it) }
                ?: itemView.context.getString(R.string.scanner_details_rssi_na)

            detailsTextView.text = itemView.context.getString(
                R.string.scanner_details_line,
                rssiText,
                item.batteryStatus,
                item.keyType
            )
            setRssiColor(item.rssi)

            if (item.lastSeenTimestampMillis == NEVER_SEEN_TIMESTAMP_VALUE) {
                lastSeenTextView.text = itemView.context.getString(R.string.scanner_last_seen_never)
            } else {
                lastSeenTextView.text = formatTimeRelative(item.lastSeenTimestampMillis)
            }

            matchedIndicator.visibility = if (item.isMatched && item.lastSeenTimestampMillis != NEVER_SEEN_TIMESTAMP_VALUE) View.VISIBLE else View.GONE
            if (item.isMatched && item.lastSeenTimestampMillis != NEVER_SEEN_TIMESTAMP_VALUE) {
                try {
                    matchedIndicator.setColorFilter(ContextCompat.getColor(itemView.context, R.color.colorPrimary))
                } catch (e: Exception) {
                    Log.e(ADAPTER_TAG, "Failed to tint matched indicator", e)
                }
            }

            val deviceIconDrawable = generateDeviceIconSvg(item.iconLabel, item.iconColorHex)
            if (deviceIconDrawable != null) {
                iconImageView.setImageDrawable(deviceIconDrawable)
                iconImageView.clearColorFilter()
            } else {
                iconImageView.setImageResource(R.drawable.ic_baseline_devices_24)
                try {
                    iconImageView.setColorFilter(ContextCompat.getColor(itemView.context, R.color.icon_tint_default))
                } catch (e: Exception) { Log.e(ADAPTER_TAG, "Error tinting fallback icon", e)}
            }
        }

        private fun setRssiColor(rssi: Int?) {
            val colorRes = when {
                rssi == null -> R.color.rssi_very_weak
                rssi > -65 -> R.color.rssi_strong
                rssi > -75 -> R.color.rssi_medium
                rssi > -85 -> R.color.rssi_weak
                else -> R.color.rssi_very_weak
            }
            try {
                detailsTextView.setTextColor(ContextCompat.getColor(itemView.context, colorRes))
            } catch (e: Exception) {
                detailsTextView.setTextColor(ContextCompat.getColor(itemView.context, R.color.rssi_very_weak)) // Fallback
            }
        }

        private fun formatTimeRelative(timestampMillis: Long): String {
            if (timestampMillis == 0L) return itemView.context.getString(R.string.scanner_last_seen_never)
            val now = System.currentTimeMillis()
            val diffSeconds = TimeUnit.MILLISECONDS.toSeconds(now - timestampMillis)
            return when {
                diffSeconds < 5 -> itemView.context.getString(R.string.time_just_now)
                diffSeconds < 60 -> itemView.context.getString(R.string.time_seconds_ago, diffSeconds)
                diffSeconds < 3600 -> itemView.context.getString(R.string.time_minutes_ago, TimeUnit.SECONDS.toMinutes(diffSeconds))
                diffSeconds < 86400 -> itemView.context.getString(R.string.time_hours_ago, TimeUnit.SECONDS.toHours(diffSeconds))
                else -> {
                    val sdf = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
                    sdf.format(Date(timestampMillis))
                }
            }
        }

        private fun generateDeviceIconSvg(label: String?, colorHex: String?, sizePx: Int = 120): PictureDrawable? {
            val displayLabel = (label?.take(2)?.uppercase(Locale.getDefault()) ?: "?")
            val finalColorHex = if (colorHex != null && colorHex.matches(Regex("^#[0-9a-fA-F]{6}$"))) colorHex else "#B0BEC5"

            val textColorHex = try {
                val color = Color.parseColor(finalColorHex) // Returns Int
                val r = Color.red(color); val g = Color.green(color); val b = Color.blue(color)
                val luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
                if (luminance > 0.55) "#000000" else "#FFFFFF"
            } catch (e: IllegalArgumentException) {
                Log.w("DeviceIconSVG", "Failed to parse color for luminance: $finalColorHex", e)
                "#000000"
            }

            val fontSize = if (displayLabel.length == 1) sizePx * 0.5 else sizePx * 0.4
            val svgString = """
            <svg width="$sizePx" height="$sizePx" viewBox="0 0 $sizePx $sizePx" xmlns="http://www.w3.org/2000/svg">
                <circle cx="${sizePx / 2}" cy="${sizePx / 2}" r="${sizePx / 2}" fill="$finalColorHex"/>
                <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
                      font-family="sans-serif" font-size="${fontSize}px" font-weight="bold" fill="$textColorHex">
                    $displayLabel
                </text>
            </svg>
            """.trimIndent()

            return try {
                val svg = SVG.getFromString(svgString)
                PictureDrawable(svg.renderToPicture(sizePx, sizePx))
            } catch (e: Exception) { // Catching generic Exception as SVG parsing can throw various things
                Log.e("DeviceIconSVG", "Failed to render SVG icon for label '$displayLabel', color '$finalColorHex'", e)
                null
            }
        }
    }

    class ScanDisplayItemDiffCallback : DiffUtil.ItemCallback<ScanDisplayItem>() {
        override fun areItemsTheSame(oldItem: ScanDisplayItem, newItem: ScanDisplayItem): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: ScanDisplayItem, newItem: ScanDisplayItem): Boolean {
            return oldItem == newItem
        }
    }
}