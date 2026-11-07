package com.hongsphere.vexa

import android.content.Intent
import android.net.Uri
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.annotation.Keep
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
    private var webViewInstance: WebView? = null

    @Keep
    class WebAppInterface(private val activity: MainActivity) {
        @Keep
        @JavascriptInterface
        fun setFullscreen(fullscreen: Boolean) {
            activity.runOnUiThread {
                val windowInsetsController = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                if (fullscreen) {
                    windowInsetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    windowInsetsController.hide(WindowInsetsCompat.Type.systemBars())
                    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    windowInsetsController.show(WindowInsetsCompat.Type.systemBars())
                }
            }
        }

        @Keep
        @JavascriptInterface
        fun openBrowser(url: String) {
            activity.runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                } catch (e: Exception) {}
            }
        }

        @Keep
        @JavascriptInterface
        fun exitApp() {
            activity.terminateApp()
        }
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        configureWebView(webView)
    }

    private fun configureWebView(webView: WebView) {
        if (this.webViewInstance === webView) return
        this.webViewInstance = webView
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            } catch (e: Exception) {}
        }
        try {
            webView.addJavascriptInterface(WebAppInterface(this), "AndroidNative")
        } catch (e: Exception) {}
    }

    private fun terminateApp() {
        runOnUiThread {
            try {
                moveTaskToBack(true)
            } catch (e: Exception) {}
            try {
                finishAndRemoveTask()
            } catch (e: Exception) {}
            try {
                finishAffinity()
            } catch (e: Exception) {}
        }
    }

    private fun findWebView(root: View): WebView? {
        if (root is WebView) return root
        if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                val found = findWebView(root.getChildAt(i))
                if (found != null) return found
            }
        }
        return null
    }

    override fun onResume() {
        super.onResume()
        window.decorView.post {
            val wv = webViewInstance ?: findWebView(window.decorView.rootView)
            if (wv != null) {
                configureWebView(wv)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.post {
            val wv = webViewInstance ?: findWebView(window.decorView.rootView)
            if (wv != null) {
                configureWebView(wv)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webViewInstance ?: findWebView(window.decorView.rootView)
                if (wv != null) {
                    configureWebView(wv)
                    wv.evaluateJavascript("(function(){ return window.__VEXA_ON_BACK_PRESSED ? window.__VEXA_ON_BACK_PRESSED() : 'EXIT_APP'; })()") { res ->
                        if (res != null && res.contains("EXIT_APP")) {
                            terminateApp()
                        }
                    }
                } else {
                    terminateApp()
                }
            }
        })
    }
}
