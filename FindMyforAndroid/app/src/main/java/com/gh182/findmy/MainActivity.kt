// File: app/src/main/java/com/gh182/findmy/MainActivity.kt
// Language: Kotlin
package com.gh182.findmy

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
// Removed android.content.res.Resources.Theme as it's not directly used for this
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import androidx.work.*
import com.gh182.findmy.fragment.ScannerFragment
import com.gh182.findmy.fragment.WebViewFragment
import com.gh182.findmy.scanner.BleScanWorker
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.color.DynamicColors
import com.google.android.material.color.DynamicColorsOptions
import com.google.android.material.snackbar.Snackbar
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    companion object {
        const val TAG = "MainActivity"
        const val LOCATION_PERMISSION_REQUEST_CODE = 101
        const val BLUETOOTH_PERMISSION_REQUEST_CODE = 102
        const val BACKGROUND_LOCATION_PERMISSION_REQUEST_CODE = 103
        const val POST_NOTIFICATIONS_REQUEST_CODE = 104
        const val SCAN_WORK_TAG = "periodicScanWork"
        const val PREFS_NAME = "FindMyAppPrefs"
        const val PREF_USER_THEME_COLOR = "user_theme_color"
        private const val LOCATION_REQUEST_TAG = "MainActivityLocationRequest"
    }

    private lateinit var bottomNavigationView: BottomNavigationView
    private val workManager by lazy { WorkManager.getInstance(applicationContext) }
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null
    private var webViewFragment: WebViewFragment? = null
    private var scannerFragment: ScannerFragment? = null
    private var activeFragment: Fragment? = null

    // Permission Launchers
    private val requestMultiplePermissionsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            var allBaseGranted = true
            var fineLocationGranted = false
            var coarseLocationGranted = false
            var btScanGranted = false
            var btConnectGranted = false

            permissions.entries.forEach {
                Log.d(TAG, "Permission ${it.key} granted: ${it.value}")
                if (!it.value) allBaseGranted = false
                when (it.key) {
                    Manifest.permission.ACCESS_FINE_LOCATION -> fineLocationGranted = it.value
                    Manifest.permission.ACCESS_COARSE_LOCATION -> coarseLocationGranted = it.value
                    Manifest.permission.BLUETOOTH_SCAN -> btScanGranted = it.value
                    Manifest.permission.BLUETOOTH_CONNECT -> btConnectGranted = it.value
                }
            }
            val baseLocationGranted = fineLocationGranted
            val baseBtGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                btScanGranted && btConnectGranted
            } else {
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
                        ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED
            }
            if (baseLocationGranted && baseBtGranted) {
                Log.i(TAG, "All required base permissions (Fine Location, BT Scan/Connect or legacy BT) granted.")
                checkAndRequestBackgroundLocation()
                checkAndRequestNotificationPermission()
            } else {
                Log.w(TAG, "Not all base permissions granted. FineLoc=$fineLocationGranted, BaseBT=$baseBtGranted")
                showPermissionRationale("Core Bluetooth and Location permissions are required for scanning and map features.") { proceed ->
                    if (!proceed) Toast.makeText(this,"Required permissions denied. Scanner functionality may be limited.", Toast.LENGTH_LONG).show()
                }
            }
            updatePermissionsStatusText()
        }

    private val requestBackgroundLocationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            if (isGranted) {
                Log.i(TAG, "Background Location permission granted.")
                checkAndRequestNotificationPermission()
            } else {
                Log.w(TAG, "Background Location permission denied.")
                showPermissionRationale("Background location ('Allow all the time') is needed for scanning when app is closed.", true) { _ ->
                }
            }
            updatePermissionsStatusText()
        }

    private val requestNotificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            if (isGranted) {
                Log.i(TAG, "Notification permission granted.")
            } else {
                Log.w(TAG, "Notification permission denied.")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    showPermissionRationale("Notifications are needed to alert you about your devices even when the app is not open.") { _ ->
                    }
                }
            }
            updatePermissionsStatusText()
        }

    private val requestLocationForWebLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            if (isGranted) {
                Log.i(TAG, "Location permission granted (via web request). Fetching location...")
                fetchLocationForWebView()
            } else {
                Log.w(TAG, "Location permission denied (via web request).")
                sendLocationToWebView(null, null, null, "Location permission denied by user.")
                Toast.makeText(this, "Location permission denied.", Toast.LENGTH_SHORT).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val storedUserColorHex = prefs.getString(PREF_USER_THEME_COLOR, null)

        if (storedUserColorHex != null) {
            Log.i(TAG, "Applying native theme based on stored user color: $storedUserColorHex")
            try {
                val contentBasedColor = Color.parseColor(storedUserColorHex)
                val options = DynamicColorsOptions.Builder()
                    .setContentBasedSource(contentBasedColor)
                    .build()
                DynamicColors.applyToActivityIfAvailable(this, options)
                Log.i(TAG, "DynamicColors applied with content-based source: $storedUserColorHex")
            } catch (e: IllegalArgumentException) {
                Log.e(TAG, "Invalid hex color string '$storedUserColorHex' for dynamic theming. Falling back.", e)
                DynamicColors.applyToActivityIfAvailable(this) // Fallback to default dynamic colors
            } catch (e: Exception) {
                Log.e(TAG, "Error applying content-based dynamic colors. Falling back.", e)
                DynamicColors.applyToActivityIfAvailable(this) // Fallback
            }
        } else {
            Log.i(TAG, "No stored user theme color. Applying default dynamic colors.")
            DynamicColors.applyToActivityIfAvailable(this)
        }

        super.onCreate(savedInstanceState) // Call super.onCreate() AFTER dynamic colors

        try { WindowCompat.setDecorFitsSystemWindows(window, false); window.statusBarColor = Color.TRANSPARENT }
        catch (e: Exception) { Log.e(TAG, "Failed to set edge-to-edge display", e) }
        setContentView(R.layout.activity_main)

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        bottomNavigationView = findViewById(R.id.bottom_navigation)
        val mainContainer = findViewById<View>(R.id.main_container)

        ViewCompat.setOnApplyWindowInsetsListener(mainContainer) { view, windowInsets ->
            val insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(insets.left, insets.top, insets.right, 0)
            bottomNavigationView.setPadding(bottomNavigationView.paddingLeft, bottomNavigationView.paddingTop, bottomNavigationView.paddingRight, insets.bottom)
            WindowInsetsCompat.CONSUMED
        }

        bottomNavigationView.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.navigation_webapp -> { loadOrShowFragment(WebViewFragment::class.java, "WEBVIEW_TAG"); true }
                R.id.navigation_scanner -> { loadOrShowFragment(ScannerFragment::class.java, "SCANNER_TAG"); true }
                else -> false
            }
        }

        if (savedInstanceState == null) {
            loadOrShowFragment(WebViewFragment::class.java, "WEBVIEW_TAG")
            bottomNavigationView.selectedItemId = R.id.navigation_webapp
        } else {
            webViewFragment = supportFragmentManager.findFragmentByTag("WEBVIEW_TAG") as? WebViewFragment
            scannerFragment = supportFragmentManager.findFragmentByTag("SCANNER_TAG") as? ScannerFragment
            val selectedItemId = bottomNavigationView.selectedItemId
            activeFragment = when (selectedItemId) {
                R.id.navigation_webapp -> webViewFragment
                R.id.navigation_scanner -> scannerFragment
                else -> supportFragmentManager.findFragmentById(R.id.nav_host_fragment)
            }
        }
        checkAndRequestPermissions()
    }


    // Permission Handling
    private fun checkAndRequestPermissions() {
        val requiredPermissions = getRequiredPermissions()
        val missingBasePermissions = requiredPermissions.filter {
            it != Manifest.permission.ACCESS_BACKGROUND_LOCATION && it != Manifest.permission.POST_NOTIFICATIONS &&
                    ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missingBasePermissions.isNotEmpty()) {
            Log.i(TAG, "Requesting missing base permissions: ${missingBasePermissions.joinToString()}")
            requestMultiplePermissionsLauncher.launch(missingBasePermissions.toTypedArray())
        } else {
            Log.i(TAG, "Base BT/Location permissions already granted.")
            checkAndRequestBackgroundLocation()
        }
        updatePermissionsStatusText()
    }

    private fun checkAndRequestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                    Log.i(TAG, "Showing rationale for Background Location.")
                    showPermissionRationale("Background location ('Allow all the time') is needed for scanning when app is closed.", true) { proceed ->
                        if (proceed) requestBackgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                        else { Log.w(TAG, "User declined background location from rationale."); checkAndRequestNotificationPermission() }
                    }
                } else {
                    Log.i(TAG, "Requesting Background Location permission (no rationale needed).")
                    requestBackgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
            } else { Log.i(TAG, "Background Location permission already granted."); checkAndRequestNotificationPermission() }
        } else { Log.i(TAG, "Background Location granted implicitly (OS < Q)."); checkAndRequestNotificationPermission() }
        updatePermissionsStatusText()
    }

    private fun checkAndRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.POST_NOTIFICATIONS)) {
                    Log.i(TAG, "Showing rationale for Notification permission.")
                    showPermissionRationale("Notifications are needed to alert you about your devices even when the app is not open.") { proceed ->
                        if (proceed) requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else Log.w(TAG, "User declined notification permission from rationale.")
                    }
                } else {
                    Log.i(TAG, "Requesting Notification permission (no rationale needed).")
                    requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            } else { Log.i(TAG, "Notification permission already granted.") }
        } else { Log.i(TAG, "Notification permission granted implicitly (OS < Tiramisu).") }
        updatePermissionsStatusText()
    }

    private fun getRequiredPermissions(): List<String> {
        val permissions = mutableListOf<String>()
        permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) { permissions.add(Manifest.permission.BLUETOOTH_SCAN); permissions.add(Manifest.permission.BLUETOOTH_CONNECT) }
        else { permissions.add(Manifest.permission.BLUETOOTH); permissions.add(Manifest.permission.BLUETOOTH_ADMIN) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        return permissions
    }

    private fun updatePermissionsStatusText() { Log.d(TAG, "Permissions status checked.") }

    private fun showPermissionRationale(message: String, isBackground: Boolean = false, onResult: ((Boolean) -> Unit)? = null) {
        val snackbar = Snackbar.make(findViewById(android.R.id.content), message, Snackbar.LENGTH_LONG)
        val actionText = if (isBackground) "Settings" else "Grant"
        snackbar.setAction(actionText) {
            if (isBackground) { val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS); val uri = Uri.fromParts("package", packageName, null); intent.data = uri; startActivity(intent); onResult?.invoke(true) }
            else { onResult?.invoke(true) }
        }
        snackbar.addCallback(object : Snackbar.Callback() { override fun onDismissed(sb: Snackbar?, event: Int) { if (event != DISMISS_EVENT_ACTION) onResult?.invoke(false) } })
        snackbar.setAnchorView(bottomNavigationView).show()
    }

    // Location for WebView
    @SuppressLint("MissingPermission")
    private fun fetchLocationForWebView() { Log.d(LOCATION_REQUEST_TAG, "Attempting to fetch location for WebView..."); removeLocationUpdates(); locationCallback = object : LocationCallback() { override fun onLocationResult(lr: LocationResult) { val l = lr.lastLocation; removeLocationUpdates(); if (l != null) { Log.i(LOCATION_REQUEST_TAG, "Location received: Lat=${l.latitude}, Lng=${l.longitude}, Acc=${l.accuracy}"); sendLocationToWebView(l.latitude, l.longitude, l.accuracy, null) } else { Log.w(LOCATION_REQUEST_TAG, "FusedLocationProvider returned null location."); sendLocationToWebView(null, null, null, "Failed to get location fix.") } } override fun onLocationAvailability(la: LocationAvailability) { if (!la.isLocationAvailable) { Log.w(LOCATION_REQUEST_TAG, "Location availability changed to unavailable."); removeLocationUpdates(); sendLocationToWebView(null, null, null, "Location provider unavailable.") } } }; val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000).setMinUpdateIntervalMillis(1000).setMaxUpdates(1).build(); try { fusedLocationClient.requestLocationUpdates(req, locationCallback!!, Looper.getMainLooper()); Log.d(LOCATION_REQUEST_TAG, "Location updates requested.") } catch (e: Exception) { Log.e(LOCATION_REQUEST_TAG, "Exception requesting location updates", e); sendLocationToWebView(null, null, null, "Error requesting location: ${e.javaClass.simpleName}"); locationCallback = null } }
    private fun removeLocationUpdates() { if (locationCallback != null) { Log.d(LOCATION_REQUEST_TAG, "Removing location updates."); try { fusedLocationClient.removeLocationUpdates(locationCallback!!) } catch (e: Exception) { Log.e(LOCATION_REQUEST_TAG, "Error removing location updates", e) } finally { locationCallback = null } } }
    private fun sendLocationToWebView(lat: Double?, lng: Double?, accuracy: Float?, errorMsg: String?) { val frg = webViewFragment; if (frg == null || !frg.isAdded) { Log.w(LOCATION_REQUEST_TAG, "Cannot send location to WebView: Fragment not active/attached."); return; }; val latS = lat?.toString() ?: "null"; val lngS = lng?.toString() ?: "null"; val accS = accuracy?.toString() ?: "null"; val errS = errorMsg?.let { "'${it.replace("\\", "\\\\").replace("'", "\\'")}'" } ?: "null"; val js = """javascript:(function() { if (typeof window.AppMap !== 'undefined' && typeof window.AppMap.updateUserLocationFromNative === 'function') { window.AppMap.updateUserLocationFromNative($latS, $lngS, $accS, $errS); } else { console.warn('[WebView] Native loc received, but JS callback AppMap.updateUserLocationFromNative not found.'); } })();"""; Log.d(LOCATION_REQUEST_TAG, "Eval JS: ${js.take(100)}..."); runOnUiThread { frg.evaluateJsInWebView(js) } }

    // Fragment Management
    private fun <T : Fragment> loadOrShowFragment(fragmentClass: Class<T>, tag: String) { val fm = supportFragmentManager; val ft = fm.beginTransaction(); var fr = fm.findFragmentByTag(tag); activeFragment?.let { if (it.tag != tag) ft.hide(it) }; if (fr == null) { fr = fragmentClass.newInstance(); ft.add(R.id.nav_host_fragment, fr, tag); when (tag) { "WEBVIEW_TAG" -> webViewFragment = fr as WebViewFragment; "SCANNER_TAG" -> scannerFragment = fr as ScannerFragment } } else { if (tag == "WEBVIEW_TAG" && webViewFragment == null) webViewFragment = fr as? WebViewFragment; if (tag == "SCANNER_TAG" && scannerFragment == null) scannerFragment = fr as? ScannerFragment; if (activeFragment != fr) ft.show(fr) }; activeFragment = fr; ft.commit() }

    // Back Press Handling
    override fun onBackPressed() { val tf = webViewFragment ?: supportFragmentManager.findFragmentByTag("WEBVIEW_TAG"); if (tf is WebViewFragment && tf.isVisible && tf.canGoBack()) { tf.goBack() } else { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) { super.onBackPressedDispatcher.onBackPressed() } else { @Suppress("DEPRECATION") super.onBackPressed() } } }

    // WebAppInterface
    inner class WebAppInterface(private val activityContext: Context) {
        private val sharedPreferences: SharedPreferences by lazy {
            activityContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
        @JavascriptInterface fun showToast(message: String) { (activityContext as? AppCompatActivity)?.runOnUiThread { Toast.makeText(activityContext, message, Toast.LENGTH_SHORT).show() }; Log.d("WebAppInterface", "Toast: $message") }
        @JavascriptInterface fun getAndroidScannerStatus(): String { Log.d("WebAppInterface", "JS->Native: getAndroidScannerStatus"); return "{\"status\": \"Native status TBD\"}" }
        @JavascriptInterface fun startNativeScan() { Log.d("WebAppInterface", "JS->Native: startNativeScan"); (activityContext as? AppCompatActivity)?.runOnUiThread { Toast.makeText(activityContext, "Native Scan Start (TODO)", Toast.LENGTH_SHORT).show() } }
        @JavascriptInterface fun stopNativeScan() { Log.d("WebAppInterface", "JS->Native: stopNativeScan"); (activityContext as? AppCompatActivity)?.runOnUiThread { Toast.makeText(activityContext, "Native Scan Stop (TODO)", Toast.LENGTH_SHORT).show() } }

        @JavascriptInterface
        fun getAppThemeColor(): String? {
            Log.d("WebAppInterface", "JS->Native: getAppThemeColor called.")
            val storedUserColor = sharedPreferences.getString(PREF_USER_THEME_COLOR, null)
            if (storedUserColor != null) {
                Log.i("WebAppInterface", "Returning stored user theme color from Prefs: $storedUserColor")
                return storedUserColor
            }
            Log.d("WebAppInterface", "No user color in Prefs, trying to read current theme's primary color.")
            return try {
                val typedValue = TypedValue()
                var colorInt: Int? = null
                if (activityContext.theme.resolveAttribute(com.google.android.material.R.attr.colorPrimary, typedValue, true)) colorInt = typedValue.data
                else if (activityContext.theme.resolveAttribute(android.R.attr.colorPrimary, typedValue, true)) colorInt = typedValue.data
                val hexColor = colorInt?.let { String.format("#%06X", (0xFFFFFF and it)) }
                Log.d("WebAppInterface", "Resolved theme color from attributes: $hexColor")
                hexColor
            } catch (e: Exception) { Log.e("WebAppInterface", "Error getting theme color from attributes", e); null }
        }

        @JavascriptInterface
        fun updateNativeThemeColor(hexColor: String?) {
            if (hexColor != null && hexColor.matches(Regex("^#[0-9a-fA-F]{6}$"))) {
                Log.i("WebAppInterface", "Native<-JS: updateNativeThemeColor received: $hexColor")
                try {
                    val oldColor = sharedPreferences.getString(PREF_USER_THEME_COLOR, null)
                    sharedPreferences.edit().putString(PREF_USER_THEME_COLOR, hexColor).apply()
                    Log.i("WebAppInterface", "Stored user theme color in Prefs: $hexColor")

                    if (oldColor != hexColor) {
                        Log.i("WebAppInterface", "Theme color changed ($oldColor -> $hexColor). Recreating activity to apply new native theme.")
                        (activityContext as? AppCompatActivity)?.runOnUiThread {
                            activityContext.recreate()
                        }
                    } else {
                        Log.d("WebAppInterface", "Theme color received from JS ($hexColor) is same as stored. No recreate needed.")
                    }

                } catch (e: Exception) { Log.e("WebAppInterface", "Failed to store theme color in Prefs", e) }
            } else { Log.w("WebAppInterface", "Received invalid hexColor from JS for theme: $hexColor") }
        }
        @JavascriptInterface fun isRunningInAndroidApp(): Boolean { Log.d("WebAppInterface", "JS->Native: isRunningInAndroidApp -> true"); return true }
        @JavascriptInterface fun getFCMToken(): String? { var token: String? = null; try { val fcmPrefs = activityContext.getSharedPreferences("fcm_prefs", Context.MODE_PRIVATE); token = fcmPrefs.getString("fcm_token", null); Log.d("WebAppInterface", "JS->Native: getFCMToken -> ${token?.take(10)}...") } catch (e: Exception) { Log.e("WebAppInterface", "Error getting stored FCM token", e) }; return token }
        @JavascriptInterface fun requestLocationUpdate() { Log.i(LOCATION_REQUEST_TAG, "JS->Native: requestLocationUpdate"); (activityContext as? AppCompatActivity)?.runOnUiThread { if (ContextCompat.checkSelfPermission(activityContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { fetchLocationForWebView() } else { Log.w(LOCATION_REQUEST_TAG, "Location permission needed for JS request."); requestLocationForWebLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION) } } }
    }
}