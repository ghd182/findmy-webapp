// File: app/src/main/java/com/gh182/findmy/viewmodel/ScannerViewModel.kt
// Language: Kotlin
package com.gh182.findmy.viewmodel

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import androidx.work.*
import kotlinx.coroutines.launch
import android.util.Log
import com.gh182.findmy.R
import com.gh182.findmy.adapter.ScanDisplayItem
import com.gh182.findmy.network.RetrofitClient
import com.gh182.findmy.repository.ScannerRepository
import com.gh182.findmy.scanner.BleScanWorker
import com.gh182.findmy.scanner.KeyManager
import com.gh182.findmy.scanner.TokenStorage
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.max
import com.dd.plist.NSDictionary
import com.dd.plist.PropertyListParser

class ScannerViewModel(application: Application) : AndroidViewModel(application) {

    companion object {
        const val TAG = "ScannerViewModelNew"
        const val SCAN_WORK_TAG = "FindMyPeriodicScanWorkNew"
        const val ONE_TIME_SCAN_UNIQUE_WORK_NAME = "FindMyOneTimeScanWork"
        private const val SCANNER_PREFS_NAME = "FindMyScannerPrefs"
        private const val PREF_KEY_SCAN_INTERVAL_SECONDS = "scanIntervalSeconds"
        private const val PREF_KEY_PERIODIC_SCAN_USER_ENABLED = "periodicScanUserEnabled"
        private const val PREF_KEY_CACHED_DEVICE_LIST_JSON = "cachedDeviceListJson"
        const val DEFAULT_SCAN_INTERVAL_SECONDS = 15 * 60
        const val MIN_SCAN_INTERVAL_SECONDS = 15 * 60
        const val NEVER_SEEN_TIMESTAMP = 0L
    }

    private val workManager = WorkManager.getInstance(application)
    private val repository: ScannerRepository by lazy { ScannerRepository(RetrofitClient.instance) }
    private val keyManagerUtil = KeyManager()

    private val sharedPreferences: SharedPreferences =
        application.getSharedPreferences(SCANNER_PREFS_NAME, Context.MODE_PRIVATE)

    private val _scanStatus = MutableLiveData<String>("Initializing...")
    val scanStatus: LiveData<String> = _scanStatus

    private val _isScanning = MutableLiveData<Boolean>(false)
    val isScanning: LiveData<Boolean> = _isScanning

    private val _allUserDeviceScanItems = MutableLiveData<List<ScanDisplayItem>>(emptyList())
    val allUserDeviceScanItems: LiveData<List<ScanDisplayItem>> = _allUserDeviceScanItems
    val scanResults: LiveData<List<ScanDisplayItem>> get() = _allUserDeviceScanItems

    private val _isLinked = MutableLiveData<Boolean>(false)
    val isLinked: LiveData<Boolean> = _isLinked

    private val _tokenGenerationResult = MutableLiveData<Pair<Boolean, String?>>()
    val tokenGenerationResult: LiveData<Pair<Boolean, String?>> = _tokenGenerationResult

    private val _currentScanIntervalSeconds = MutableLiveData<Int>()
    val currentScanIntervalSeconds: LiveData<Int> = _currentScanIntervalSeconds

    private val _isLoadingInitialDeviceList = MutableLiveData<Boolean>(false)
    val isLoadingInitialDeviceList: LiveData<Boolean> = _isLoadingInitialDeviceList

    private val _isPeriodicScanUserEnabled = MutableLiveData<Boolean>(false)
    val isPeriodicScanUserEnabled: LiveData<Boolean> = _isPeriodicScanUserEnabled

    init {
        Log.d(TAG, "ViewModel initialized.")
        _currentScanIntervalSeconds.value = sharedPreferences.getInt(
            PREF_KEY_SCAN_INTERVAL_SECONDS,
            DEFAULT_SCAN_INTERVAL_SECONDS
        )
        _isPeriodicScanUserEnabled.value = sharedPreferences.getBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)

