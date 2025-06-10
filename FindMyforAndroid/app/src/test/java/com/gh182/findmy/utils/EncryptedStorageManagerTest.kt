package com.gh182.findmy.utils

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.gh182.findmy.network.model.DeviceConfig
import com.gh182.findmy.network.model.DeviceKeyInfo
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EncryptedStorageManagerTest {

    private lateinit var context: Context
    private lateinit var storageManager: EncryptedStorageManager

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        // Initialize with a test-specific file name if necessary, or ensure it's cleaned up
        storageManager = EncryptedStorageManager(context)
        storageManager.clearAllData() // Clear before each test
    }

    @After
    fun tearDown() {
        storageManager.clearAllData() // Clear after each test
    }

    @Test
    fun saveAndGetDeviceConfigs_emptyList() {
        val emptyList = emptyList<DeviceConfig>()
        storageManager.saveDeviceConfigs(emptyList)
        val retrieved = storageManager.getDeviceConfigs()
        assertNotNull(retrieved)
        assertTrue(retrieved!!.isEmpty())
    }

    @Test
    fun saveAndGetDeviceConfigs_singleDevice_noKeys() {
        val device = DeviceConfig(
            id = "device1",
            name = "Test Device 1",
            label = "🧪",
            color = "#FF0000",
            model = "ModelX",
            icon = "icon_test",
            keys = emptyList()
        )
        val listToSave = listOf(device)
        storageManager.saveDeviceConfigs(listToSave)
        val retrieved = storageManager.getDeviceConfigs()
        assertNotNull(retrieved)
        assertEquals(1, retrieved!!.size)
        assertEquals(device, retrieved[0])
    }

    @Test
    fun saveAndGetDeviceConfigs_multipleDevices_withKeys() {
        val key1 = DeviceKeyInfo("keyB64_1", "ROLLING_KEY", "mac1")
        val key2 = DeviceKeyInfo("keyB64_2", "STATIC_KEY", null)

        val device1 = DeviceConfig("d1", "Device Alpha", "A", "#111", "M1", "ic1", listOf(key1))
        val device2 = DeviceConfig("d2", "Device Beta", "B", "#222", "M2", "ic2", listOf(key2, key1))

        val listToSave = listOf(device1, device2)
        storageManager.saveDeviceConfigs(listToSave)
        val retrieved = storageManager.getDeviceConfigs()

        assertNotNull(retrieved)
        assertEquals(2, retrieved!!.size)
        // Order should be preserved by Gson's list serialization
        assertEquals(device1, retrieved[0])
        assertEquals(device2, retrieved[1])
        assertEquals(1, retrieved[0].keys.size)
        assertEquals(key1, retrieved[0].keys[0])
        assertEquals(2, retrieved[1].keys.size)
    }

    @Test
    fun getDeviceConfigs_whenNoneSaved_returnsNullOrEmpty() {
        // Behavior depends on implementation: null or emptyList() when key doesn't exist.
        // Current implementation returns null if key not found.
        val retrieved = storageManager.getDeviceConfigs()
        assertNull(retrieved)
        // If it were to return emptyList():
        // assertNotNull(retrieved)
        // assertTrue(retrieved.isEmpty())
    }

    @Test
    fun clearDeviceConfigs_removesData() {
        val device = DeviceConfig("d1", "Test", null, null, null, null, emptyList())
        storageManager.saveDeviceConfigs(listOf(device))
        var retrieved = storageManager.getDeviceConfigs()
        assertNotNull(retrieved)
        assertFalse(retrieved!!.isEmpty())

        storageManager.clearDeviceConfigs()
        retrieved = storageManager.getDeviceConfigs()
        assertNull(retrieved)
    }

    @Test
    fun saveAndGetDeviceConfigs_overwriteExisting() {
        val device1 = DeviceConfig("d1", "Initial Device", "I", "#000", "M0", "ic0", emptyList())
        storageManager.saveDeviceConfigs(listOf(device1))

        val device2 = DeviceConfig("d2", "Updated Device", "U", "#FFF", "M_New", "ic_new",
            listOf(DeviceKeyInfo("new_key", "NEW_TYPE", "new_mac"))
        )
        storageManager.saveDeviceConfigs(listOf(device2)) // Overwrite with new list

        val retrieved = storageManager.getDeviceConfigs()
        assertNotNull(retrieved)
        assertEquals(1, retrieved!!.size)
        assertEquals(device2, retrieved[0])
        assertEquals("Updated Device", retrieved[0].name)
        assertEquals(1, retrieved[0].keys.size)
    }
}
