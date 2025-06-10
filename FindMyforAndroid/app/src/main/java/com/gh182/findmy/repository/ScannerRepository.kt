// File: app/src/main/java/com/gh182/findmy/repository/ScannerRepository.kt
// Language: Kotlin

package com.gh182.findmy.repository

import android.util.Base64
import android.util.Log
import com.gh182.findmy.network.ApiService
import java.lang.Exception
import java.lang.IllegalArgumentException

class ScannerRepository(private val apiService: ApiService) {

    companion object {
        const val TAG = "ScannerRepository"
    }

    // --- Existing Data Classes ---
    data class ScannerConfigResponse(
        val scan_interval_seconds: Int,
        val device_files: List<DeviceFileInfo>,
        val report_endpoint: String?,
        val user_id: String?
    )

    data class DeviceFileInfo(
        val device_id: String,
        val type: String,
        val content_b64: String
    ) {
        fun getDecodedContent(): ByteArray? {
            return try {
                Base64.decode(content_b64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                Log.e(TAG, "Failed to decode base64 content for device $device_id: ${e.message}")
                null
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected error decoding base64 for device $device_id: ${e.message}", e)
                null
            }
        }
    }

    data class ScanReportRequest(
        val reports: List<ScanReport>
    )

    data class ScanReport(
        val device_id: String,
        val timestamp: String,
        val battery_status: String?
    )

    // <<< START NEW DATA CLASSES FOR TOKEN AUTH >>>
    data class GenerateTokenRequest(
        val username: String,
        val password: String,
        val description: String = "Android Scanner Client" // Default description
    )

    data class GenerateTokenResponse(
        val token: String?, // Nullable in case of error, though API should return error response
        val message: String? // Success or error message from backend
    )
    // <<< END NEW DATA CLASSES FOR TOKEN AUTH >>>


    // --- Existing Repository Functions ---
    suspend fun fetchScannerConfig(): ScannerConfigResponse? {
        return try {
            Log.d(TAG, "Attempting to fetch scanner config via API...")
            val response = apiService.getScannerConfig() // Call the suspend function
            if (response.isSuccessful) {
                val configData = response.body()
                if (configData != null) {
                    Log.i(TAG, "Successfully fetched scanner config for user ${configData.user_id}. Interval: ${configData.scan_interval_seconds}s, Devices: ${configData.device_files.size}")
                    configData
                } else {
                    Log.e(TAG, "Failed to fetch scanner config: Response body was null.")
                    null
                }
            } else {
                val errorBody = response.errorBody()?.string() ?: "No error body"
                Log.e(TAG, "Failed to fetch scanner config: ${response.code()} - ${response.message()}. Error Body: $errorBody")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception fetching scanner config: ${e.message}", e)
            null
        }
    }
    suspend fun reportScanResult(reportRequest: ScanReportRequest): Boolean {
        return try {
            Log.d(TAG, "Attempting to report ${reportRequest.reports.size} scan results via API...")
            val response = apiService.reportScanStatus(reportRequest) // Call the suspend function
            if (response.isSuccessful) {
                Log.i(TAG, "Successfully reported scan results.")
                true
            } else {
                val errorBody = response.errorBody()?.string() ?: "No error body"
                Log.e(TAG, "Failed to report scan results: ${response.code()} - ${response.message()}. Error Body: $errorBody")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception reporting scan results: ${e.message}", e)
            false
        }
    }

    // <<< START NEW REPOSITORY FUNCTION FOR TOKEN GENERATION >>>
    /**
     * Calls the backend API to generate an API token using username/password.
     * Returns the token response (containing token or error message) or null on exception.
     */
    suspend fun generateApiToken(request: GenerateTokenRequest): GenerateTokenResponse? {
        return try {
            Log.d(TAG, "Attempting to generate API token for user ${request.username}...")
            val response = apiService.generateToken(request) // Call the API service method

            if (response.isSuccessful) {
                val tokenResponse = response.body()
                if (tokenResponse?.token != null) {
                    Log.i(TAG, "Successfully generated API token.")
                } else {
                    // Handle cases where 201 might be returned but token is missing (shouldn't happen ideally)
                    Log.w(TAG, "Token generation API returned success status (${response.code()}) but no token in body.")
                }
                tokenResponse // Return the response body (might have token or just message)
            } else {
                // Handle API-level errors (4xx, 5xx)
                val errorBody = response.errorBody()?.string() ?: "No error body"
                var errorMessage = "API Error ${response.code()}: ${response.message()}"
                // Try to parse a specific error message from the Flask backend
                try {
                    val gson = com.google.gson.Gson() // Need Gson instance
                    val errorResponse = gson.fromJson(errorBody, GenerateTokenResponse::class.java)
                    if (!errorResponse.message.isNullOrBlank()) {
                        errorMessage = errorResponse.message
                    } else {
                        val error = gson.fromJson(errorBody, ErrorResponse::class.java)
                        errorMessage = error.error ?: errorMessage
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Could not parse error body from token generation: $errorBody")
                }
                Log.e(TAG, "Failed to generate API token: $errorMessage")
                // Return a response object indicating failure
                GenerateTokenResponse(token = null, message = errorMessage)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception during token generation request: ${e.message}", e)
            null // Return null for network or other exceptions
        }
    }
    // <<< END NEW REPOSITORY FUNCTION >>>

    // <<< START NEW Error Response Data Class (Helper) >>>
    // Simple data class to potentially parse error messages from Flask jsonify({'error': ...})
    private data class ErrorResponse(val error: String?)
    // <<< END NEW Error Response Data Class (Helper) >>>

} // End ScannerRepository class