// File: app/src/main/java/com/gh182/findmy/network/ApiService.kt
// Language: Kotlin

package com.gh182.findmy.network

import com.gh182.findmy.network.model.DeviceStatusPayload
import com.gh182.findmy.network.model.DevicesResponse
import com.gh182.findmy.network.model.ScanResultPayload
import com.gh182.findmy.repository.ScannerRepository // Import Request/Response classes
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface ApiService {

    // <<< START MODIFIED ENDPOINTS >>>
    @GET("api/public/scanner/config") // Moved to public scanner path
    suspend fun getScannerConfig(): Response<ScannerRepository.ScannerConfigResponse>

    @POST("api/public/scanner/report") // Moved to public scanner path
    suspend fun reportScanStatus(@Body reportRequest: ScannerRepository.ScanReportRequest): Response<Unit>

    @POST("api/public/auth/generate_token") // Moved token gen to public auth path
    suspend fun generateToken(@Body tokenRequest: ScannerRepository.GenerateTokenRequest): Response<ScannerRepository.GenerateTokenResponse>
    // <<< END MODIFIED ENDPOINTS >>>

    // --- Android App Specific Authenticated Endpoints ---
    @GET("api/android/devices")
    suspend fun getDeviceConfigsAndKeys(): Response<DevicesResponse>

    @POST("api/android/scan_result")
    suspend fun postScanResult(@Body payload: ScanResultPayload): Response<Unit> // Assuming empty success response

    @POST("api/android/device_status")
    suspend fun postDeviceStatus(@Body payload: DeviceStatusPayload): Response<Unit> // Assuming empty success response
    // --- End Android App Specific Endpoints ---

    // TODO: Add error reporting endpoint if needed (potentially under /api/public/scanner/error)
    // @POST("api/public/scanner/error")
    // suspend fun reportScanError(@Body errorRequest: YourErrorRequestDataClass): Response<Unit>
}