// File: app/src/main/java/com/gh182/findmy/fragment/WebViewFragment.kt
// Language: Kotlin
package com.gh182.findmy.fragment

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.util.Log
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.gh182.findmy.MainActivity
import com.gh182.findmy.R

class WebViewFragment : Fragment() {

    companion object {
        const val TAG = "WebViewFragment"
        private const val DEFAULT_PWA_URL = "https://findmy.ghed.ovh/"
        val BASE_PWA_URL: String by lazy {
            try {
                DEFAULT_PWA_URL
            } catch (e: Exception) {
                Log.w(TAG, "Could not read PWA_BASE_URL from BuildConfig, using default. Error: ${e.message}")
                DEFAULT_PWA_URL
            }
        }
    }

    lateinit var webView: WebView
        private set

    private lateinit var swipeRefreshLayout: SwipeRefreshLayout
    private var initialUrlLoaded = false

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_webview, container, false)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        webView = view.findViewById(R.id.webViewPWA)
        swipeRefreshLayout = view.findViewById(R.id.swipeRefreshLayout)

        setupWebView()
        setupSwipeRefresh()

        if (!initialUrlLoaded || webView.url == null || webView.url == "about:blank") {
            val prefs = requireActivity().getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val storedColor = prefs.getString(MainActivity.PREF_USER_THEME_COLOR, null)
            val urlToLoad: String = if (storedColor == null) {
                "$BASE_PWA_URL?useNativeTheme=true"
            } else {
                BASE_PWA_URL
            }
            Log.d(TAG, "Loading initial URL: $urlToLoad")
            webView.loadUrl(urlToLoad)
            initialUrlLoaded = true
        } else {
            Log.d(TAG, "WebViewFragment view created, but URL already loaded: ${webView.url}")
        }
    }

    private fun setupSwipeRefresh() {
        swipeRefreshLayout.setOnRefreshListener {
            Log.d(TAG, "Swipe to refresh triggered.")
            webView.reload()
        }
        try {
            val primaryColor = resolveThemeAttr(requireContext(), com.google.android.material.R.attr.colorPrimary) ?: Color.BLUE
            swipeRefreshLayout.setColorSchemeColors(primaryColor)
        } catch (e: Exception){
            Log.w(TAG, "Could not set swipe refresh colors from theme.", e)
            swipeRefreshLayout.setColorSchemeResources(android.R.color.holo_blue_bright)
        }
    }

    private fun resolveThemeAttr(context: Context, attrRes: Int): Int? {
        val typedValue = TypedValue()
        return if (context.theme.resolveAttribute(attrRes, typedValue, true)) typedValue.data else null
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            val mobileChromeUA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            userAgentString = mobileChromeUA
            useWideViewPort = true
            loadWithOverviewMode = true
            setGeolocationEnabled(true)
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
        }

        if (activity is MainActivity) {
            webView.addJavascriptInterface((activity as MainActivity).WebAppInterface(requireActivity()), "Android")
            Log.i(TAG, "Android JavaScriptInterface added.")
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Page finished loading: $url")
                swipeRefreshLayout.isRefreshing = false
                view?.evaluateJavascript("javascript:if(window.AppUI && typeof window.AppUI.hideWebScannerIfInAndroid === 'function'){window.AppUI.hideWebScannerIfInAndroid();}else{console.warn('AppUI not ready for scanner hide check.');}", null)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                swipeRefreshLayout.isRefreshing = false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Log.e(TAG, "WebView Error: Code=${error?.errorCode}, Desc=${error?.description}, URL=${request?.url}")
                } else {
                    Log.e(TAG, "WebView Error (Legacy) for URL: ${request?.url}")
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                Log.i(TAG, "shouldOverrideUrlLoading for URL: $url")

                val parsedUri = Uri.parse(url)
                val host = parsedUri.host?.lowercase() ?: ""
                val path = parsedUri.path ?: ""

                val externalMapDomains = listOf("maps.google.com", "www.google.com", "openstreetmap.org", "www.openstreetmap.org")
                if (externalMapDomains.any { host.contains(it) } && (path.contains("/maps") || host.contains("openstreetmap.org"))) {
                    Log.i(TAG, "External map link pattern matched. Opening externally: $url")
                    openExternalLink(url)
                    return true
                }

                val basePwaHost = Uri.parse(BASE_PWA_URL).host?.lowercase() ?: ""
                if (host == basePwaHost && (parsedUri.path?.startsWith("/public/shared/") == true)) {
                    Log.i(TAG, "Your app's public share link. Opening externally: $url")
                    openExternalLink(url)
                    return true
                }

                // For all other URLs, let the WebView load them.
                // This includes your main PWA domain and any auth domains (Cloudflare, Google OAuth, etc.)
                Log.d(TAG, "Letting WebView handle URL (not explicitly external): $url (Host: $host)")
                return false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                Log.d(TAG, "onGeolocationPermissionsShowPrompt for origin: $origin")
                val permission = Manifest.permission.ACCESS_FINE_LOCATION
                val context = activity ?: return
                if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) {
                    callback?.invoke(origin, true, false)
                } else {
                    callback?.invoke(origin, false, false)
                    Toast.makeText(context, "App needs Location permission for this.", Toast.LENGTH_LONG).show()
                }
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (newProgress == 100) {
                    swipeRefreshLayout.isRefreshing = false
                }
            }

            // <<< START REVISED onCreateWindow with better fallback >>>
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?
            ): Boolean {
                Log.w(TAG, "onCreateWindow called. isDialog: $isDialog, isUserGesture: $isUserGesture.")

                val hitTestResult = view?.hitTestResult
                var targetUrl: String? = null

                if (hitTestResult?.type == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                    hitTestResult?.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                    targetUrl = hitTestResult.extra
                    Log.d(TAG, "onCreateWindow: URL from HitTestResult: $targetUrl")
                } else if (resultMsg?.obj is WebView.WebViewTransport) {
                    // For some JS window.open(), the URL might not be in HitTestResult.
                    // This path is less common for simple target="_blank".
                    // We can't reliably get the URL here without more complex message handling.
                    Log.w(TAG, "onCreateWindow: WebViewTransport present, but URL not directly available via HitTest.")
                }


                if (!targetUrl.isNullOrEmpty()) {
                    Log.i(TAG, "onCreateWindow: Attempting to open extracted URL: $targetUrl")
                    // Let shouldOverrideUrlLoading decide if it's truly external or internal
                    // by simulating a load request for the current WebView.
                    // This is a common pattern to reuse the main URL handling logic.
                    val currentWebView = view ?: webView
                    if (currentWebView.webViewClient.shouldOverrideUrlLoading(currentWebView, WebResourceRequestImpl(Uri.parse(targetUrl), isUserGesture, isDialog, "GET", HashMap()))) {
                        // If shouldOverrideUrlLoading returns true, it means it handled it (e.g., opened externally).
                        // We've "handled" the new window request.
                        Log.d(TAG, "onCreateWindow: shouldOverrideUrlLoading handled $targetUrl externally.")
                        return true
                    } else {
                        // If shouldOverrideUrlLoading returns false, it means it wants the current WebView to load it.
                        // Since this was an onCreateWindow request, it implies the original page wanted a *new* window.
                        // Loading it in the *current* WebView might not be the desired user experience for a popup.
                        // However, it's better than it getting stuck.
                        Log.w(TAG, "onCreateWindow: shouldOverrideUrlLoading allowed $targetUrl. Will load in current WebView as fallback for new window request.")
                        currentWebView.loadUrl(targetUrl)
                        return true // We've handled it by loading in current WebView.
                    }
                }

                // If no URL could be determined or if we fall through, block the popup.
                Log.w(TAG, "onCreateWindow: Could not determine target URL or fell through. Blocking default new window behavior.")
                Toast.makeText(view?.context, "Popup blocked.", Toast.LENGTH_SHORT).show()
                return true
            }
            // <<< END REVISED onCreateWindow with better fallback >>>
        }
        Log.d(TAG, "WebView setup complete.")
    }

    // Helper for shouldOverrideUrlLoading to create a WebResourceRequest (for internal redirection)
    private class WebResourceRequestImpl(
        private val uri: Uri,
        private val isUserGesture: Boolean,
        private val isRedirect: Boolean,
        private val method: String,
        private val requestHeaders: HashMap<String, String>
    ) : WebResourceRequest {
        override fun getUrl(): Uri = uri
        override fun isForMainFrame(): Boolean = true // Assume it's for main frame for this purpose
        override fun isRedirect(): Boolean = isRedirect
        override fun hasGesture(): Boolean = isUserGesture
        override fun getMethod(): String = method
        override fun getRequestHeaders(): MutableMap<String, String> = requestHeaders
    }


    private fun openExternalLink(url: String): Boolean {
        Log.d(TAG, "Attempting to open external link: $url")
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            // No need to explicitly check resolveActivity, startActivity will throw ActivityNotFoundException
            startActivity(intent)
            Log.i(TAG, "Successfully started activity for external URL: $url")
            true // Activity was launched or attempted
        } catch (e: ActivityNotFoundException) {
            Log.e(TAG, "ActivityNotFoundException for URL: $url - No app can handle this URL.", e)
            Toast.makeText(context, "No application found to open this link. Please install a web browser.", Toast.LENGTH_LONG).show()
            false
        } catch (e: Exception) {
            Log.e(TAG, "Could not open external URL: $url", e)
            Toast.makeText(context, "Error opening link: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            false
        }
    }

    fun canGoBack(): Boolean {
        return view != null && this::webView.isInitialized && webView.canGoBack()
    }

    fun goBack() {
        if (view != null && this::webView.isInitialized) {
            webView.goBack()
        }
    }

    fun evaluateJsInWebView(jsCode: String) {
        if (this::webView.isInitialized) {
            activity?.runOnUiThread {
                webView.evaluateJavascript(jsCode, null)
            }
        } else {
            Log.e(TAG, "evaluateJsInWebView called but webView is not initialized!")
        }
    }
}