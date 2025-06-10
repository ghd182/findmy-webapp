package com.gh182.findmy.scanner

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
// import com.gh182.findmy.network.ApiService // Not used directly by worker anymore
// import com.gh182.findmy.network.model.DeviceConfig // Not used directly by worker anymore
// import kotlinx.coroutines.delay // Delay is removed as service runs independently
// import com.gh182.findmy.di.NetworkModule // Not used directly by worker anymore
// import com.gh182.findmy.repository.UserPreferencesRepository // Not used directly by worker anymore
// import kotlinx.coroutines.flow.firstOrNull // Not used directly by worker anymore


class BluetoothScanWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "BluetoothScanWorker"
        const val WORK_NAME = "BluetoothScanWorker"
        // SCAN_DURATION_MS is removed as the worker no longer waits for the service.
        // The service manages its own scan duration and lifecycle.
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "BluetoothScanWorker started.")

        try {
            // The worker's primary responsibility is to ensure the BluetoothScannerService's
            // scanning cycle is initiated. The service itself will handle fetching keys
            // and posting results as needed.

            Log.d(TAG, "Triggering BluetoothScannerService to start/check its scanning cycle.")
            val serviceIntent = Intent(applicationContext, BluetoothScannerService::class.java)
            serviceIntent.action = BluetoothScannerService.ACTION_START_SCANNING_CYCLE

            applicationContext.startService(serviceIntent)
            Log.i(TAG, "Sent ACTION_START_SCANNING_CYCLE to BluetoothScannerService.")

            // The worker's job is done once the service is signaled.
            // The service will run its scan cycle (scan, pause, scan...) independently.
            // The worker will be rescheduled by WorkManager based on the periodic request.

        } catch (e: Exception) {
            Log.e(TAG, "Error in BluetoothScanWorker while trying to start service: ${e.message}", e)
            // If starting the service fails, we might want to retry.
            return Result.retry()
        }

        Log.d(TAG, "BluetoothScanWorker finished its task of signaling the service.")
        return Result.success()
    }
}
