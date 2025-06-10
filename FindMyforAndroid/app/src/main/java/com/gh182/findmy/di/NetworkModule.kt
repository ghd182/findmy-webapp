package com.gh182.findmy.di

import com.gh182.findmy.network.ApiService
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.net.CookieManager
import java.util.concurrent.TimeUnit

object NetworkModule {

    // Replace with your actual base URL, possibly from BuildConfig or a constants file
    private const val BASE_URL = "http://192.168.1.100:5000/" // Example: Replace with actual server URL

    @Volatile
    private var apiServiceInstance: ApiService? = null

    private fun provideOkHttpClient(): OkHttpClient {
        val cookieManager = CookieManager()
        // Set cookie policy to accept all cookies, or configure as needed
        // cookieManager.setCookiePolicy(CookiePolicy.ACCEPT_ALL)


        val loggingInterceptor = HttpLoggingInterceptor().apply {
            // Set log level for debugging (consider using BuildConfig.DEBUG)
            level = HttpLoggingInterceptor.Level.BODY
        }

        return OkHttpClient.Builder()
            .cookieJar(JavaNetCookieJar(cookieManager))
            .addInterceptor(loggingInterceptor) // Add logging interceptor for debugging
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private fun provideRetrofit(okHttpClient: OkHttpClient): Retrofit {
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun provideApiService(): ApiService {
        // Double-checked locking for thread safety, though for an object instance might be overkill
        // if initialization is guaranteed to be on the main thread or by a DI framework.
        // However, it's a good practice for singleton-like providers.
        return apiServiceInstance ?: synchronized(this) {
            apiServiceInstance ?: provideRetrofit(provideOkHttpClient()).create(ApiService::class.java)
                .also { apiServiceInstance = it }
        }
    }
}