        viewModelScope.launch {
            loadCachedDeviceList()
            checkInitialStatesInternal()
        }
        observeWorkManager()
    }

    private suspend fun loadCachedDeviceList() {
        withContext(Dispatchers.IO) {
            try {
                val cachedJson = sharedPreferences.getString(PREF_KEY_CACHED_DEVICE_LIST_JSON, null)
                if (cachedJson != null) {
                    val gson = Gson()
                    val typeToken = object : TypeToken<List<ScanDisplayItem>>() {}.type
                    val cachedList: List<ScanDisplayItem> = gson.fromJson(cachedJson, typeToken)
                    if (cachedList.isNotEmpty()) {
                        Log.i(TAG, "Loaded ${cachedList.size} devices from cache.")
                        _allUserDeviceScanItems.postValue(cachedList.sortedBy { it.displayName })
                    } else {
                        Log.i(TAG, "Cached device list was empty.")
                    }
                } else {
                    Log.i(TAG, "No cached device list found.")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading cached device list", e)
            }
        }
    }

    private suspend fun saveDeviceListToCache(deviceList: List<ScanDisplayItem>) {
        withContext(Dispatchers.IO) {
            try {
                val gson = Gson()
                val jsonToCache = gson.toJson(deviceList)
                sharedPreferences.edit {
                    putString(PREF_KEY_CACHED_DEVICE_LIST_JSON, jsonToCache)
                }
                Log.i(TAG, "Saved ${deviceList.size} devices to cache.")
            } catch (e: Exception) {
                Log.e(TAG, "Error saving device list to cache", e)
            }
        }
    }

    private suspend fun checkInitialStatesInternal() {
        val token = TokenStorage.getToken()
        val currentlyLinked = token != null

        if (_isLinked.value != currentlyLinked) {
            _isLinked.postValue(currentlyLinked)
        }
        Log.i(TAG, "checkInitialStatesInternal: Account is ${if (currentlyLinked) "LINKED" else "NOT LINKED"}. _isLinked.value is now: ${_isLinked.value}")

        val userWantsPeriodicScan = sharedPreferences.getBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)
        if (_isPeriodicScanUserEnabled.value != userWantsPeriodicScan) {
            _isPeriodicScanUserEnabled.postValue(userWantsPeriodicScan)
        }

        if (currentlyLinked) {
            fetchScannerConfigAndInitializeDeviceList()
            if (userWantsPeriodicScan) {
                enableBackgroundScanInternal(true, source="checkInitialStates")
            } else {
                enableBackgroundScanInternal(false, source="checkInitialStates_UserPrefOff")
            }
        } else {
            _allUserDeviceScanItems.postValue(emptyList())
            _isLoadingInitialDeviceList.postValue(false)
            if (sharedPreferences.contains(PREF_KEY_CACHED_DEVICE_LIST_JSON)) {
                sharedPreferences.edit { remove(PREF_KEY_CACHED_DEVICE_LIST_JSON) }
                Log.i(TAG, "Cleared device list cache as user is not linked.")
            }
            enableBackgroundScanInternal(false, source="checkInitialStates_NotLinked")
        }
        updateScanStatusBasedOnWorker()
    }

    fun checkInitialStates() {
        viewModelScope.launch {
            if (_allUserDeviceScanItems.value.isNullOrEmpty()) {
                loadCachedDeviceList()
            }
            checkInitialStatesInternal()
        }
    }

    private suspend fun fetchScannerConfigAndInitializeDeviceList() {
        if (_isLinked.value != true) {
            Log.w(TAG, "fetchScannerConfigAndInitializeDeviceList: Precondition failed - user is not linked. Bailing out.")
            _allUserDeviceScanItems.postValue(emptyList())
            _isLoadingInitialDeviceList.postValue(false)
            if (_scanStatus.value != getApplication<Application>().getString(R.string.scanner_info_link_account_status)) {
                _scanStatus.postValue(getApplication<Application>().getString(R.string.scanner_info_link_account_status))
            }
            return
        }

        _isLoadingInitialDeviceList.postValue(true)
        if (_isScanning.value != true) {
            _scanStatus.postValue(getApplication<Application>().getString(R.string.scanner_status_loading_devices))
        }
        Log.i(TAG, "Fetching device configuration to initialize/refresh device list...")

        val config = withContext(Dispatchers.IO) {
            repository.fetchScannerConfig()
        }

        if (config?.device_files != null) {
            Log.i(TAG, "Fetched config with ${config.device_files.size} devices.")
            val currentMasterList = _allUserDeviceScanItems.value.orEmpty().associateBy { it.id }.toMutableMap()
            val foundInConfig = mutableSetOf<String>()

            config.device_files.forEach { fileInfo ->
                foundInConfig.add(fileInfo.device_id)
                var name = fileInfo.device_id
                var iconLabel = name.take(2).uppercase(Locale.getDefault())
                var iconColorHex = generateDefaultColorForId(fileInfo.device_id)

                if (fileInfo.type.equals("plist", ignoreCase = true)) {
                    try {
                        fileInfo.getDecodedContent()?.let { content ->
                            val plistRoot = PropertyListParser.parse(content) as? NSDictionary
                            plistRoot?.objectForKey("name")?.toString()?.let { parsedName ->
                                name = parsedName
                                iconLabel = parsedName.take(2).uppercase(Locale.getDefault())
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Error parsing plist for ${fileInfo.device_id} (name/icon): ${e.message}")
                    }
                }

                val existingItem = currentMasterList[fileInfo.device_id]
                if (existingItem != null) {
                    currentMasterList[fileInfo.device_id] = existingItem.copy(
                        displayName = name,
                        iconLabel = iconLabel,
                        iconColorHex = iconColorHex,
                        keyType = fileInfo.type.uppercase(Locale.getDefault())
                    )
                } else {
                    currentMasterList[fileInfo.device_id] = ScanDisplayItem(
                        id = fileInfo.device_id,
                        displayName = name,
                        rssi = null,
                        batteryStatus = "N/A",
                        keyType = fileInfo.type.uppercase(Locale.getDefault()),
                        lastSeenTimestampMillis = NEVER_SEEN_TIMESTAMP,
                        rawStatusByte = 0,
                        isMatched = false,
                        iconLabel = iconLabel,
                        iconColorHex = iconColorHex
                    )
                }
            }

            val toRemove = currentMasterList.keys.filterNot { it in foundInConfig }
            toRemove.forEach { currentMasterList.remove(it) }
            if (toRemove.isNotEmpty()) Log.i(TAG, "Removed ${toRemove.size} devices no longer in config.")

            val sortedMasterList = currentMasterList.values.toList().sortedBy { it.displayName }
            _allUserDeviceScanItems.postValue(sortedMasterList)
            saveDeviceListToCache(sortedMasterList)
            if (_isScanning.value != true) {
                _scanStatus.postValue(getLinkedStatusText(sortedMasterList.isNotEmpty()))
            }
            Log.i(TAG, "Initialized/Refreshed master device list with ${sortedMasterList.size} devices.")
        } else {
            Log.e(TAG, "Failed to fetch or parse scanner config. Device list not initialized/refreshed.")
            if (_allUserDeviceScanItems.value.isNullOrEmpty()) {
                _allUserDeviceScanItems.postValue(emptyList())
            }
            if (_isScanning.value != true) {
                _scanStatus.postValue("Error: Could not load device configuration.")
            }
        }
        _isLoadingInitialDeviceList.postValue(false)
    }

    private fun generateDefaultColorForId(idStr: String): String {
        if (idStr.isEmpty()) return "#B0BEC5"
        var hash = 0
        for (char in idStr) {
            hash = char.code + ((hash shl 5) - hash)
            hash = hash and hash
        }
        hash = kotlin.math.abs(hash)
        val r = (hash and 0xFF0000 shr 16)
        val g = (hash and 0x00FF00 shr 8)
        val b = hash and 0x0000FF
        val lightR = (r + 0xCF) / 2
        val lightG = (g + 0xCF) / 2
        val lightB = (b + 0xCF) / 2
        return String.format("#%02x%02x%02x", lightR and 0xFF, lightG and 0xFF, lightB and 0xFF)
    }


    private fun observeWorkManager() {
        workManager.getWorkInfosByTagLiveData(SCAN_WORK_TAG).observeForever { workInfos ->
            handleWorkInfoUpdate(workInfos, "Periodic")
        }
        workManager.getWorkInfosForUniqueWorkLiveData(ONE_TIME_SCAN_UNIQUE_WORK_NAME).observeForever { workInfos ->
            handleWorkInfoUpdate(workInfos, "OneTime")
        }
    }

    private fun handleWorkInfoUpdate(workInfos: List<WorkInfo>, workType: String) {
        Log.d(TAG, "WorkManager LiveData changed for $workType. ${workInfos.size} workInfos.")

        // Removed unused runningWork, enqueuedWork

        val anyWorkerRunning = workManager.getWorkInfosByTag(SCAN_WORK_TAG).get().any { it.state == WorkInfo.State.RUNNING } ||
                workManager.getWorkInfosForUniqueWork(ONE_TIME_SCAN_UNIQUE_WORK_NAME).get().any { it.state == WorkInfo.State.RUNNING }

        if (_isScanning.value != anyWorkerRunning) {
            _isScanning.postValue(anyWorkerRunning)
        }

        val userWantsPeriodicScan = sharedPreferences.getBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)
        if (_isPeriodicScanUserEnabled.value != userWantsPeriodicScan) {
            _isPeriodicScanUserEnabled.postValue(userWantsPeriodicScan)
        }

        if (_isLoadingInitialDeviceList.value == false) {
            if (anyWorkerRunning) {
                _scanStatus.postValue("Scan: Active...")
            } else {
                val periodicWorkEnqueued = workManager.getWorkInfosByTag(SCAN_WORK_TAG).get()
                    .any { it.state == WorkInfo.State.ENQUEUED }

                if (periodicWorkEnqueued && userWantsPeriodicScan && _isLinked.value == true) {
                    val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                    _scanStatus.postValue("Scan: Queued (Next run approx. ${intervalDisplay} min)")
                } else {
                    val latestFinishedWork = workInfos.filter { it.state.isFinished }
                        .maxByOrNull { it.outputData.getLong(BleScanWorker.OUTPUT_TIMESTAMP_KEY, 0L) }

                    if (latestFinishedWork != null) {
                        handleFinishedWorker(latestFinishedWork)
                        if (userWantsPeriodicScan && _isLinked.value == true && !periodicWorkEnqueued && !anyWorkerRunning) {
                            val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                            _scanStatus.postValue("Scan: Ready (Next run approx. ${intervalDisplay} min)")
                        }
                    } else {
                        if (userWantsPeriodicScan && _isLinked.value == true && !periodicWorkEnqueued ) {
                            val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                            _scanStatus.postValue("Scan: Ready (Next run approx. ${intervalDisplay} min)")
                        }
                        else if (_isLinked.value == true) {
                            _scanStatus.postValue(getLinkedStatusText(_allUserDeviceScanItems.value?.isNotEmpty() == true))
                        } else {
                            _scanStatus.postValue(getApplication<Application>().getString(R.string.scanner_info_link_account_status))
                        }
                    }
                }
            }
        }
    }

    private fun updateScanStatusBasedOnWorker() {
        viewModelScope.launch(Dispatchers.IO) {
            val periodicWorkInfos = workManager.getWorkInfosByTag(SCAN_WORK_TAG).get()
            val oneTimeWorkInfos = workManager.getWorkInfosForUniqueWork(ONE_TIME_SCAN_UNIQUE_WORK_NAME).get()

            val isAnyRunning = periodicWorkInfos.any { it.state == WorkInfo.State.RUNNING } ||
                    oneTimeWorkInfos.any { it.state == WorkInfo.State.RUNNING }
            val isPeriodicEnqueued = periodicWorkInfos.any { it.state == WorkInfo.State.ENQUEUED }
            val userWantsPeriodicScan = sharedPreferences.getBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)

            withContext(Dispatchers.Main) {
                if (_isLoadingInitialDeviceList.value == false && !isAnyRunning) { // Simplified: used to be !anyWorkerRunning which is isAnyRunning
                    val currentStatus = _scanStatus.value
                    val nonTerminalStatus = currentStatus == null ||
                            !(currentStatus.startsWith("Scan Finished:") ||
                                    currentStatus.startsWith("Scan Failed:") ||
                                    currentStatus.startsWith("Scan Cancelled:") ||
                                    currentStatus.startsWith("Error:") ||
                                    currentStatus.startsWith("Scan: Active"))

                    if (nonTerminalStatus) {
                        if (isPeriodicEnqueued && userWantsPeriodicScan && _isLinked.value == true) {
                            val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                            _scanStatus.value = "Scan: Queued (Next run approx. ${intervalDisplay} min)"
                        } else if (userWantsPeriodicScan && _isLinked.value == true) {
                            val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                            _scanStatus.value = "Scan: Ready (Next run approx. ${intervalDisplay} min)"
                        }
                        else {
                            _scanStatus.value = getLinkedStatusText(_allUserDeviceScanItems.value?.isNotEmpty() == true)
                        }
                    }
                } else if (_isLoadingInitialDeviceList.value == false && isAnyRunning) {
                    _scanStatus.value = "Scan: Active..."
                }
            }
        }
    }

    private fun handleFinishedWorker(workInfo: WorkInfo) {
        Log.d(TAG, "Handling finished worker: ${workInfo.id}, State: ${workInfo.state}")
        val statusToPost: String
        when (workInfo.state) {
            WorkInfo.State.SUCCEEDED -> {
                val jsonOutput = workInfo.outputData.getString(BleScanWorker.OUTPUT_FOUND_DEVICES_KEY)
                processWorkerOutput(jsonOutput ?: "[]")
                return
            }
            WorkInfo.State.FAILED -> {
                val reason = workInfo.outputData.getString(BleScanWorker.FAILURE_REASON_KEY) ?: "Unknown reason"
                Log.e(TAG, "Worker FAILED: $reason")
                statusToPost = "Scan Failed: $reason"
            }
            WorkInfo.State.CANCELLED -> {
                Log.w(TAG, "Worker CANCELLED.")
                statusToPost = "Scan Cancelled."
            }
            else -> return
        }
        if (_isScanning.value == false) {
            _scanStatus.postValue(statusToPost)
        }
    }

    private fun getLinkedStatusText(hasDevicesConfigured: Boolean): String {
        val app = getApplication<Application>()
        return when {
            _isLinked.value != true -> app.getString(R.string.scanner_info_link_account_status)
            !hasDevicesConfigured && _isLoadingInitialDeviceList.value == false -> app.getString(R.string.scanner_info_no_devices_configured_status)
            else -> {
                val userWantsPeriodicScan = sharedPreferences.getBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)
                val periodicWorkEnqueued = try {
                    workManager.getWorkInfosByTag(SCAN_WORK_TAG).get()
                        .any { it.state == WorkInfo.State.ENQUEUED }
                } catch (e: Exception) { false }


                if (userWantsPeriodicScan && periodicWorkEnqueued) {
                    val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                    "Scan: Queued (Next run approx. ${intervalDisplay} min)"
                } else if (userWantsPeriodicScan) {
                    val intervalDisplay = (_currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS) / 60
                    "Scan: Ready (Next run approx. ${intervalDisplay} min)"
                }
                else {
                    app.getString(R.string.scanner_status_linked_ready)
                }
            }
        }
    }

    private fun processWorkerOutput(jsonOutput: String) {
        viewModelScope.launch(Dispatchers.Default) {
            try {
                val gson = Gson()
                val typeToken = object : TypeToken<List<BleScanWorker.FoundDeviceData>>() {}.type
                val workerDataList: List<BleScanWorker.FoundDeviceData> = gson.fromJson(jsonOutput, typeToken)

                Log.i(TAG, "Parsed ${workerDataList.size} devices from worker JSON.")

                val currentMasterList = _allUserDeviceScanItems.value.orEmpty().toMutableList()
                var itemsUpdatedCount = 0
                var newItemsAddedToDisplay = false


                if (currentMasterList.isEmpty() && _isLinked.value == true && workerDataList.isNotEmpty()) {
                    Log.w(TAG, "Master list is empty but worker found devices. Attempting to re-fetch config to populate names and types.")
                    withContext(Dispatchers.Main) {
                        _isLoadingInitialDeviceList.value = true
                    }
                    fetchScannerConfigAndInitializeDeviceList()
                    delay(200)
                    val updatedMasterListFromFetch = _allUserDeviceScanItems.value.orEmpty()
                    currentMasterList.clear()
                    currentMasterList.addAll(updatedMasterListFromFetch)
                    withContext(Dispatchers.Main) {
                        _isLoadingInitialDeviceList.value = false
                    }
                }


                workerDataList.forEach { workerDevice ->
                    val index = currentMasterList.indexOfFirst { it.id == workerDevice.matchedDeviceId }
                    if (index != -1) {
                        val existingItem = currentMasterList[index]
                        currentMasterList[index] = existingItem.copy(
                            rssi = workerDevice.rssi,
                            batteryStatus = keyManagerUtil.parseBatteryStatus(workerDevice.rawStatusByte),
                            keyType = workerDevice.matchedKeyType.ifEmpty { existingItem.keyType },
                            lastSeenTimestampMillis = workerDevice.timestampMillis,
                            rawStatusByte = workerDevice.rawStatusByte,
                            isMatched = true
                        )
                        itemsUpdatedCount++
                    } else {
                        Log.w(TAG, "Device ${workerDevice.matchedDeviceId} from worker not in master list. Adding as temporary display item.")
                        currentMasterList.add(
                            ScanDisplayItem(
                                id = workerDevice.matchedDeviceId,
                                displayName = workerDevice.matchedDeviceName.ifEmpty { workerDevice.matchedDeviceId },
                                rssi = workerDevice.rssi,
                                batteryStatus = keyManagerUtil.parseBatteryStatus(workerDevice.rawStatusByte),
                                keyType = workerDevice.matchedKeyType.ifEmpty { "UNKNOWN" },
                                lastSeenTimestampMillis = workerDevice.timestampMillis,
                                rawStatusByte = workerDevice.rawStatusByte,
                                isMatched = true,
                                iconLabel = workerDevice.matchedDeviceName.take(2).uppercase(Locale.getDefault()),
                                iconColorHex = generateDefaultColorForId(workerDevice.matchedDeviceId)
                            )
                        )
                        itemsUpdatedCount++
                        newItemsAddedToDisplay = true
                    }
                }

                val sortedList = currentMasterList.sortedWith(
                    compareByDescending<ScanDisplayItem> { it.lastSeenTimestampMillis != NEVER_SEEN_TIMESTAMP }
                        .thenByDescending { it.lastSeenTimestampMillis }
                        .thenBy { it.displayName }
                )

                withContext(Dispatchers.Main) {
                    _allUserDeviceScanItems.value = sortedList
                    if (_isScanning.value == false) {
                        _scanStatus.value = "Scan Finished: ${workerDataList.size} detected, $itemsUpdatedCount updated."
                    }
                }
                saveDeviceListToCache(sortedList)
                Log.i(TAG, "Updated LiveData with ${sortedList.size} total items after merging worker output.")

            } catch (e: Exception) {
                Log.e(TAG, "Error processing worker output JSON", e)
                withContext(Dispatchers.Main) {
                    if (_isScanning.value == false) _scanStatus.value = "Scan Finished: Error processing results."
                }
            }
        }
    }

    fun setPeriodicScanUserEnabled(enabled: Boolean) {
        viewModelScope.launch {
            Log.d(TAG, "User wants periodic scan: $enabled")
            sharedPreferences.edit {
                putBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, enabled)
            }
            _isPeriodicScanUserEnabled.postValue(enabled)

            if (enabled) {
                if (_isLinked.value == true) {
                    enableBackgroundScanInternal(true, source = "userToggle")
                } else {
                    _tokenGenerationResult.postValue(Pair(false, "Link account to enable background scanning."))
                    sharedPreferences.edit { putBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false) }
                    _isPeriodicScanUserEnabled.postValue(false)
                }
            } else {
                enableBackgroundScanInternal(false, source = "userToggle")
            }
        }
    }

    private fun enableBackgroundScanInternal(enable: Boolean, source: String) {
        if (enable) {
            if (_isLinked.value != true) {
                Log.w(TAG, "enableBackgroundScanInternal($source): Cannot enable, user not linked.")
                return
            }
            Log.i(TAG, "Enabling periodic background scan worker (Source: $source).")
            val intervalSeconds = _currentScanIntervalSeconds.value ?: DEFAULT_SCAN_INTERVAL_SECONDS
            val repeatInterval = max(intervalSeconds.toLong(), PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS / 1000)

            val scanWorkData = Data.Builder()
                .putLong(BleScanWorker.INPUT_SCAN_DURATION_SECONDS_KEY, 30L)
                .build()

            val scanWorkRequest = PeriodicWorkRequestBuilder<BleScanWorker>(repeatInterval, TimeUnit.SECONDS)
                .addTag(SCAN_WORK_TAG)
                .setInputData(scanWorkData)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
                .build()

            workManager.enqueueUniquePeriodicWork(SCAN_WORK_TAG, ExistingPeriodicWorkPolicy.KEEP, scanWorkRequest)
            Log.i(TAG, "Enqueued/Kept periodic scan work (Source: $source). Tag: $SCAN_WORK_TAG, Interval: $repeatInterval s")
        } else {
            Log.i(TAG, "Disabling periodic background scan worker (Source: $source). Cancelling by TAG: $SCAN_WORK_TAG")
            workManager.cancelUniqueWork(SCAN_WORK_TAG)
        }
    }

    fun startForegroundScan() {
        Log.i(TAG, "Attempting to start foreground (one-time) scan.")
        if (_isLinked.value != true) {
            _tokenGenerationResult.postValue(Pair(false, "Link account to start scanning."))
            return
        }
        if (_isScanning.value == true) {
            _scanStatus.postValue("Scan already in progress...")
            return
        }

        _scanStatus.postValue("Starting immediate scan...")
        _isScanning.postValue(true)


        val scanWorkData = Data.Builder()
            .putLong(BleScanWorker.INPUT_SCAN_DURATION_SECONDS_KEY, 30L)
            .build()

        val scanWorkRequest = OneTimeWorkRequestBuilder<BleScanWorker>()
            .setInputData(scanWorkData)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.LINEAR, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .build()

        workManager.enqueueUniqueWork(ONE_TIME_SCAN_UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, scanWorkRequest)
        Log.i(TAG, "Enqueued one-time scan work with REPLACE policy. Unique Name: $ONE_TIME_SCAN_UNIQUE_WORK_NAME")
    }

    fun generateApiToken(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            _tokenGenerationResult.postValue(Pair(false, "Username and password required."))
            return
        }
        _tokenGenerationResult.postValue(Pair(true, "Linking account..."))
        viewModelScope.launch {
            val response = withContext(Dispatchers.IO) {
                repository.generateApiToken(ScannerRepository.GenerateTokenRequest(username, password))
            }
            if (response?.token != null) {
                TokenStorage.saveToken(response.token)
                _isLinked.value = true
                _tokenGenerationResult.value = Pair(true, response.message ?: "Account linked successfully!")
                val userWantsPeriodicScan = sharedPreferences.getBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)
                if (userWantsPeriodicScan) {
                    enableBackgroundScanInternal(true, source="postLink")
                }
                fetchScannerConfigAndInitializeDeviceList()
            } else {
                TokenStorage.clearToken()
                _isLinked.value = false
                _allUserDeviceScanItems.value = emptyList()
                sharedPreferences.edit { remove(PREF_KEY_CACHED_DEVICE_LIST_JSON) }
                _tokenGenerationResult.value = Pair(false, response?.message ?: "Link failed. Check credentials or server error.")
                updateScanStatusBasedOnWorker()
            }
        }
    }

    fun unlinkAccount() {
        Log.i(TAG, "Unlinking account.")
        enableBackgroundScanInternal(false, source="unlink")
        TokenStorage.clearToken()
        sharedPreferences.edit {
            putBoolean(PREF_KEY_PERIODIC_SCAN_USER_ENABLED, false)
            remove(PREF_KEY_CACHED_DEVICE_LIST_JSON)
        }
        _isPeriodicScanUserEnabled.postValue(false)
        _isLinked.postValue(false)
        _allUserDeviceScanItems.postValue(emptyList())
        _isLoadingInitialDeviceList.postValue(false)
        _tokenGenerationResult.postValue(Pair(true, "Account unlinked."))
        _scanStatus.postValue(getLinkedStatusText(false))
    }

    fun saveScanInterval(seconds: Int) {
        val minWorkManagerInterval = PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS / 1000
        val actualSeconds = if (seconds == 0) 0 else max(seconds.toLong(), minWorkManagerInterval).toInt()

        if (seconds < minWorkManagerInterval && seconds != 0) {
            _tokenGenerationResult.postValue(Pair(false, "Minimum interval is $minWorkManagerInterval s due to system limits."))
        }

        sharedPreferences.edit {
            putInt(PREF_KEY_SCAN_INTERVAL_SECONDS, actualSeconds)
        }
        _currentScanIntervalSeconds.postValue(actualSeconds)
        _tokenGenerationResult.postValue(Pair(true, "Scan interval set to $actualSeconds s."))
        Log.i(TAG, "Scan interval saved: $actualSeconds s.")

        viewModelScope.launch {
            val userWantsPeriodicScan = _isPeriodicScanUserEnabled.value ?: false
            if (userWantsPeriodicScan && _isLinked.value == true) {
                val workInfos = withContext(Dispatchers.IO) {
                    workManager.getWorkInfosForUniqueWork(SCAN_WORK_TAG).get()
                }
                val isPeriodicWorkActiveOrEnqueued = workInfos.any {
                    it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING
                }

                if (isPeriodicWorkActiveOrEnqueued) {
                    Log.i(TAG, "Scan interval changed. Restarting periodic scan worker ($SCAN_WORK_TAG) with new interval.")
                    enableBackgroundScanInternal(false, source="intervalChange")
                    delay(1500)
                    enableBackgroundScanInternal(true, source="intervalChange")
                } else {
                    Log.d(TAG, "Scan interval changed, but no active periodic work was found for $SCAN_WORK_TAG to restart.")
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        Log.d(TAG, "ScannerViewModel cleared.")
    }
}