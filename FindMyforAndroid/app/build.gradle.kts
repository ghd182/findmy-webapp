// File: FindMyforAndroid/app/build.gradle.kts
// Language: Kotlin Script (build.gradle)

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.gh182.findmy"
    compileSdk = 35 // Or your target SDK

    defaultConfig {
        applicationId = "com.gh182.findmy"
        minSdk = 29 // Min SDK supporting required features
        targetSdk = 35 // Target SDK
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        viewBinding = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}" // Common exclude pattern
            excludes += "META-INF/LICENSE.md"
            excludes += "META-INF/NOTICE.md"
            excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }
}

dependencies {
    // --- Core & UI ---
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.swiperefreshlayout)
    implementation("androidx.browser:browser:1.8.0")

    // --- Lifecycle & ViewModel ---
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.livedata.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)

    // --- Coroutines ---
    implementation(libs.kotlinx.coroutines.android)

    // --- WorkManager (for Background Tasks) ---
    implementation(libs.androidx.work.runtime.ktx)

    // --- Networking (Retrofit, OkHttp, Gson) ---
    implementation(libs.retrofit)
    implementation(libs.converter.gson)
    implementation(libs.gson)
    implementation(platform(libs.okhttp.bom))
    implementation(libs.okhttp)
    implementation(libs.logging.interceptor)
    implementation("com.squareup.okhttp3:okhttp-urlconnection") // For JavaNetCookieJar

    // --- Firebase ---
    implementation(platform("com.google.firebase:firebase-bom:33.13.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
    implementation("com.google.firebase:firebase-analytics-ktx")

    // --- Location ---
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // --- Cryptography & Plist ---
    implementation(libs.bcprov.jdk18on)
    implementation(libs.dd.plist)

    // --- AndroidX Security (for EncryptedSharedPreferences) ---
    api("androidx.security:security-crypto:1.0.0") // Using 'api'

    // <<< START MODIFIED DEPENDENCY SECTION >>>
    implementation(libs.androidsvg) // For SVG rendering in ScanResultAdapter
    // <<< END MODIFIED DEPENDENCY SECTION >>>

    // --- Testing ---
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}