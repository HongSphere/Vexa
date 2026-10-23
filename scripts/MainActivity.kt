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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
    private var webViewInstance: WebView? = null

    class WebAppInterface(private val activity: MainActivity) {
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
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        this.webViewInstance = webView
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            } catch (e: Exception) {}
        }
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidNative")
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webViewInstance ?: findWebView(window.decorView.rootView)
                if (wv != null) {
                    wv.evaluateJavascript("window.__VEXA_ON_BACK_PRESSED && window.__VEXA_ON_BACK_PRESSED()") { _ -> }
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }
}
