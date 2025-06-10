package com.gh182.findmy.scanner

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows
import org.robolectric.annotation.Config


@RunWith(AndroidJUnit4::class)
@Config(sdk = [28]) // Robolectric needs a specific SDK, choose one appropriate for your minSdk or targetSdk
class BluetoothScanWorkerTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        // No need to initialize WorkManagerTestInitHelper for simple ListenableWorker tests
        // if not using TestWorkerBuilder or specific testing features of WorkManager.
        // For direct instantiation with TestListenableWorkerBuilder, context is enough.
    }

    @Test
    fun testBluetoothScanWorker_doWork_successPath_startsService() {
        val worker = TestListenableWorkerBuilder<BluetoothScanWorker>(context).build()

        runBlocking {
            val result = worker.doWork()

            // Verify that the worker returns success
            assertEquals(ListenableWorker.Result.success(), result)

            // Verify that BluetoothScannerService was started with the correct action
            val shadowApplication = Shadows.shadowOf(context)
            val nextStartedService: Intent? = shadowApplication.nextStartedService

            assertNotNull("Service should have been started.", nextStartedService)
            assertEquals(
                "Intent should target BluetoothScannerService.",
                BluetoothScannerService::class.java.name,
                nextStartedService?.component?.className
            )
            assertEquals(
                "Intent should have ACTION_START_SCANNING_CYCLE.",
                BluetoothScannerService.ACTION_START_SCANNING_CYCLE,
                nextStartedService?.action
            )
        }
    }

    // Example of how one might test a retry scenario if the worker had internal logic leading to retry.
    // Current worker is simple, so this is more illustrative.
    // @Test
    // fun testBluetoothScanWorker_doWork_failurePath_retries() {
    //    // Setup conditions that would cause a retry (e.g., mock a dependency to throw an exception)
    //    // For example, if the worker was trying to make a network call that fails:
    //    // mock(SomeDependency::class.java).`when`(someCall()).thenThrow(IOException("Network failed"))
    //
    //    val worker = TestListenableWorkerBuilder<BluetoothScanWorker>(context).build()
    //    runBlocking {
    //        val result = worker.doWork()
    //        assertEquals(ListenableWorker.Result.retry(), result)
    //    }
    // }

}
