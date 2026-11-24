package com.lighttier.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File

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
    webView.addJavascriptInterface(InstallerBridge(), "LTAndroidInstaller")
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

  /**
   * 应用内更新：把下载目录里的 APK 交给系统安装器。
   * 返回 started（已拉起安装器）/ permission（缺“安装未知应用”授权，已打开设置页）/
   * missing（文件不存在）/ invalid（文件名非法）/ error。
   */
  private inner class InstallerBridge {
    @JavascriptInterface
    fun installApk(fileName: String): String {
      if (!ApkUpdate.isValidApkFileName(fileName)) return "invalid"
      val updateDir = File(dataDir, "resource/update").canonicalFile
      val apk = File(updateDir, fileName)
      if (!apk.isFile) return "missing"
      if (apk.canonicalFile.parentFile != updateDir) return "invalid"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !packageManager.canRequestPackageInstalls()
      ) {
        mainHandler.post {
          runCatching {
            startActivity(
              Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          }
        }
        return "permission"
      }
      // JS 只提供文件名；期望摘要必须由原生从固定官方 HTTPS 源重新获取。
      // FileProvider 只暴露 cache/files 等标准目录，先复制到唯一暂存文件并校验完整包体。
      val sharedDir = File(cacheDir, "update")
      val shared = try {
        if (!sharedDir.isDirectory && !sharedDir.mkdirs()) return "error"
        ApkUpdate.cleanupExpiredSharedApks(sharedDir, APK_INSTALL_CLEANUP_DELAY_MS)
        File.createTempFile("update-", ".apk", sharedDir)
      } catch (e: Exception) {
        return "error"
      }
      return ApkUpdate.copyVerifyAndLaunch(
        source = apk,
        target = shared,
        fileName = fileName,
        cleanupDelayMillis = APK_INSTALL_CLEANUP_DELAY_MS,
        launch = {
          val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", shared)
          val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          // Do not post: the bridge must observe ActivityManager launch failures synchronously.
          startActivity(intent)
        },
        scheduleCleanup = { delay, cleanup ->
          // Keep the URI readable throughout the installer's asynchronous package/session flow.
          mainHandler.postDelayed(cleanup, delay)
        }
      )
    }
  }

  companion object {
    // Long enough for the external installer to copy/parse the APK and create its install session.
    private const val APK_INSTALL_CLEANUP_DELAY_MS = 10 * 60 * 1000L
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
