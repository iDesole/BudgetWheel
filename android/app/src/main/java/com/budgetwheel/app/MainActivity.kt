package com.budgetwheel.app

import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import com.budgetwheel.app.widget.WheelWidgetProvider

/**
 * Hosts the Vite app in a local WebView and keeps the home-screen widget live.
 *
 * Bridge: writeBudget / readBudget / notifyWidgets / saveDownload.
 * JS persist writes JSON; [BudgetStore.mergeBudgetJson] keeps widget purchases.
 * The widget refreshes after every budget write, on resume, and when prefs change.
 * No INTERNET — assets load from the APK via WebViewAssetLoader.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var store: BudgetStore
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
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        store = BudgetStore(this)
        store.watchBudget(budgetWatch)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.setSupportZoom(false)
        web.settings.displayZoomControls = false
        web.settings.mediaPlaybackRequiresUserGesture = true
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
                pullBudgetIntoApp()
                WheelWidgetProvider.refreshAll(this@MainActivity)
            }
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (web.canGoBack()) web.goBack() else finish()
                }
            },
        )

        web.loadUrl("https://appassets.androidplatform.net/index.html")
        BudgetSync.attach { pullBudgetIntoApp() }
    }

    override fun onResume() {
        super.onResume()
        pullBudgetIntoApp()
        WheelWidgetProvider.refreshAll(this)
    }

    override fun onDestroy() {
        if (this::store.isInitialized) store.unwatchBudget(budgetWatch)
        BudgetSync.detach()
        super.onDestroy()
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
