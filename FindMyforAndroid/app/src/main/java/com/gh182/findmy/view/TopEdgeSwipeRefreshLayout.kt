// File: app/src/main/java/com/gh182/findmy/view/TopEdgeSwipeRefreshLayout.kt
// Language: Kotlin
package com.gh182.findmy.view // Or your preferred package

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.webkit.WebView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class TopEdgeSwipeRefreshLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : SwipeRefreshLayout(context, attrs) {

    private val touchSlop: Int = ViewConfiguration.get(context).scaledTouchSlop
    private var initialDownY: Float = 0f
    private val topEdgeThresholdDp = 40 // Allow starting swipe within top 20dp

    // Convert dp threshold to pixels
    private val topEdgeThresholdPx = (topEdgeThresholdDp * resources.displayMetrics.density)

    // Reference to the direct child (assumed to be the WebView or a scrollable container)
    private val targetView: View?
        get() = if (childCount > 0) getChildAt(0) else null

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        when (ev.action) {
            MotionEvent.ACTION_DOWN -> {
                initialDownY = ev.y
                // Allow handling if not already refreshing
                return !isRefreshing && super.onInterceptTouchEvent(ev)
            }

            MotionEvent.ACTION_MOVE -> {
                val yDiff = ev.y - initialDownY
                // Check if dragging downwards significantly
                if (yDiff > touchSlop) {
                    // Check if drag started near the top edge
                    val startedNearTop = initialDownY < topEdgeThresholdPx
                    // Check if the target view (WebView) can scroll up
                    val canChildScrollUp = targetView?.canScrollVertically(-1) ?: false

                    // Allow swipe ONLY if drag started near top AND child cannot scroll up
                    if (startedNearTop && !canChildScrollUp) {
                        // Let SwipeRefreshLayout handle the swipe
                        return super.onInterceptTouchEvent(ev)
                    } else {
                        // Prevent SwipeRefreshLayout from intercepting, let child scroll
                        return false
                    }
                }
            }
        }
        // Default handling for other actions (UP, CANCEL, etc.)
        return super.onInterceptTouchEvent(ev)
    }
}