// File: app/src/main/java/com/gh182/findmy/network/RetrofitClient.kt
// Language: Kotlin
// Purpose: Configure Retrofit HTTP client, including authentication interceptors.

package com.gh182.findmy.network

import android.content.Context
import android.util.Log
import com.gh182.findmy.scanner.TokenStorage
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.util.concurrent.TimeUnit

object RetrofitClient {

    private const val BASE_URL = "https://findmy.ghed.ovh"

    // <<< START MODIFIED INTERCEPTOR (Removed context parameter) >>>
    private class AuthTokenInterceptor : Interceptor { // Removed 'val context: Context'
        @Throws(IOException::class)
        override fun intercept(chain: Interceptor.Chain): Response {
            val originalRequest = chain.request()
            if (originalRequest.url.encodedPath.endsWith("/api/public/auth/generate_token")) {
                Log.d("AuthTokenInterceptor", "Skipping token addition for token generation request.")
                return chain.proceed(originalRequest)
            }

            val token = TokenStorage.getToken()

            if (!token.isNullOrBlank()) {
                Log.d("AuthTokenInterceptor", "Adding Authorization Bearer token to request for ${originalRequest.url}")
                val newRequest = originalRequest.newBuilder()
                    .header("Authorization", "Bearer $token")
                    .build()
                return chain.proceed(newRequest)
            } else {
                Log.w("AuthTokenInterceptor", "No API token found in storage. Proceeding without Authorization header for ${originalRequest.url}")
                return chain.proceed(originalRequest)
            }
        }
    }
    // <<< END MODIFIED INTERCEPTOR >>>


    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    @Volatile private var isInitialized = false
    private lateinit var appContextForClient: Context

    @Synchronized
    fun initialize(context: Context) {
        if (!isInitialized) {
            appContextForClient = context.applicationContext
            TokenStorage.initialize(appContextForClient)
            isInitialized = true
            Log.i("RetrofitClient", "OkHttpClient context and TokenStorage initialized.")
        } else {
            Log.d("RetrofitClient", "OkHttpClient context already initialized.")
        }
    }

    private val okHttpClient: OkHttpClient by lazy {
        if (!isInitialized) {
            throw IllegalStateException("RetrofitClient must be initialized with context before accessing OkHttpClient!")
        }
        Log.d("RetrofitClient","Building OkHttpClient instance...")
        OkHttpClient.Builder()
            .addInterceptor(AuthTokenInterceptor()) // Pass context if needed by interceptor, but it's not now
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }


    val instance: ApiService by lazy {
        if (!isInitialized) {
            throw IllegalStateException("RetrofitClient must be initialized with context before creating ApiService instance!")
        }
        Log.d("RetrofitClient","Building Retrofit ApiService instance...")
        val retrofit = Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        retrofit.create(ApiService::class.java)
    }
}