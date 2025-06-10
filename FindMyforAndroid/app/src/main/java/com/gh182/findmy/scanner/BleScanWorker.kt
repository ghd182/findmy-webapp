// File: app/src/main/java/com/gh182/findmy/scanner/BleScanWorker.kt
// Language: Kotlin
package com.gh182.findmy.scanner

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.work.CoroutineWorker
// import androidx.work.Data // Unused import
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.gh182.findmy.network.RetrofitClient
import com.gh182.findmy.repository.ScannerRepository
import com.google.gson.Gson
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CancellationException

class BleScanWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "BleScanWorkerNew"
        const val APPLE_MANUFACTURER_ID = 0x004C
        const val DEFAULT_SCAN_PHASE_DURATION_MS = 25 * 1000L

        const val INPUT_SCAN_DURATION_SECONDS_KEY = "ScanDurationSeconds"
        const val OUTPUT_FOUND_DEVICES_KEY = "FoundDevicesJson"
        const val FAILURE_REASON_KEY = "FailureReason"
        const val OUTPUT_TIMESTAMP_KEY = "timestamp"
    }

    data class FoundDeviceData(
        val matchedDeviceId: String,
        val matchedDeviceName: String,
        val matchedKeyType: String,
        val rawStatusByte: Int,
        val rssi: Int?,
        val timestampMillis: Long,
        val macAddress: String?
    )

    private val bluetoothManager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private val bleScanner by lazy { bluetoothAdapter?.bluetoothLeScanner }

    private val repository: ScannerRepository by lazy { ScannerRepository(RetrofitClient.instance) }
    private val keyManager = KeyManager()

    @Volatile
    private var activeScanPhase = false
    private val scanResultsBuffer = mutableListOf<FoundDeviceData>()
    private val scanBufferLock = Any()

    private val supervisorJob = SupervisorJob()
    private val workerScope = CoroutineScope(Dispatchers.IO + supervisorJob)


    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.i(TAG, "Worker starting. Attempt: $runAttemptCount")
        var result: Result = Result.failure()

        try {
            if (!isActive) {
                Log.w(TAG, "Worker job was cancelled before doWork could proceed significantly.")
                return@withContext createFailure("Worker cancelled early.")
            }

            if (!hasPermissions() || !isBluetoothReady()) {
                return@withContext createFailure("Initial checks failed (Permissions/Bluetooth).")
            }

            if (!ensureKeyManagerInitialized()) {
                return@withContext createFailure("KeyManager initialization failed or was cancelled.")
            }

            val scanDurationMs = inputData.getLong(INPUT_SCAN_DURATION_SECONDS_KEY, DEFAULT_SCAN_PHASE_DURATION_MS / 1000) * 1000
            Log.i(TAG, "Scan phase duration: ${scanDurationMs / 1000}s")

            synchronized(scanBufferLock) { scanResultsBuffer.clear() }
            activeScanPhase = true

            val scanSuccess = executeScanPhase(scanDurationMs)

            if (!scanSuccess && isActive) {
                Log.w(TAG, "BLE scan phase encountered an issue or was interrupted (not by explicit cancellation).")
            } else if (scanSuccess) {
                Log.i(TAG, "BLE scan phase completed.")
            } else if (!isActive) {
                Log.i(TAG, "BLE scan phase did not complete successfully due to cancellation.")
            }


            if (isActive) {
                reportBufferedResultsToBackend()
            } else {
                Log.w(TAG, "Skipping report to backend as worker is no longer active.")
            }


            val outputJson = synchronized(scanBufferLock) { Gson().toJson(scanResultsBuffer) }
            val output = workDataOf(
                OUTPUT_FOUND_DEVICES_KEY to outputJson,
                OUTPUT_TIMESTAMP_KEY to System.currentTimeMillis()
            )

            result = if (!isActive) {
                Log.w(TAG, "Worker job cancelled before final success. Returning failure.")
                createFailure("Worker Cancelled")
            } else {
                Log.i(TAG, "Worker finished. Found ${scanResultsBuffer.size} devices. Outputting JSON.")
                Result.success(output)
            }
        } catch (e: CancellationException) {
            Log.w(TAG, "doWork was cancelled: ${e.message}", e)
            result = createFailure("Worker was cancelled during execution.")
        } catch (e: Exception) {
            Log.e(TAG, "Unhandled exception in doWork: ${e.message}", e)
            result = createFailure("Unhandled exception: ${e.message}")
        } finally {
            Log.d(TAG, "doWork finally block. Current coroutine active: $isActive. Cancelling supervisorJob and cleaning up.")
            activeScanPhase = false
            supervisorJob.cancel()
        }
        return@withContext result
    }

    private fun createFailure(reason: String): Result {
        Log.e(TAG, "Worker failed: $reason")
        return Result.failure(workDataOf(FAILURE_REASON_KEY to reason))
    }

    private fun hasPermissions(): Boolean {
        val neededPermissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            neededPermissions.add(Manifest.permission.BLUETOOTH_SCAN)
            neededPermissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            neededPermissions.add(Manifest.permission.BLUETOOTH)
            neededPermissions.add(Manifest.permission.BLUETOOTH_ADMIN)
        }
        neededPermissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            neededPermissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }

        val missing = neededPermissions.filter { ActivityCompat.checkSelfPermission(appContext, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            Log.e(TAG, "Missing permissions: ${missing.joinToString()}")
            return false
        }
        return true
    }

    private fun isBluetoothReady(): Boolean {
        if (bluetoothAdapter == null) { Log.e(TAG, "Bluetooth adapter unavailable."); return false }
        if (!bluetoothAdapter.isEnabled) { Log.e(TAG, "Bluetooth is disabled."); return false }
        if (bleScanner == null) { Log.e(TAG, "BluetoothLeScanner unavailable."); return false }
        return true
    }

    private suspend fun ensureKeyManagerInitialized(): Boolean {
        if (keyManager.isInitialized()) return true
        Log.i(TAG, "Initializing KeyManager...")
        var config: ScannerRepository.ScannerConfigResponse? = null
        for (attempt in 1..3) {
            if (!workerScope.isActive) { Log.w(TAG, "KeyManager init: workerScope cancelled."); return false }
            config = repository.fetchScannerConfig()
            if (config != null) break
            Log.w(TAG, "Config fetch attempt $attempt failed. Retrying in 5s.")
            delay(5000)
        }
        if (config == null) {
            Log.e(TAG, "Failed to fetch config for KeyManager after multiple attempts.")
            return false
        }
        if (!workerScope.isActive) { Log.w(TAG, "KeyManager init: workerScope cancelled after config fetch."); return false }
        return keyManager.initializeKeys(config.device_files)
    }

    private suspend fun executeScanPhase(durationMs: Long): Boolean {
        if (!workerScope.isActive) { Log.w(TAG, "executeScanPhase: workerScope cancelled before start."); return false }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && // Use Build.VERSION_CODES.S
            ActivityCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "BLUETOOTH_SCAN permission check failed just before scan start.")
            activeScanPhase = false
            return false
        }

        val scanDeferred = CompletableDeferred<Boolean>()
        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()
        val filters = listOf(ScanFilter.Builder().setManufacturerData(APPLE_MANUFACTURER_ID, ByteArray(0)).build())

        val scanCallbackImpl = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                if (!activeScanPhase || !workerScope.isActive) return
                result?.let {
                    workerScope.launch {
                        if (!isActive) return@launch
                        processDiscoveredDevice(it)
                    }
                }
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>?) {
                if (!activeScanPhase || !workerScope.isActive) return
                results?.forEach { result ->
                    workerScope.launch {
                        if (!isActive) return@launch
                        processDiscoveredDevice(result)
                    }
                }
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "BLE Scan failed. Error Code: $errorCode")
                activeScanPhase = false
                if (!scanDeferred.isCompleted) {
                    scanDeferred.complete(false)
                }
            }
        }

        Log.i(TAG, "Starting BLE scan phase for ${durationMs / 1000}s...")
        try {
            bleScanner?.startScan(filters, scanSettings, scanCallbackImpl)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException starting scan (check permissions): ${e.message}", e)
            activeScanPhase = false
            return false
        } catch (e: IllegalStateException){
            Log.e(TAG, "IllegalStateException starting scan (BT likely off): ${e.message}", e)
            activeScanPhase = false
            return false
        }
        catch (e: Exception) {
            Log.e(TAG, "Generic exception starting scan: ${e.message}", e)
            activeScanPhase = false
            return false
        }

        var scanPhaseOutcome = false
        try {
            scanPhaseOutcome = withTimeoutOrNull(durationMs) {
                if (!workerScope.isActive) {
                    if(!scanDeferred.isCompleted) scanDeferred.cancel(CancellationException("Worker scope cancelled during await"))
                    return@withTimeoutOrNull false
                }
                scanDeferred.await()
            } ?: workerScope.isActive
        } catch (e: TimeoutCancellationException) {
            Log.i(TAG, "Scan phase timed out as expected after $durationMs ms.")
            scanPhaseOutcome = workerScope.isActive
        } catch (e: CancellationException) {
            Log.w(TAG, "Scan deferred or timeout was cancelled: ${e.message}")
            scanPhaseOutcome = false
        } catch (e: Exception) {
            Log.e(TAG, "Exception during scan phase (await/timeout): ${e.message}", e)
            scanPhaseOutcome = false
        } finally {
            Log.d(TAG, "executeScanPhase finally block. activeScanPhase: $activeScanPhase, workerScope.isActive: ${workerScope.isActive}")
            activeScanPhase = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && // Use Build.VERSION_CODES.S
                ActivityCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "BLUETOOTH_SCAN permission missing, cannot stop scan gracefully in finally.")
            } else {
                try {
                    bleScanner?.stopScan(scanCallbackImpl)
                    Log.i(TAG, "BLE scan (using local callback) stopped in finally block of executeScanPhase.")
                } catch (se: SecurityException) {
                    Log.e(TAG, "SecurityException stopping scan in finally: ${se.message}", se)
                } catch (ise: IllegalStateException) {
                    Log.w(TAG, "IllegalStateException stopping scan in finally (BT likely off or not actively scanning): ${ise.message}")
                } catch (ex: Exception) {
                    Log.e(TAG, "Generic exception stopping scan in finally: ${ex.message}", ex)
                }
            }
        }
        return scanPhaseOutcome && workerScope.isActive
    }

    private fun processDiscoveredDevice(scanResult: ScanResult) {
        if (!workerScope.isActive) {
            Log.w(TAG, "processDiscoveredDevice: Worker scope is not active, skipping processing.")
            return
        }

        val deviceAddress = scanResult.device?.address ?: return
        val manufacturerData = scanResult.scanRecord?.getManufacturerSpecificData(APPLE_MANUFACTURER_ID) ?: return

        if (manufacturerData.size >= 27) {
            val type = manufacturerData[0].toInt() and 0xFF
            val length = manufacturerData[1].toInt() and 0xFF
            if (type == 0x12 && length == 0x19) {
                val ofPayload = manufacturerData.sliceArray(2 until 27)
                if (!workerScope.isActive) {
                    Log.w(TAG, "processDiscoveredDevice: Worker scope cancelled before key matching for $deviceAddress.")
                    return
                }
                keyManager.findMatchingKey(ofPayload, deviceAddress)?.let { match ->
                    if (!workerScope.isActive) {
                        Log.w(TAG, "processDiscoveredDevice: Worker scope cancelled after key match for ${match.deviceId}.")
                        return@let
                    }
                    Log.d(TAG, "Device Match: ${match.name} (ID: ${match.deviceId}), RSSI: ${scanResult.rssi}, Addr: $deviceAddress")
                    val data = FoundDeviceData(
                        matchedDeviceId = match.deviceId,
                        matchedDeviceName = match.name,
                        matchedKeyType = match.keyType,
                        rawStatusByte = ofPayload[0].toInt() and 0xFF,
                        rssi = scanResult.rssi,
                        timestampMillis = Instant.now().toEpochMilli(),
                        macAddress = deviceAddress
                    )
                    synchronized(scanBufferLock) {
                        if (!workerScope.isActive) return@synchronized
                        val existingIdx = scanResultsBuffer.indexOfFirst { it.matchedDeviceId == data.matchedDeviceId }
                        if (existingIdx != -1) {
                            if ((data.rssi ?: -128) > (scanResultsBuffer[existingIdx].rssi ?: -128)) {
                                scanResultsBuffer[existingIdx] = data
                                Log.v(TAG, "Updated existing device ${data.matchedDeviceId} with stronger RSSI ${data.rssi}")
                            }
                        } else {
                            scanResultsBuffer.add(data)
                            Log.v(TAG, "Added new device ${data.matchedDeviceId} with RSSI ${data.rssi}")
                        }
                    }
                }
            }
        }
    }

    private suspend fun reportBufferedResultsToBackend() {
        if (!workerScope.isActive) {
            Log.w(TAG, "Skipping report to backend as worker scope is cancelled.")
            return
        }

        val reports: List<ScannerRepository.ScanReport>
        synchronized(scanBufferLock) {
            if (scanResultsBuffer.isEmpty()) {
                return
            }
            reports = ArrayList(scanResultsBuffer).map {
                ScannerRepository.ScanReport(
                    device_id = it.matchedDeviceId,
                    timestamp = DateTimeFormatter.ISO_OFFSET_DATE_TIME.withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(it.timestampMillis)),
                    battery_status = keyManager.parseBatteryStatus(it.rawStatusByte)
                )
            }
        }
        if (reports.isEmpty()) {
            return
        }

        Log.d(TAG, "Attempting to report ${reports.size} scan results to backend.")
        try {
            if (!workerScope.isActive) {
                Log.w(TAG, "reportBufferedResultsToBackend: Worker scope cancelled before API call.")
                return
            }
            val success = repository.reportScanResult(ScannerRepository.ScanReportRequest(reports))
            if (success) {
                Log.i(TAG, "Successfully reported ${reports.size} results to backend.")
            } else {
                if(workerScope.isActive) Log.e(TAG, "Failed to report results to backend (API returned error).")
            }
        } catch (e: CancellationException) {
            Log.w(TAG, "Report to backend cancelled: ${e.message}")
        }
        catch (e: Exception) {
            // Logged unused parameter e
            if(workerScope.isActive) Log.e(TAG, "Exception while reporting scan results to backend: ${e.message}", e)
        }
    }
}