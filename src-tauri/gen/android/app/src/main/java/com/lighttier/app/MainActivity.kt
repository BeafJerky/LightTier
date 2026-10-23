package com.lighttier.app

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var lastTopInset = 0
  private var lastBottomInset = 0
  private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // WebView 的 insets 可能被父级消费为 0，改在 Decor 根节点读取真实系统栏尺寸。
    // 必须在 super.onCreate（内部会 setContentView）之后注册，再主动请求一次分发。
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      updateInsets(insets)
      webViewRef?.let { injectSafeAreaInsets(it) }
      insets
    }
    ViewCompat.requestApplyInsets(window.decorView)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.addJavascriptInterface(InsetsBridge(), "LTAndroidInsets")
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      // 语言/主题切换会整页 reload；新文档启动时立即写回安全区，避免首帧压在状态栏下
      WebViewCompat.addDocumentStartJavaScript(webView, SAFE_AREA_BOOTSTRAP, setOf("*"))
    }
    // 首次 insets 可能早于 WebView/页面就绪，按递增间隔补同步
    for (delay in longArrayOf(0L, 150L, 400L, 1000L, 2500L, 5000L)) {
      mainHandler.postDelayed({ syncInsetsAndInject(webView) }, delay)
    }
  }

  override fun onResume() {
    super.onResume()
    val webView = webViewRef ?: return
    // 从后台返回（如改变导航方式、分屏）时刷新一次
    mainHandler.postDelayed({ syncInsetsAndInject(webView) }, 150L)
  }

  private fun updateInsets(insets: WindowInsetsCompat) {
    val bars = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    lastTopInset = bars.top
    lastBottomInset = bars.bottom
  }

  private fun syncInsetsAndInject(webView: WebView) {
    val insets = ViewCompat.getRootWindowInsets(window.decorView)
    if (insets != null) {
      updateInsets(insets)
    }
    injectSafeAreaInsets(webView)
  }

  private fun injectSafeAreaInsets(webView: WebView) {
    // insets 为物理像素，需除以 devicePixelRatio 换算为 CSS px（否则高 DPI 机型会被放大数倍）
    val js = "if (document.documentElement) { var ltDpr = window.devicePixelRatio || 1;" +
      "document.documentElement.style.setProperty('--lt-safe-area-top', ${lastTopInset} / ltDpr + 'px');" +
      "document.documentElement.style.setProperty('--lt-safe-area-bottom', ${lastBottomInset} / ltDpr + 'px');}"
    webView.evaluateJavascript(js, null)
  }

  private inner class InsetsBridge {
    @JavascriptInterface
    fun getTop(): Int = lastTopInset

    @JavascriptInterface
    fun getBottom(): Int = lastBottomInset
  }

  companion object {
    private val SAFE_AREA_BOOTSTRAP = """
      (function () {
        function apply() {
          try {
            var bridge = window.LTAndroidInsets;
            var root = document.documentElement;
            if (!bridge || !root) return;
            var dpr = window.devicePixelRatio || 1;
            root.style.setProperty('--lt-safe-area-top', (bridge.getTop() / dpr) + 'px');
            root.style.setProperty('--lt-safe-area-bottom', (bridge.getBottom() / dpr) + 'px');
          } catch (e) {}
        }
        apply();
        document.addEventListener('DOMContentLoaded', apply);
        window.addEventListener('load', apply);
        window.addEventListener('pageshow', apply);
        var tries = 0;
        var timer = setInterval(function () { apply(); if (++tries >= 20) clearInterval(timer); }, 100);
      })();
    """.trimIndent()
  }
}
