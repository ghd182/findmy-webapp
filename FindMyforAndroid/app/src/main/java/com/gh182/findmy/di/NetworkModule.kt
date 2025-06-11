// File: FindMyforAndroid/app/src/main/java/com/gh182/findmy/di/NetworkModule.kt
// Language: Kotlin
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

    private const val BASE_URL = "http://192.168.1.100:5000/"

    @Volatile
    private var apiServiceInstance: ApiService? = null

    private fun provideOkHttpClient(): OkHttpClient {
        val cookieManager = CookieManager()
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        return OkHttpClient.Builder()
            .cookieJar(JavaNetCookieJar(cookieManager))
            .addInterceptor(loggingInterceptor)
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
        return apiServiceInstance ?: synchronized(this) {
            apiServiceInstance ?: provideRetrofit(provideOkHttpClient()).create(ApiService::class.java)
                .also { apiServiceInstance = it }
        }
    }
}