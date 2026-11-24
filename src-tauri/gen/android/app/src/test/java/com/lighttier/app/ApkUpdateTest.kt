package com.lighttier.app

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.cert.Certificate
import java.util.concurrent.CancellationException
import javax.net.ssl.HttpsURLConnection
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkUpdateTest {
  private val apkName = "LightTier_9.9.9_arm64-release-signed.apk"
  private val officialDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

  private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private fun asset(name: String = apkName, digest: String? = "sha256:$officialDigest"): String {
    val digestField = digest?.let { ",\"digest\":\"$it\"" } ?: ""
    return """{"name":"$name","size":123$digestField,"browser_download_url":"https://github.com/BeafJerky/LightTier/releases/download/v9.9.9/$name"}"""
  }

  private fun releases(vararg assets: String): String =
    """[{"tag_name":"v9.9.9","draft":false,"assets":[${assets.joinToString(",")}]}]"""

  @Test
  fun copiesMatchingPackageAndVerifiesCompleteBytes() {
    val source = File.createTempFile("lighttier-apk-source", ".apk")
    val target = File.createTempFile("lighttier-apk-target", ".apk")
    val bytes = byteArrayOf(0x4d, 0x5a, 1, 2, 3)
    try {
      source.writeBytes(bytes)
      assertTrue(ApkUpdate.copyAndVerify(source, target, sha256(bytes)))
      assertArrayEquals(bytes, target.readBytes())
    } finally {
      source.delete()
      target.delete()
    }
  }

  @Test
  fun rejectsTamperedPackageAndRemovesTemporaryCopy() {
    val source = File.createTempFile("lighttier-apk-source", ".apk")
    val target = File.createTempFile("lighttier-apk-target", ".apk")
    val original = byteArrayOf(0x4d, 0x5a, 1, 2, 3)
    try {
      source.writeBytes(byteArrayOf(0x4d, 0x5a, 9, 8, 7))
      assertFalse(ApkUpdate.copyAndVerify(source, target, sha256(original)))
      assertFalse(target.exists())
    } finally {
      source.delete()
      target.delete()
    }
  }

  @Test
  fun rejectsMalformedDigestBeforeWritingPackage() {
    val source = File.createTempFile("lighttier-apk-source", ".apk")
    val target = File.createTempFile("lighttier-apk-target", ".apk")
    try {
      source.writeBytes(byteArrayOf(0x4d, 0x5a))
      assertFalse(ApkUpdate.copyAndVerify(source, target, "sha256:1234"))
      assertFalse(target.exists())
    } finally {
      source.delete()
      target.delete()
    }
  }

  @Test
  fun successfulLaunchReturnsStartedAndKeepsApkUntilDelayedCleanupRuns() {
    val shared = File.createTempFile("lighttier-apk-shared", ".apk")
    var launchCalls = 0
    var cleanup: (() -> Unit)? = null
    var cleanupDelayMillis = 0L
    try {
      val status = ApkUpdate.launchAndScheduleCleanup(
        shared = shared,
        cleanupDelayMillis = 10 * 60 * 1000L,
        launch = {
          launchCalls++
          assertTrue(shared.exists())
        },
        scheduleCleanup = { delay, action ->
          cleanupDelayMillis = delay
          cleanup = action
        }
      )

      assertEquals("started", status)
      assertEquals(1, launchCalls)
      assertEquals(10 * 60 * 1000L, cleanupDelayMillis)
      assertTrue(shared.exists())
      assertNotNull(cleanup)

      cleanup!!.invoke()
      assertFalse(shared.exists())
    } finally {
      shared.delete()
    }
  }

  @Test
  fun failedLaunchReturnsErrorAndDeletesSharedApkWithoutSchedulingCleanup() {
    val shared = File.createTempFile("lighttier-apk-shared", ".apk")
    var cleanupScheduled = false
    try {
      val status = ApkUpdate.launchAndScheduleCleanup(
        shared = shared,
        cleanupDelayMillis = 10 * 60 * 1000L,
        launch = { throw SecurityException("installer unavailable") },
        scheduleCleanup = { _, _ -> cleanupScheduled = true }
      )

      assertEquals("error", status)
      assertFalse(shared.exists())
      assertFalse(cleanupScheduled)
    } finally {
      shared.delete()
    }
  }

  @Test
  fun cancelledLaunchReturnsErrorAndDeletesSharedApk() {
    val shared = File.createTempFile("lighttier-apk-shared", ".apk")
    try {
      val status = ApkUpdate.launchAndScheduleCleanup(
        shared = shared,
        cleanupDelayMillis = 10 * 60 * 1000L,
        launch = { throw CancellationException("installer cancelled") },
        scheduleCleanup = { _, _ -> }
      )

      assertEquals("error", status)
      assertFalse(shared.exists())
    } finally {
      shared.delete()
    }
  }

  @Test
  fun parsesDigestFromUniqueExactlyNamedOfficialAsset() {
    val json = releases(asset(name = "other.apk"), asset(digest = "sha256:${officialDigest.uppercase()}"))

    assertEquals(officialDigest, ApkUpdate.parseReleaseDigest(json, apkName))
  }

  @Test
  fun ignoresMissingDigestOnUnrelatedOfficialAssets() {
    val unrelated = """{"name":"notes.txt","digest":null}"""
    val json = releases(unrelated, asset())

    assertEquals(officialDigest, ApkUpdate.parseReleaseDigest(json, apkName))
  }

  @Test
  fun rejectsDuplicateAssetsWithTheRequestedFileName() {
    val json = releases(asset(), asset(digest = "sha256:${"f".repeat(64)}"))

    assertThrows(IllegalArgumentException::class.java) {
      ApkUpdate.parseReleaseDigest(json, apkName)
    }
  }

  @Test
  fun rejectsAssetsThatDoNotExactlyMatchTheSafeApkFileName() {
    val wrongNames = listOf("$apkName.extra", "other.apk", apkName.replace("LightTier", "lighttier"), "../$apkName")

    for (name in wrongNames) {
      assertThrows(IllegalArgumentException::class.java) {
        ApkUpdate.parseReleaseDigest(releases(asset(name = name)), apkName)
      }
    }
  }

  @Test
  fun rejectsMissingOrNonSha256AssetDigests() {
    val invalidDigests = listOf(
      null,
      "",
      "sha256:1234",
      "sha256:${"g".repeat(64)}",
      "sha256:${"a".repeat(63)}",
      "sha256:${"a".repeat(65)}",
      "sha256:$officialDigest ",
      "md5:${"a".repeat(64)}"
    )

    for (digest in invalidDigests) {
      assertThrows(IllegalArgumentException::class.java) {
        ApkUpdate.parseReleaseDigest(releases(asset(digest = digest)), apkName)
      }
    }
  }

  @Test
  fun rejectsMalformedJsonAndDuplicateObjectKeys() {
    val malformed = listOf(
      "{}",
      "[] trailing",
      """[{"assets":{}}]""",
      """[{"assets":[{"name":7,"digest":"sha256:$officialDigest"}]}]""",
      """[{"assets":[{"name":"$apkName","digest":7}]}]""",
      """[{"assets":[],"assets":[${asset()}]}]""",
      """[{"assets":[{"name":"$apkName","digest":"bad","digest":"sha256:$officialDigest"}]}]"""
    )

    for (json in malformed) {
      assertThrows(IllegalArgumentException::class.java) {
        ApkUpdate.parseReleaseDigest(json, apkName)
      }
    }
  }

  @Test
  fun rejectsNonAsciiDigitsInJsonNumbers() {
    val json = """[{"ignored":1٢,"assets":[${asset()}]}]"""

    assertThrows(IllegalArgumentException::class.java) {
      ApkUpdate.parseReleaseDigest(json, apkName)
    }
  }

  @Test
  fun rejectsOversizedReleaseMetadata() {
    val json = releases(asset()) + " ".repeat(ApkUpdate.MAX_RELEASE_RESPONSE_BYTES)

    assertThrows(IllegalArgumentException::class.java) {
      ApkUpdate.parseReleaseDigest(json, apkName)
    }
  }

  @Test
  fun rejectsDeeplyNestedUnknownMetadata() {
    val nested = "[".repeat(40) + "null" + "]".repeat(40)
    val json = """[{"ignored":$nested,"assets":[${asset()}]}]"""

    assertThrows(IllegalArgumentException::class.java) {
      ApkUpdate.parseReleaseDigest(json, apkName)
    }
  }

  @Test
  fun fetchesFromFixedHttpsEndpointWithTimeoutsAndNoRedirects() {
    lateinit var requestedUrl: URL
    lateinit var connection: FakeHttpsConnection
    val source = ApkUpdate.GitHubReleaseDigestSource { url ->
      requestedUrl = url
      FakeHttpsConnection(url, releases(asset()).toByteArray()).also { connection = it }
    }

    assertEquals(officialDigest, source.fetchSha256(apkName))
    assertEquals("https://api.github.com/repos/BeafJerky/LightTier/releases", requestedUrl.toString())
    assertEquals(10_000, connection.connectTimeout)
    assertEquals(15_000, connection.readTimeout)
    assertFalse(connection.instanceFollowRedirects)
  }

  @Test
  fun rejectsRedirectResponsesInsteadOfFollowingThem() {
    val source = ApkUpdate.GitHubReleaseDigestSource { url ->
      FakeHttpsConnection(url, ByteArray(0), responseCode = 302)
    }

    assertThrows(IOException::class.java) { source.fetchSha256(apkName) }
  }

  @Test
  fun rejectsNonHttpsConnections() {
    val source = ApkUpdate.GitHubReleaseDigestSource { url -> FakeHttpConnection(url) }

    assertThrows(IOException::class.java) { source.fetchSha256(apkName) }
  }

  @Test
  fun limitsDownloadedResponseBytesBeforeParsing() {
    val otherwiseValid = releases(asset()) + " ".repeat(ApkUpdate.MAX_RELEASE_RESPONSE_BYTES)
    val source = ApkUpdate.GitHubReleaseDigestSource { url ->
      FakeHttpsConnection(url, otherwiseValid.toByteArray())
    }

    val failure = assertThrows(IOException::class.java) { source.fetchSha256(apkName) }
    assertTrue(failure.message.orEmpty().contains("too large"))
  }

  @Test
  fun rejectsInvalidUtf8InReleaseMetadata() {
    val marker = "INVALID"
    val json = releases(asset()).replace("\"draft\":false", "\"draft\":false,\"note\":\"$marker\"")
    val markerOffset = json.indexOf(marker)
    val bytes = json.substring(0, markerOffset).toByteArray(Charsets.UTF_8) +
      byteArrayOf(0xc3.toByte(), 0x28) + json.substring(markerOffset + marker.length).toByteArray(Charsets.UTF_8)
    val source = ApkUpdate.GitHubReleaseDigestSource { url -> FakeHttpsConnection(url, bytes) }

    assertThrows(IOException::class.java) { source.fetchSha256(apkName) }
  }

  @Test
  fun digestNetworkFailureReturnsErrorWithoutLaunchingInstaller() {
    val source = File.createTempFile("lighttier-apk-source", ".apk").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    val target = File.createTempFile("lighttier-apk-target", ".apk")
    var launched = false
    var cleanupScheduled = false
    try {
      val status = ApkUpdate.copyVerifyAndLaunch(
        source = source,
        target = target,
        fileName = apkName,
        cleanupDelayMillis = 600_000L,
        digestSource = object : ApkUpdate.OfficialDigestSource {
          override fun fetchSha256(fileName: String): String = throw IOException("offline")
        },
        launch = { launched = true },
        scheduleCleanup = { _, _ -> cleanupScheduled = true }
      )

      assertEquals("error", status)
      assertFalse(launched)
      assertFalse(cleanupScheduled)
      assertFalse(target.exists())
    } finally {
      source.delete()
      target.delete()
    }
  }

  @Test
  fun verifiedOfficialPackageLaunchesAndRetainsDelayedCleanup() {
    val bytes = byteArrayOf(0x4d, 0x5a, 1, 2, 3)
    val source = File.createTempFile("lighttier-apk-source", ".apk").apply { writeBytes(bytes) }
    val target = File.createTempFile("lighttier-apk-target", ".apk")
    var requestedFileName: String? = null
    var cleanup: (() -> Unit)? = null
    var cleanupDelay = 0L
    try {
      val status = ApkUpdate.copyVerifyAndLaunch(
        source = source,
        target = target,
        fileName = apkName,
        cleanupDelayMillis = 600_000L,
        digestSource = object : ApkUpdate.OfficialDigestSource {
          override fun fetchSha256(fileName: String): String {
            requestedFileName = fileName
            return sha256(bytes)
          }
        },
        launch = { assertTrue(target.exists()) },
        scheduleCleanup = { delay, action ->
          cleanupDelay = delay
          cleanup = action
        }
      )

      assertEquals("started", status)
      assertEquals(apkName, requestedFileName)
      assertEquals(600_000L, cleanupDelay)
      assertArrayEquals(bytes, target.readBytes())
      assertNotNull(cleanup)
      cleanup!!.invoke()
      assertFalse(target.exists())
    } finally {
      source.delete()
      target.delete()
    }
  }

  @Test
  fun cleanupRemovesExpiredSharedApksButKeepsFreshAndUnrelatedFiles() {
    val directory = File.createTempFile("lighttier-apk-shared", "").apply {
      check(delete() && mkdir())
    }
    val now = 2_000_000_000_000L
    val expired = File(directory, "update-expired.apk").apply {
      writeBytes(byteArrayOf(1))
      setLastModified(now - 600_001L)
    }
    val fresh = File(directory, "update-fresh.apk").apply {
      writeBytes(byteArrayOf(1))
      setLastModified(now - 599_999L)
    }
    val unrelated = File(directory, "downloaded.apk").apply {
      writeBytes(byteArrayOf(1))
      setLastModified(now - 600_001L)
    }
    try {
      ApkUpdate.cleanupExpiredSharedApks(directory, maxAgeMillis = 600_000L, nowMillis = now)

      assertFalse(expired.exists())
      assertTrue(fresh.exists())
      assertTrue(unrelated.exists())
    } finally {
      directory.deleteRecursively()
    }
  }

  private open class FakeHttpConnection(url: URL) : HttpURLConnection(url) {
    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy(): Boolean = false
  }

  private class FakeHttpsConnection(
    url: URL,
    private val body: ByteArray,
    private val responseCode: Int = 200
  ) : HttpsURLConnection(url) {
    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy(): Boolean = false
    override fun getResponseCode(): Int = responseCode
    override fun getInputStream(): InputStream {
      if (responseCode !in 200..299) throw IOException("HTTP $responseCode")
      return ByteArrayInputStream(body)
    }
    override fun getHeaderField(name: String?): String? =
      if (name.equals("Content-Length", ignoreCase = true)) body.size.toString() else null
    override fun getCipherSuite(): String = "TLS_AES_128_GCM_SHA256"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate>? = null
  }
}
