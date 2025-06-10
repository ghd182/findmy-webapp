// File: app/src/main/java/com/gh182/findmy/scanner/KeyManager.kt
// Language: Kotlin

package com.gh182.findmy.scanner

import android.util.Base64
import android.util.Log
import com.gh182.findmy.repository.ScannerRepository // For DeviceFileInfo

// --- Bouncy Castle Imports ---
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.jce.spec.ECParameterSpec
import org.bouncycastle.jce.ECNamedCurveTable
import org.bouncycastle.math.ec.ECPoint
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.KDF2BytesGenerator
// KDF2 uses HMac internally with a digest. We provide the digest directly.
import org.bouncycastle.crypto.params.KDFParameters
import java.security.Security
// --- End Bouncy Castle Imports ---

import java.math.BigInteger
import java.security.MessageDigest
import java.time.Duration // For time calculations
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit // For date manipulation
import java.util.Date // For plist parsing
import com.dd.plist.NSDictionary
import com.dd.plist.NSData
import com.dd.plist.NSDate
import com.dd.plist.PropertyListParser
import kotlin.math.max // For maxOf

/**
 * Manages Find My keys (both rolling and static) and performs matching operations.
 * Adapted from FindMy.py library logic.
 */
class KeyManager {

    companion object {
        const val TAG = "KeyManager"
        private const val CURVE_NAME = "secp224r1" // NIST P-224 curve name

        // Bouncy Castle Curve Parameters for secp224r1
        private val CURVE_PARAMS: ECParameterSpec = ECNamedCurveTable.getParameterSpec(CURVE_NAME)
            ?: throw IllegalStateException("secp224r1 curve not supported by BouncyCastle")

        private val N: BigInteger = CURVE_PARAMS.n // Order of the curve
        private val G: ECPoint = CURVE_PARAMS.g // Generator point

        private const val PRIVATE_KEY_BYTE_LEN = 28
        private const val PUBLIC_KEY_BYTE_LEN = PRIVATE_KEY_BYTE_LEN

        // Static initializer to add BouncyCastle provider if needed
        init {
            if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
                Security.addProvider(BouncyCastleProvider())
                Log.i(TAG, "BouncyCastleProvider added.")
            } else {
                Log.d(TAG, "BouncyCastleProvider already registered.")
            }
        }

