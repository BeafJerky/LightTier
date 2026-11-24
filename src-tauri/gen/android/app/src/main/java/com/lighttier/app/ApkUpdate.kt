package com.lighttier.app

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

internal object ApkUpdate {
  internal const val MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024
  private const val CONNECT_TIMEOUT_MS = 10_000
  private const val READ_TIMEOUT_MS = 15_000
  private const val MAX_JSON_DEPTH = 24
  private const val MAX_JSON_TOKENS = 100_000
  private const val OFFICIAL_RELEASES_API = "https://api.github.com/repos/BeafJerky/LightTier/releases"
  private val releasesUrl = URL(OFFICIAL_RELEASES_API)
  private val apkNamePattern = Regex("^[A-Za-z0-9._-]+\\.apk$")
  private val sha256Pattern = Regex("^[0-9a-fA-F]{64}$")
  private val releaseDigestPattern = Regex("^sha256:[0-9a-fA-F]{64}$")

  fun isValidApkFileName(value: String): Boolean = apkNamePattern.matches(value)

  fun isValidSha256(value: String): Boolean = sha256Pattern.matches(value)

  internal fun interface OfficialDigestSource {
    fun fetchSha256(fileName: String): String
  }

  /** Fetches the trusted value from the same official repository used by update discovery. */
  internal class GitHubReleaseDigestSource(
    private val connectionFactory: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }
  ) : OfficialDigestSource {
    override fun fetchSha256(fileName: String): String {
      if (!isValidApkFileName(fileName)) throw IllegalArgumentException("Invalid APK file name")
      val connection = connectionFactory(releasesUrl)
      try {
        if (connection !is HttpsURLConnection || connection.url.toString() != OFFICIAL_RELEASES_API) {
          throw IOException("Official releases endpoint must use HTTPS")
        }
        connection.requestMethod = "GET"
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.setRequestProperty("Accept", "application/vnd.github+json")
        connection.setRequestProperty("User-Agent", "LightTier-Android")
        if (connection.contentLength > MAX_RELEASE_RESPONSE_BYTES) {
          throw IOException("Release metadata is too large")
        }
        if (connection.responseCode !in 200..299) {
          throw IOException("GitHub releases returned HTTP ${connection.responseCode}")
        }
        val bytes = connection.inputStream.use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(16 * 1024)
          var total = 0
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > MAX_RELEASE_RESPONSE_BYTES) throw IOException("Release metadata is too large")
            output.write(buffer, 0, count)
          }
          output.toByteArray()
        }
        return parseReleaseDigest(decodeUtf8(bytes), fileName)
      } finally {
        connection.disconnect()
      }
    }

    private fun decodeUtf8(bytes: ByteArray): String {
      val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
      return try {
        decoder.decode(ByteBuffer.wrap(bytes)).toString()
      } catch (_: CharacterCodingException) {
        throw IOException("Release metadata is not valid UTF-8")
      }
    }
  }

  /**
   * Parses only the official asset identity and digest, rejecting ambiguous/malformed metadata.
   * A small strict parser keeps duplicate JSON keys observable instead of silently overwriting them.
   */
  fun parseReleaseDigest(json: String, fileName: String): String =
    ReleaseDigestParser(json, fileName).parse()

  /** The expected digest must come from the native source; any fetch failure closes the install path. */
  fun copyVerifyAndLaunch(
    source: File,
    target: File,
    fileName: String,
    cleanupDelayMillis: Long,
    digestSource: OfficialDigestSource = GitHubReleaseDigestSource(),
    launch: () -> Unit,
    scheduleCleanup: (Long, () -> Unit) -> Unit
  ): String {
    val expectedSha256 = try {
      digestSource.fetchSha256(fileName)
    } catch (_: Exception) {
      target.delete()
      return "error"
    }
    if (!copyAndVerify(source, target, expectedSha256)) return "invalid"
    return launchAndScheduleCleanup(target, cleanupDelayMillis, launch, scheduleCleanup)
  }

  /**
   * startActivity must finish without throwing before the bridge reports started.
   * The installer reads the shared APK asynchronously, so cleanup is deferred rather than run inline.
   */
  fun launchAndScheduleCleanup(
    shared: File,
    cleanupDelayMillis: Long,
    launch: () -> Unit,
    scheduleCleanup: (Long, () -> Unit) -> Unit
  ): String {
    return try {
      launch()
      scheduleCleanup(cleanupDelayMillis) { shared.delete() }
      "started"
    } catch (_: Exception) {
      shared.delete()
      "error"
    }
  }

  /** Recovers leftovers when a self-update killed the process before its delayed cleanup ran. */
  fun cleanupExpiredSharedApks(directory: File, maxAgeMillis: Long, nowMillis: Long = System.currentTimeMillis()) {
    val cutoff = nowMillis - maxAgeMillis
    directory.listFiles()?.forEach { file ->
      if (file.isFile && file.name.startsWith("update-") && file.name.endsWith(".apk") &&
        file.lastModified() <= cutoff
      ) {
        file.delete()
      }
    }
  }

  fun copyAndVerify(source: File, target: File, expectedSha256: String): Boolean {
    val expected = expectedSha256.lowercase()
    if (!isValidSha256(expected)) {
      target.delete()
      return false
    }
    return try {
      val digest = MessageDigest.getInstance("SHA-256")
      source.inputStream().buffered().use { input ->
        target.outputStream().buffered().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
            output.write(buffer, 0, count)
          }
        }
      }
      val actual = digest.digest().joinToString("") { "%02x".format(it) }
      if (actual == expected) {
        true
      } else {
        target.delete()
        false
      }
    } catch (_: Exception) {
      target.delete()
      false
    }
  }

  private class ReleaseDigestParser(private val json: String, private val fileName: String) {
    private var position = 0
    private var tokens = 0
    private var matchingAssets = 0
    private var matchingDigest: String? = null

    fun parse(): String {
      if (fileName.isEmpty() || !isValidApkFileName(fileName) ||
        json.length > MAX_RELEASE_RESPONSE_BYTES ||
        json.toByteArray(Charsets.UTF_8).size > MAX_RELEASE_RESPONSE_BYTES
      ) {
        fail()
      }
      expect('[')
      if (!consume(']')) {
        while (true) {
          parseRelease()
          if (consume(']')) break
          expect(',')
        }
      }
      skipWhitespace()
      if (position != json.length || matchingAssets != 1) fail()
      return matchingDigest?.removePrefix("sha256:")?.lowercase() ?: fail()
    }

    private fun parseRelease() {
      expect('{')
      val keys = HashSet<String>()
      if (!consume('}')) {
        while (true) {
          val key = parseString()
          if (!keys.add(key)) fail()
          expect(':')
          if (key == "assets") parseAssets() else skipValue(1)
          if (consume('}')) break
          expect(',')
        }
      }
    }

    private fun parseAssets() {
      expect('[')
      if (!consume(']')) {
        while (true) {
          parseAsset()
          if (consume(']')) break
          expect(',')
        }
      }
    }

    private fun parseAsset() {
      expect('{')
      val keys = HashSet<String>()
      var name: String? = null
      var digest: String? = null
      if (!consume('}')) {
        while (true) {
          val key = parseString()
          if (!keys.add(key)) fail()
          expect(':')
          when (key) {
            "name" -> name = parseString()
            "digest" -> digest = parseNullableString()
            else -> skipValue(1)
          }
          if (consume('}')) break
          expect(',')
        }
      }
      if (name == fileName) {
        matchingAssets++
        if (matchingAssets != 1 || digest == null || !releaseDigestPattern.matches(digest)) fail()
        matchingDigest = digest
      }
    }

    private fun skipValue(depth: Int) {
      if (depth > MAX_JSON_DEPTH) fail()
      skipWhitespace()
      when (peek()) {
        '{' -> skipObject(depth + 1)
        '[' -> skipArray(depth + 1)
        '"' -> parseString()
        't' -> parseLiteral("true")
        'f' -> parseLiteral("false")
        'n' -> parseLiteral("null")
        else -> parseNumber()
      }
    }

    private fun skipObject(depth: Int) {
      expect('{')
      val keys = HashSet<String>()
      if (!consume('}')) {
        while (true) {
          val key = parseString()
          if (!keys.add(key)) fail()
          expect(':')
          skipValue(depth)
          if (consume('}')) break
          expect(',')
        }
      }
    }

    private fun skipArray(depth: Int) {
      expect('[')
      if (!consume(']')) {
        while (true) {
          skipValue(depth)
          if (consume(']')) break
          expect(',')
        }
      }
    }

    private fun parseLiteral(literal: String) {
      tick()
      if (!json.startsWith(literal, position)) fail()
      position += literal.length
    }

    private fun parseNumber() {
      tick()
      if (consumeRaw('-') && peek() == null) fail()
      if (consumeRaw('0')) {
        if (isAsciiDigit(peek())) fail()
      } else {
        if (peek() !in '1'..'9') fail()
        while (isAsciiDigit(peek())) position++
      }
      if (consumeRaw('.')) {
        if (!isAsciiDigit(peek())) fail()
        while (isAsciiDigit(peek())) position++
      }
      if (peek() == 'e' || peek() == 'E') {
        position++
        if (peek() == '+' || peek() == '-') position++
        if (!isAsciiDigit(peek())) fail()
        while (isAsciiDigit(peek())) position++
      }
    }

    private fun parseNullableString(): String? {
      skipWhitespace()
      if (json.startsWith("null", position)) {
        parseLiteral("null")
        return null
      }
      return parseString()
    }

    private fun parseString(): String {
      tick()
      skipWhitespace()
      if (!consumeRaw('"')) fail()
      val value = StringBuilder()
      while (position < json.length) {
        val char = json[position++]
        when (char) {
          '"' -> return value.toString()
          '\\' -> parseEscape(value)
          else -> {
            if (char < ' ') fail()
            if (Character.isHighSurrogate(char)) {
              if (position >= json.length || !Character.isLowSurrogate(json[position])) fail()
              value.append(char).append(json[position++])
            } else if (!Character.isLowSurrogate(char)) {
              value.append(char)
            } else {
              fail()
            }
          }
        }
      }
      fail()
    }

    private fun parseEscape(value: StringBuilder) {
      if (position >= json.length) fail()
      when (val escaped = json[position++]) {
        '"', '\\', '/' -> value.append(escaped)
        'b' -> value.append('\b')
        'f' -> value.append('\u000c')
        'n' -> value.append('\n')
        'r' -> value.append('\r')
        't' -> value.append('\t')
        'u' -> {
          val code = parseHexCodeUnit()
          if (Character.isHighSurrogate(code)) {
            if (position + 2 > json.length || json[position] != '\\' || json[position + 1] != 'u') fail()
            position += 2
            val low = parseHexCodeUnit()
            if (!Character.isLowSurrogate(low)) fail()
            value.append(code).append(low)
          } else if (!Character.isLowSurrogate(code)) {
            value.append(code)
          } else {
            fail()
          }
        }
        else -> fail()
      }
    }

    private fun parseHexCodeUnit(): Char {
      if (position + 4 > json.length) fail()
      val code = json.substring(position, position + 4).toIntOrNull(16) ?: fail()
      position += 4
      return code.toChar()
    }

    private fun expect(char: Char) {
      if (!consume(char)) fail()
    }

    private fun consume(char: Char): Boolean {
      skipWhitespace()
      return consumeRaw(char)
    }

    private fun consumeRaw(char: Char): Boolean {
      if (peek() != char) return false
      position++
      return true
    }

    private fun skipWhitespace() {
      while (peek() == ' ' || peek() == '\n' || peek() == '\r' || peek() == '\t') position++
    }

    private fun peek(): Char? = json.getOrNull(position)

    private fun isAsciiDigit(char: Char?): Boolean = char != null && char in '0'..'9'

    private fun tick() {
      if (++tokens > MAX_JSON_TOKENS) fail()
    }

    private fun fail(): Nothing = throw IllegalArgumentException("Invalid GitHub release metadata at position $position")
  }
}
