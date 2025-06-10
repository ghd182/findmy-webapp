package com.gh182.findmy.network

import com.gh182.findmy.network.model.DeviceConfig
import com.gh182.findmy.network.model.DeviceKeyInfo
import com.gh182.findmy.network.model.DeviceStatusPayload
import com.gh182.findmy.network.model.DevicesResponse
import com.gh182.findmy.network.model.ScanResultPayload
import com.google.gson.Gson
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class ApiServiceTest {

    private lateinit var mockWebServer: MockWebServer
    private lateinit var apiService: ApiService
    private val gson = Gson()

    @Before
    fun setUp() {
        mockWebServer = MockWebServer()
        mockWebServer.start()

        val okHttpClient = OkHttpClient.Builder()
            .connectTimeout(1, TimeUnit.SECONDS)
            .readTimeout(1, TimeUnit.SECONDS)
            .writeTimeout(1, TimeUnit.SECONDS)
            .build()

        apiService = Retrofit.Builder()
            .baseUrl(mockWebServer.url("/")) // Use url from mockWebServer
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
            .create(ApiService::class.java)
    }

    @After
    fun tearDown() {
        mockWebServer.shutdown()
    }

    @Test
    fun getDeviceConfigsAndKeys_success() = runBlocking {
        // Prepare mock response
        val mockKeyInfo = DeviceKeyInfo("advKeyB64Str", "ROLLING_KEY", "macAddr")
        val mockDeviceConfig = DeviceConfig("id1", "Device 1", "L", "#FFF", "M", "I", listOf(mockKeyInfo))
        val mockDevicesResponse = DevicesResponse(listOf(mockDeviceConfig))
        val jsonResponse = gson.toJson(mockDevicesResponse)

        mockWebServer.enqueue(MockResponse().setBody(jsonResponse).setResponseCode(200))

        // Make the API call
        val response = apiService.getDeviceConfigsAndKeys()

        // Assertions
        assertTrue(response.isSuccessful)
        assertNotNull(response.body())
        assertEquals(1, response.body()?.devices?.size)
        assertEquals("id1", response.body()?.devices?.get(0)?.id)
        assertEquals("Device 1", response.body()?.devices?.get(0)?.name)
        assertEquals(1, response.body()?.devices?.get(0)?.keys?.size)
        assertEquals("advKeyB64Str", response.body()?.devices?.get(0)?.keys?.get(0)?.advKeyB64)

        // Verify request
        val recordedRequest = mockWebServer.takeRequest()
        assertEquals("GET", recordedRequest.method)
        assertEquals("/api/android/devices", recordedRequest.path)
    }

    @Test
    fun getDeviceConfigsAndKeys_empty_success() = runBlocking {
        val mockDevicesResponse = DevicesResponse(emptyList())
        val jsonResponse = gson.toJson(mockDevicesResponse)
        mockWebServer.enqueue(MockResponse().setBody(jsonResponse).setResponseCode(200))

        val response = apiService.getDeviceConfigsAndKeys()
        assertTrue(response.isSuccessful)
        assertNotNull(response.body())
        assertTrue(response.body()?.devices?.isEmpty() == true)
    }

    @Test
    fun getDeviceConfigsAndKeys_error() = runBlocking {
        mockWebServer.enqueue(MockResponse().setResponseCode(500).setBody("{\"error\":\"Server Error\"}"))

        val response = apiService.getDeviceConfigsAndKeys()
        assertFalse(response.isSuccessful)
        assertEquals(500, response.code())
        // Depending on how error bodies are handled, you might parse response.errorBody()
    }


    @Test
    fun postScanResult_success() = runBlocking {
        val payload = ScanResultPayload("deviceTestId", "2023-01-01T12:00:00Z", 88)
        mockWebServer.enqueue(MockResponse().setResponseCode(200)) // Expecting 200 or 204 for success with no body

        val response = apiService.postScanResult(payload)

        assertTrue(response.isSuccessful)
        // For Response<Unit>, body is null or Unit, check code for success
        assertEquals(200, response.code())

        val recordedRequest = mockWebServer.takeRequest()
        assertEquals("POST", recordedRequest.method)
        assertEquals("/api/android/scan_result", recordedRequest.path)
        val requestBody = recordedRequest.body.readUtf8()
        val sentPayload = gson.fromJson(requestBody, ScanResultPayload::class.java)
        assertEquals(payload.deviceId, sentPayload.deviceId)
        assertEquals(payload.timestamp, sentPayload.timestamp)
        assertEquals(payload.batteryLevel, sentPayload.batteryLevel)
    }

    @Test
    fun postScanResult_error() = runBlocking {
        val payload = ScanResultPayload("deviceTestId", "2023-01-01T12:00:00Z", 88)
        mockWebServer.enqueue(MockResponse().setResponseCode(400).setBody("{\"error\":\"Bad Request\"}"))

        val response = apiService.postScanResult(payload)
        assertFalse(response.isSuccessful)
        assertEquals(400, response.code())
    }

    @Test
    fun postDeviceStatus_success() = runBlocking {
        val payload = DeviceStatusPayload("deviceStatusId1", "nearby")
        mockWebServer.enqueue(MockResponse().setResponseCode(200))

        val response = apiService.postDeviceStatus(payload)
        assertTrue(response.isSuccessful)
        assertEquals(200, response.code())

        val recordedRequest = mockWebServer.takeRequest()
        assertEquals("POST", recordedRequest.method)
        assertEquals("/api/android/device_status", recordedRequest.path)
        val requestBody = recordedRequest.body.readUtf8()
        val sentPayload = gson.fromJson(requestBody, DeviceStatusPayload::class.java)
        assertEquals(payload.deviceId, sentPayload.deviceId)
        assertEquals(payload.status, sentPayload.status)
    }

    @Test
    fun postDeviceStatus_error() = runBlocking {
        val payload = DeviceStatusPayload("deviceStatusId1", "lost")
        mockWebServer.enqueue(MockResponse().setResponseCode(404).setBody("{\"error\":\"Device Not Found\"}"))

        val response = apiService.postDeviceStatus(payload)
        assertFalse(response.isSuccessful)
        assertEquals(404, response.code())
    }
}