        // History duration for rolling key window (similar to web app)
        private const val ROLLING_KEY_HISTORY_DAYS_PAST = 7L
        private const val ROLLING_KEY_HISTORY_DAYS_FUTURE = 1L
    }

    private var initialized = false
    private val rollingKeyDevices = mutableMapOf<String, RollingKeyDeviceParams>()
    private val staticKeyDevices = mutableMapOf<String, StaticKeyDeviceParams>()

    // --- Data Structures ---
    private data class RollingKeyDeviceParams(
        val deviceId: String,
        val name: String,
        val model: String?,
        val privateMasterKey: BigInteger, // Store as BigInteger
        val primarySk: ByteArray,
        val secondarySk: ByteArray,
        val pairedAt: ZonedDateTime, // Use ZonedDateTime for proper timezone handling
        val primaryKeyGenerator: AccessoryKeyGenerator,
        val secondaryKeyGenerator: AccessoryKeyGenerator
    ) {
        override fun equals(other: Any?): Boolean { if (this === other) return true; if (javaClass != other?.javaClass) return false; other as RollingKeyDeviceParams; return deviceId == other.deviceId }
        override fun hashCode(): Int { return deviceId.hashCode() }
    }

    private data class StaticKeyDeviceParams(
        val deviceId: String,
        val name: String,
        val privateKeysB64: List<String>,
        val keyPairs: List<KeyPair>
    )

    data class KeyPair(
        val privateKeyBytes: ByteArray,
        val publicKeyBytes: ByteArray,
        val hashedAdvKeyBytes: ByteArray
    ) {
        override fun equals(other: Any?): Boolean { if (this === other) return true; if (javaClass != other?.javaClass) return false; other as KeyPair; return privateKeyBytes.contentEquals(other.privateKeyBytes) }
        override fun hashCode(): Int { return privateKeyBytes.contentHashCode() }
    }

    data class MatchResult(
        val deviceId: String,
        val name: String,
        val keyType: String
    )

    inner class AccessoryKeyGenerator(
        private val masterKeyInt: BigInteger,
        private val initialSk: ByteArray
    ) {
        private val skCache = mutableMapOf<Int, ByteArray>()

        private fun getSk(index: Int): ByteArray {
            if (index < 0) throw IllegalArgumentException("Key index must be non-negative")
            skCache[index]?.let { return it }
            val nearestCachedIndex = skCache.keys.filter { it < index }.maxOrNull()
            var currentSk: ByteArray
            var currentIndex: Int
            if (nearestCachedIndex != null) {
                currentSk = skCache[nearestCachedIndex]!!
                currentIndex = nearestCachedIndex
            } else {
                currentSk = initialSk
                currentIndex = 0
                skCache[0] = currentSk
            }
            for (i in (currentIndex + 1)..index) {
                try {
                    currentSk = x963Kdf(currentSk, "update".toByteArray(), 32)
                    skCache[i] = currentSk
                } catch (e: Exception) {
                    Log.e(TAG, "Error deriving SK for index $i (from $currentIndex): ${e.message}")
                    throw RuntimeException("Failed to derive SK at index $i", e)
                }
            }
            return currentSk
        }

        fun getKeyPair(index: Int): KeyPair {
            val sk = getSk(index)
            val derivedPrivateKeyBytes = derivePrivateKey(masterKeyInt, sk)
            val publicKeyBytes = calculatePublicKey(derivedPrivateKeyBytes)
            val hashedAdvKey = sha256(publicKeyBytes)
            return KeyPair(derivedPrivateKeyBytes, publicKeyBytes, hashedAdvKey)
        }
    }

    @Synchronized
    fun initializeKeys(deviceFiles: List<ScannerRepository.DeviceFileInfo>): Boolean {
        Log.i(TAG, "Initializing keys from ${deviceFiles.size} device files...")
        rollingKeyDevices.clear()
        staticKeyDevices.clear()
        initialized = false
        var keysLoadedCount = 0

        deviceFiles.forEach { fileInfo ->
            Log.d(TAG, "Processing file for device: ${fileInfo.device_id}, type: ${fileInfo.type}")
            try {
                val decodedContent = fileInfo.getDecodedContent()
                if (decodedContent == null) {
                    Log.w(TAG, "Skipping device ${fileInfo.device_id}: Base64 decoding failed.")
                    return@forEach
                }
                when (fileInfo.type.lowercase()) {
                    "plist" -> {
                        val params = parsePlistData(fileInfo.device_id, decodedContent)
                        if (params != null) {
                            rollingKeyDevices[fileInfo.device_id] = params
                            keysLoadedCount++
                            Log.i(TAG, "Loaded ROLLING keys for ${fileInfo.device_id}")
                        } else { Log.w(TAG, "Failed to parse plist for ${fileInfo.device_id}") }
                    }
                    "keys" -> {
                        val params = parseKeysData(fileInfo.device_id, decodedContent)
                        if (params != null) {
                            staticKeyDevices[fileInfo.device_id] = params
                            keysLoadedCount++
                            Log.i(TAG, "Loaded STATIC keys for ${fileInfo.device_id}")
                        } else { Log.w(TAG, "Failed to parse keys file for ${fileInfo.device_id}") }
                    }
                    else -> Log.w(TAG, "Unsupported file type '${fileInfo.type}' for device ${fileInfo.device_id}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing device file for ${fileInfo.device_id}: ${e.message}", e)
            }
        }

        initialized = keysLoadedCount > 0
        Log.i(TAG, "Key initialization finished. Rolling: ${rollingKeyDevices.size}, Static: ${staticKeyDevices.size}. Initialized state: $initialized")
        return initialized
    }

    fun isInitialized(): Boolean = initialized

    private fun parsePlistData(deviceId: String, plistBytes: ByteArray): RollingKeyDeviceParams? {
        try {
            val root = PropertyListParser.parse(plistBytes) as? NSDictionary
                ?: throw IllegalArgumentException("Plist root is not a dictionary for device $deviceId")
            val name = root.objectForKey("name")?.toString() ?: deviceId
            val model = root.objectForKey("model")?.toString()
            val privateKeyDict = root.objectForKey("privateKey") as? NSDictionary
            val masterKeyData = (privateKeyDict?.objectForKey("key") as? NSDictionary)?.objectForKey("data") as? NSData
            if (masterKeyData == null || masterKeyData.bytes().size < PRIVATE_KEY_BYTE_LEN) {
                throw IllegalArgumentException("Master key data missing or too short for device $deviceId")
            }
            val masterKeyBytes = masterKeyData.bytes().takeLast(PRIVATE_KEY_BYTE_LEN).toByteArray()
            val privateMasterKeyInt = BigInteger(1, masterKeyBytes)
            val primarySecretDict = root.objectForKey("sharedSecret") as? NSDictionary
            val primarySkBytesData = (primarySecretDict?.objectForKey("key") as? NSDictionary)?.objectForKey("data") as? NSData
            if (primarySkBytesData == null || primarySkBytesData.bytes().size != 32) {
                throw IllegalArgumentException("Primary SK (sharedSecret) invalid or missing for device $deviceId")
            }
            val primarySkBytes = primarySkBytesData.bytes()
            val secondarySecretDict = (root.objectForKey("secondarySharedSecret") ?: root.objectForKey("secureLocationsSharedSecret")) as? NSDictionary
            val secondarySkBytesData = (secondarySecretDict?.objectForKey("key") as? NSDictionary)?.objectForKey("data") as? NSData
            if (secondarySkBytesData == null || secondarySkBytesData.bytes().size != 32) {
                throw IllegalArgumentException("Secondary SK invalid or missing for device $deviceId")
            }
            val secondarySkBytes = secondarySkBytesData.bytes()
            val pairingDateObj = root.objectForKey("pairingDate") as? NSDate
                ?: throw IllegalArgumentException("Pairing date missing for device $deviceId")
            val pairedAtInstant: Instant = pairingDateObj.date.toInstant()
            val pairedAtUtc: ZonedDateTime = ZonedDateTime.ofInstant(pairedAtInstant, ZoneOffset.UTC)
            val primaryGenerator = AccessoryKeyGenerator(privateMasterKeyInt, primarySkBytes)
            val secondaryGenerator = AccessoryKeyGenerator(privateMasterKeyInt, secondarySkBytes)
            Log.d(TAG, "Successfully parsed plist for device $deviceId (Name: $name, Model: $model, Paired: $pairedAtUtc)")
            return RollingKeyDeviceParams(deviceId, name, model, privateMasterKeyInt, primarySkBytes, secondarySkBytes, pairedAtUtc, primaryGenerator, secondaryGenerator)
        } catch (e: Exception) { Log.e(TAG, "Failed to parse plist data for $deviceId: ${e.message}", e); return null }
    }

    private fun parseKeysData(deviceId: String, keysBytes: ByteArray): StaticKeyDeviceParams? {
        try {
            val keysContent = String(keysBytes, Charsets.UTF_8)
            val privateKeysB64 = mutableListOf<String>()
            val keyPairs = mutableListOf<KeyPair>()
            keysContent.lines().forEach { line ->
                val trimmedLine = line.trim()
                if (trimmedLine.isBlank() || trimmedLine.startsWith("#")) return@forEach
                if (trimmedLine.startsWith("private key:", ignoreCase = true)) {
                    val keyB64 = trimmedLine.substringAfter(":").trim()
                    if (keyB64.isNotEmpty()) {
                        try {
                            val privateKeyBytes = Base64.decode(keyB64, Base64.DEFAULT)
                            if (privateKeyBytes.size == PRIVATE_KEY_BYTE_LEN) {
                                val publicKeyBytes = calculatePublicKey(privateKeyBytes)
                                val hashedAdvKey = sha256(publicKeyBytes)
                                keyPairs.add(KeyPair(privateKeyBytes, publicKeyBytes, hashedAdvKey))
                                privateKeysB64.add(keyB64)
                            } else { Log.w(TAG, "Invalid key length (${privateKeyBytes.size}) in keys file for $deviceId. Skipping.") }
                        } catch (e: IllegalArgumentException) { Log.w(TAG, "Invalid Base64 data for $deviceId: '$keyB64'. Error: ${e.message}") }
                        catch (e: Exception) { Log.w(TAG, "Error processing key '$keyB64' for $deviceId: ${e.message}") }
                    }
                }
            }
            if (keyPairs.isEmpty()) { Log.w(TAG, "No valid private keys in keys file for $deviceId."); return null }
            Log.d(TAG, "Parsed ${keyPairs.size} static keys for $deviceId")
            return StaticKeyDeviceParams(deviceId, deviceId, privateKeysB64, keyPairs)
        } catch (e: Exception) { Log.e(TAG, "Failed to parse .keys data for $deviceId: ${e.message}", e); return null }
    }

    private fun reconstructPublicKey(ofPayload: ByteArray, macAddress: String): ByteArray? {
        if (ofPayload.size != 25) { Log.w(TAG, "Invalid OF payload length: ${ofPayload.size}"); return null }
        val macBytes: ByteArray = try { macAddress.split(':').map { it.toInt(16).toByte() }.toByteArray() }
        catch (e: Exception) { Log.w(TAG, "Invalid MAC format: '$macAddress'"); return null }
        if (macBytes.size != 6) { Log.w(TAG, "Invalid MAC length: ${macBytes.size}"); return null }
        return try {
            val publicKeyBytes = ByteArray(PUBLIC_KEY_BYTE_LEN)
            val prefixByte = ofPayload[23].toInt() and 0xFF
            publicKeyBytes[0] = ((prefixByte shl 6) or (macBytes[0].toInt() and 0x3F)).toByte()
            System.arraycopy(macBytes, 1, publicKeyBytes, 1, 5)
            System.arraycopy(ofPayload, 1, publicKeyBytes, 6, 22)
            publicKeyBytes
        } catch (e: Exception) { Log.e(TAG, "Error reconstructing public key: ${e.message}", e); null }
    }

    fun findMatchingKey(ofPayload: ByteArray, macAddress: String): MatchResult? {
        if (!initialized) { Log.w(TAG, "Key Manager not initialized."); return null }
        val reconstructedPubKey = reconstructPublicKey(ofPayload, macAddress) ?: return null
        val incomingHashedKey = sha256(reconstructedPubKey)

        for ((_, params) in staticKeyDevices) {
            for (keyPair in params.keyPairs) {
                if (incomingHashedKey.contentEquals(keyPair.hashedAdvKeyBytes)) {
                    Log.i(TAG, "+++ Matched STATIC key for Device ID: ${params.deviceId} (Name: ${params.name}) +++")
                    return MatchResult(params.deviceId, params.name, "STATIC")
                }
            }
        }

        val now = ZonedDateTime.now(ZoneOffset.UTC)
        // <<< START MODIFIED TIME WINDOW >>>
        val windowStart = now.minusDays(ROLLING_KEY_HISTORY_DAYS_PAST)
        val windowEnd = now.plusDays(ROLLING_KEY_HISTORY_DAYS_FUTURE)
        // <<< END MODIFIED TIME WINDOW >>>

        for ((_, params) in rollingKeyDevices) {
            try {
                val potentialKeys = getPotentialKeysForWindow(params, windowStart, windowEnd)
                for (potentialKeyPair in potentialKeys) {
                    if (incomingHashedKey.contentEquals(potentialKeyPair.hashedAdvKeyBytes)) {
                        Log.i(TAG, "+++ Matched ROLLING key for Device ID: ${params.deviceId} (Name: ${params.name}) +++")
                        return MatchResult(params.deviceId, params.name, "ROLLING")
                    }
                }
            } catch (e: Exception) { Log.e(TAG, "Error checking rolling keys for ${params.deviceId}: ${e.message}", e) }
        }
        return null
    }

    private fun getPotentialKeysForWindow(params: RollingKeyDeviceParams, start: ZonedDateTime, end: ZonedDateTime): Set<KeyPair> {
        val keys = mutableSetOf<KeyPair>()
        val intervalSeconds = 15 * 60.0
        val pairedAtSeconds = params.pairedAt.toEpochSecond().toDouble()

        val startIndexDouble = (start.toEpochSecond().toDouble() - pairedAtSeconds) / intervalSeconds
        val endIndexDouble = (end.toEpochSecond().toDouble() - pairedAtSeconds) / intervalSeconds
        val startIndex = max(0.0, startIndexDouble).toInt()
        val endIndex = max(0.0, endIndexDouble).toInt() + 1
        val firstRolloverTime = params.pairedAt.withZoneSameInstant(ZoneId.systemDefault()).withHour(4).withMinute(0).withSecond(0).withNano(0).let { if (it.isBefore(params.pairedAt)) it.plusDays(1) else it }.withZoneSameInstant(ZoneOffset.UTC)
        val firstRolloverIndex = max(0.0, (firstRolloverTime.toEpochSecond().toDouble() - pairedAtSeconds) / intervalSeconds).toInt()

        Log.v(TAG, "Generating keys for ${params.deviceId} between indices $startIndex and $endIndex (Rollover: $firstRolloverIndex)")

        for (index in startIndex..endIndex) {
            try {
                keys.add(params.primaryKeyGenerator.getKeyPair(index))
                val secondaryIndexCurrentCycle = index / 96 + 1
                keys.add(params.secondaryKeyGenerator.getKeyPair(secondaryIndexCurrentCycle))
                if (index >= firstRolloverIndex) {
                    val indexSinceFirstRollover = index - firstRolloverIndex
                    val secondaryIndexPreviousCycle = indexSinceFirstRollover / 96 + 2
                    keys.add(params.secondaryKeyGenerator.getKeyPair(secondaryIndexPreviousCycle))
                }
            } catch (e: Exception) { Log.w(TAG, "Error gen key index $index, device ${params.deviceId}: ${e.message}") }
        }
        return keys
    }

    private fun x963Kdf(ikm: ByteArray, sharedInfo: ByteArray, length: Int): ByteArray {
        val digest = SHA256Digest()
        val generator = KDF2BytesGenerator(digest)
        generator.init(KDFParameters(ikm, sharedInfo))
        val out = ByteArray(length)
        generator.generateBytes(out, 0, length)
        return out
    }

    private fun derivePrivateKey(masterKeyInt: BigInteger, sk: ByteArray): ByteArray {
        val at = x963Kdf(sk, "diversify".toByteArray(), 72)
        val uBytes = at.sliceArray(0 until 36)
        val vBytes = at.sliceArray(36 until 72)
        val nMinusOne = N.subtract(BigInteger.ONE)
        val u = BigInteger(1, uBytes).mod(nMinusOne).add(BigInteger.ONE)
        val v = BigInteger(1, vBytes).mod(nMinusOne).add(BigInteger.ONE)
        val keyInt = u.multiply(masterKeyInt).add(v).mod(N)
        return bigIntegerToBytes(keyInt, PRIVATE_KEY_BYTE_LEN)
    }

    private fun calculatePublicKey(privateKeyBytes: ByteArray): ByteArray {
        if (privateKeyBytes.size != PRIVATE_KEY_BYTE_LEN) {
            throw IllegalArgumentException("Private key must be $PRIVATE_KEY_BYTE_LEN bytes")
        }
        val privateKeyInt = BigInteger(1, privateKeyBytes)
        val publicPoint: ECPoint = G.multiply(privateKeyInt).normalize()
        val xCoord = publicPoint.affineXCoord.toBigInteger()
        return bigIntegerToBytes(xCoord, PUBLIC_KEY_BYTE_LEN)
    }

    private fun bigIntegerToBytes(bi: BigInteger, length: Int): ByteArray {
        val bytes = bi.toByteArray()
        return when {
            bytes.size == length -> bytes
            bytes.size == length + 1 && bytes[0] == 0.toByte() -> bytes.copyOfRange(1, bytes.size)
            bytes.size > length -> bytes.copyOfRange(bytes.size - length, bytes.size)
            else -> ByteArray(length - bytes.size) + bytes
        }
    }

    private fun sha256(data: ByteArray): ByteArray {
        return MessageDigest.getInstance("SHA-256").digest(data)
    }

    fun parseBatteryStatus(statusByte: Int): String {
        val batteryBits = (statusByte shr 6) and 0b11
        return when (batteryBits) {
            0b00 -> "Full"
            0b01 -> "Medium"
            0b10 -> "Low"
            0b11 -> "Very Low"
            else -> "Unknown"
        }
    }
}