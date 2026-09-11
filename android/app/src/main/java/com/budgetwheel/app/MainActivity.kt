package com.budgetwheel.app

import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.budgetwheel.app.widget.WheelWidgetProvider

/**
 * Hosts the Vite app in a local WebView and keeps the home-screen widget live.
 *
 * Bridge: writeBudget / readBudget / notifyWidgets / saveDownload /
 * openPlayStore / setChrome / pinWidget / widgetOwned / widgetPrice / buyWidget.
 * JS persist writes JSON; [BudgetStore.mergeBudgetJson] keeps widget purchases.
 * The widget refreshes after every budget write, on resume, and when prefs change.
 * No INTERNET — assets load from the APK via WebViewAssetLoader.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var root: View
    private lateinit var web: WebView
    private lateinit var store: BudgetStore
    private lateinit var billing: WidgetBilling
    private val budgetWatch =
        SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key != BudgetStore.KEY_BUDGET) return@OnSharedPreferenceChangeListener
            runOnUiThread {
                WheelWidgetProvider.refreshAll(this)
                pullBudgetIntoApp()
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        store = BudgetStore(this)
        store.watchBudget(budgetWatch)
        billing = WidgetBilling(this, store)
        billing.onOwned = { owned ->
            pushWidgetOwned(owned)
            WheelWidgetProvider.refreshAll(this)
        }
        billing.start()

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.setBackgroundColor(Color.parseColor("#0D0C10"))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        // Pad the host, not the WebView — WebView ignores its own padding.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.setSupportZoom(false)
        web.settings.displayZoomControls = false
        web.settings.mediaPlaybackRequiresUserGesture = true
        applyDisplaySettings()
        web.addJavascriptInterface(Bridge(store), "BudgetWheelAndroid")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                val url = request.url
                val path = url.path.orEmpty()
                val assetUrl =
                    if (path == "/widget" || path == "/widget/") {
                        url.buildUpon().encodedPath("/index.html").build()
                    } else {
                        url
                    }
                return assetLoader.shouldInterceptRequest(assetUrl)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return request.url.host != "appassets.androidplatform.net"
            }

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(
                    "(function(){var r=document.documentElement;r.style.setProperty('--safe-top','0px');r.style.setProperty('--safe-bot','0px');r.style.setProperty('--safe-left','0px');r.style.setProperty('--safe-right','0px');})()",
                    null,
                )
                pushWidgetOwned(store.widgetUnlocked())
                pullBudgetIntoApp()
                WheelWidgetProvider.refreshAll(this@MainActivity)
            }
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    web.evaluateJavascript(
                        "(function(){try{return !!(window.BudgetWheelBack&&window.BudgetWheelBack());}catch(e){return false;}})()",
                    ) { result ->
                        if (result == "true") return@evaluateJavascript
                        if (web.canGoBack()) web.goBack() else finish()
                    }
                }
            },
        )

        web.loadUrl("https://appassets.androidplatform.net/index.html")
        BudgetSync.attach { pullBudgetIntoApp() }
        handleUnlockIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleUnlockIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (this::root.isInitialized) ViewCompat.requestApplyInsets(root)
        applyDisplaySettings()
        if (this::billing.isInitialized) billing.refresh()
        pullBudgetIntoApp()
        WheelWidgetProvider.refreshAll(this)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyDisplaySettings()
        if (this::root.isInitialized) ViewCompat.requestApplyInsets(root)
    }

    override fun onDestroy() {
        if (this::billing.isInitialized) billing.stop()
        if (this::store.isInitialized) store.unwatchBudget(budgetWatch)
        BudgetSync.detach()
        super.onDestroy()
    }

    private fun handleUnlockIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(WidgetBilling.EXTRA_UNLOCK, false) != true) return
        if (!this::billing.isInitialized) return
        if (store.widgetUnlocked()) return
        billing.buy()
    }

    private fun pushWidgetOwned(owned: Boolean) {
        if (!this::web.isInitialized) return
        val flag = if (owned) "true" else "false"
        web.evaluateJavascript(
            "window.BudgetWheelWidgetOwned&&window.BudgetWheelWidgetOwned($flag)",
            null,
        )
    }

    private fun pullBudgetIntoApp() {
        if (!this::web.isInitialized) return
        if (Looper.myLooper() != Looper.getMainLooper()) {
            runOnUiThread { pullBudgetIntoApp() }
            return
        }
        web.evaluateJavascript(
            "window.BudgetWheelRefresh&&window.BudgetWheelRefresh()",
            null,
        )
    }

    inner class Bridge(private val store: BudgetStore) {
        @JavascriptInterface
        fun writeBudget(json: String) {
            store.writeBudgetJson(json)
            runOnUiThread { WheelWidgetProvider.refreshAll(this@MainActivity) }
        }

        @JavascriptInterface
        fun readBudget(): String {
            return store.readBudgetJson() ?: ""
        }

        @JavascriptInterface
        fun notifyWidgets() {
            runOnUiThread { WheelWidgetProvider.refreshAll(this@MainActivity) }
        }

        @JavascriptInterface
        fun saveDownload(filename: String, mime: String, base64: String): String {
            return try {
                saveHistoryFile(filename, mime, base64)
            } catch (err: Exception) {
                err.message ?: "Could not save the file."
            }
        }

        @JavascriptInterface
        fun openPlayStore() {
            runOnUiThread {
                val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.budgetwheel.app"))
                market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    startActivity(market)
                } catch (_: Exception) {
                    val web = Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=com.budgetwheel.app"),
                    )
                    web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(web)
                }
            }
        }

        @JavascriptInterface
        fun setChrome(theme: String) {
            runOnUiThread { applyChrome(theme == "light") }
        }

        @JavascriptInterface
        fun pinWidget(): String {
            if (!store.widgetUnlocked()) return "locked"
            val mgr = AppWidgetManager.getInstance(this@MainActivity)
            if (!mgr.isRequestPinAppWidgetSupported) return "unsupported"
            runOnUiThread {
                mgr.requestPinAppWidget(
                    ComponentName(this@MainActivity, WheelWidgetProvider::class.java),
                    null,
                    null,
                )
            }
            return "ok"
        }

        @JavascriptInterface
        fun widgetOwned(): String {
            return if (store.widgetUnlocked()) "1" else "0"
        }

        @JavascriptInterface
        fun widgetPrice(): String {
            return if (this@MainActivity::billing.isInitialized) billing.priceLabel else "$1.99"
        }

        @JavascriptInterface
        fun buyWidget(): String {
            runOnUiThread { billing.buy() }
            return "ok"
        }
    }

    private fun applyDisplaySettings() {
        if (!this::web.isInitialized) return
        val zoom = (resources.configuration.fontScale * 100f).toInt().coerceIn(100, 185)
        web.settings.textZoom = zoom
    }

    private fun applyChrome(light: Boolean) {
        val color = if (light) Color.parseColor("#F3EFE6") else Color.parseColor("#0D0C10")
        enableEdgeToEdge(
            statusBarStyle = if (light) {
                SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
            } else {
                SystemBarStyle.dark(Color.TRANSPARENT)
            },
            navigationBarStyle = if (light) {
                SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
            } else {
                SystemBarStyle.dark(Color.TRANSPARENT)
            },
        )
        window.decorView.setBackgroundColor(color)
        if (this::root.isInitialized) root.setBackgroundColor(color)
        if (this::web.isInitialized) web.setBackgroundColor(color)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    private fun saveHistoryFile(filename: String, mime: String, base64: String): String {
        val clean = filename.replace(Regex("[^A-Za-z0-9._\\- ]"), "-").take(80).ifBlank { "Budget-Wheel.pdf" }
        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, clean)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/pdf" })
                put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return "Could not create the file."
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return "Could not write the file."
            values.clear()
            values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
            return "ok"
        }
        val dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS)
            ?: cacheDir
        val file = java.io.File(dir, clean)
        file.writeBytes(bytes)
        return "ok"
    }
}
