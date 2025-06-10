// File: app/src/main/java/com/gh182/findmy/fragment/ScannerFragment.kt
// Language: Kotlin
package com.gh182.findmy.fragment

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
// Removed unused WorkInfo, WorkManager imports
import com.gh182.findmy.R
import com.gh182.findmy.adapter.ScanDisplayItem
import com.gh182.findmy.adapter.ScanResultAdapter
import com.gh182.findmy.viewmodel.ScannerViewModel
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

class ScannerFragment : Fragment() {

    companion object {
        const val TAG = "ScannerFragmentNew"
    }

    private lateinit var statusTextView: TextView
    private lateinit var linkButton: Button
    private lateinit var scanSwitch: MaterialSwitch
    private lateinit var forceScanButton: Button
    private lateinit var intervalEditText: TextInputEditText
    private lateinit var intervalLayout: TextInputLayout
    private lateinit var setIntervalButton: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var noResultsTextView: TextView
    private lateinit var recyclerView: RecyclerView
    private lateinit var loadingDevicesProgressBar: ProgressBar


    private lateinit var scanResultAdapter: ScanResultAdapter
    private val viewModel: ScannerViewModel by viewModels()

    private val bluetoothAdapterInstance: BluetoothAdapter? by lazy {
        (requireContext().getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    }

    private val requestBluetoothEnableLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                Log.i(TAG, "Bluetooth enabled by user.")
                if (scanSwitch.isPressed && scanSwitch.isChecked) {
                    Log.d(TAG, "BT enabled, now processing scanSwitch checked state via ViewModel.")
                    viewModel.setPeriodicScanUserEnabled(true)
                } else if (forceScanButton.isPressed) {
                    Log.d(TAG, "BT enabled, now processing forceScanButton click via ViewModel.")
                    viewModel.startForegroundScan()
                }
            } else {
                Log.w(TAG, "User declined to enable Bluetooth.")
                Toast.makeText(context, getString(R.string.scanner_toast_bt_required), Toast.LENGTH_SHORT).show()
                if (scanSwitch.isPressed && scanSwitch.isChecked) {
                    scanSwitch.isChecked = false
                }
            }
        }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        Log.d(TAG, "onCreateView")
        return inflater.inflate(R.layout.fragment_scanner, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.d(TAG, "onViewCreated")
        bindViews(view)
        setupRecyclerView()
        setupListeners()
        observeViewModel()
    }

    private fun bindViews(view: View) {
        statusTextView = view.findViewById(R.id.scanner_fragment_status_text)
        linkButton = view.findViewById(R.id.scanner_fragment_link_button)
        scanSwitch = view.findViewById(R.id.scanner_fragment_scan_switch)
        forceScanButton = view.findViewById(R.id.scanner_fragment_force_scan_button)
        intervalEditText = view.findViewById(R.id.scanner_fragment_interval_edittext)
        intervalLayout = view.findViewById(R.id.scanner_fragment_interval_layout)
        setIntervalButton = view.findViewById(R.id.scanner_fragment_set_interval_button)
        progressBar = view.findViewById(R.id.scanner_fragment_scan_active_progress_bar)
        noResultsTextView = view.findViewById(R.id.scanner_fragment_no_results_text)
        recyclerView = view.findViewById(R.id.scanner_fragment_recycler_view)
        loadingDevicesProgressBar = view.findViewById(R.id.scanner_fragment_loading_devices_progress_bar)
    }

    private fun setupRecyclerView() {
        scanResultAdapter = ScanResultAdapter()
        recyclerView.apply {
            layoutManager = LinearLayoutManager(context)
            adapter = scanResultAdapter
            addItemDecoration(DividerItemDecoration(requireContext(), DividerItemDecoration.VERTICAL))
        }
        Log.d(TAG, "RecyclerView setup complete.")
    }

    private fun setupListeners() {
        linkButton.setOnClickListener {
            if (viewModel.isLinked.value == true) {
                showUnlinkConfirmationDialog()
            } else {
                showCredentialsDialog()
            }
        }

        scanSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (scanSwitch.isPressed) {
                Log.d(TAG, "Background scan switch user interaction: $isChecked")
                if (isChecked) {
                    if (viewModel.isLinked.value != true) {
                        Toast.makeText(context, getString(R.string.scanner_toast_link_first), Toast.LENGTH_SHORT).show()
                        scanSwitch.isChecked = false
                        return@setOnCheckedChangeListener
                    }
                    if (checkAndPromptBluetooth()) {
                        viewModel.setPeriodicScanUserEnabled(true)
                    } else {
                        if (bluetoothAdapterInstance?.isEnabled == false) {
                            scanSwitch.isChecked = false
                        }
                    }
                } else {
                    viewModel.setPeriodicScanUserEnabled(false)
                }
            }
        }


        forceScanButton.setOnClickListener {
            Log.d(TAG, "Force Scan button clicked.")
            if (viewModel.isLinked.value != true) {
                Toast.makeText(context, getString(R.string.scanner_toast_link_first), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (checkAndPromptBluetooth()) {
                viewModel.startForegroundScan()
            } else {
                Toast.makeText(context, getString(R.string.scanner_toast_bt_required_for_scan_now), Toast.LENGTH_LONG).show()
            }
        }


        setIntervalButton.setOnClickListener {
            val intervalStr = intervalEditText.text.toString()
            try {
                val intervalSeconds = intervalStr.toInt()
                viewModel.saveScanInterval(intervalSeconds)
                intervalLayout.error = null
            } catch (e: NumberFormatException) { // Parameter e is logged
                Log.w(TAG, "Invalid interval input: $intervalStr", e)
                intervalLayout.error = getString(R.string.scanner_toast_invalid_interval)
                Toast.makeText(context, getString(R.string.scanner_toast_invalid_interval), Toast.LENGTH_SHORT).show()
            }
        }
        intervalEditText.setOnFocusChangeListener { _, hasFocus ->
            if (!hasFocus && intervalLayout.error != null) {
                intervalLayout.error = null
            }
        }
        Log.d(TAG, "Listeners setup.")
    }

    private fun observeViewModel() {
        viewModel.scanStatus.observe(viewLifecycleOwner) { status ->
            Log.d(TAG, "Observed scanStatus: $status")
            statusTextView.text = status
            updateNoResultsTextAndRecyclerViewVisibility()
        }

        viewModel.isScanning.observe(viewLifecycleOwner) { isScanning ->
            Log.d(TAG, "Observed isScanning (worker active): $isScanning")
            progressBar.visibility = if (isScanning && viewModel.isLoadingInitialDeviceList.value == false) View.VISIBLE else View.GONE
            forceScanButton.isEnabled = !isScanning && (viewModel.isLinked.value == true)
            updateNoResultsTextAndRecyclerViewVisibility()
        }

        viewModel.isPeriodicScanUserEnabled.observe(viewLifecycleOwner) { isEnabled ->
            Log.d(TAG, "Observed isPeriodicScanUserEnabled (user preference): $isEnabled")
            if (!scanSwitch.isPressed) {
                scanSwitch.isChecked = isEnabled && (viewModel.isLinked.value == true)
            }
            scanSwitch.isEnabled = viewModel.isLinked.value == true
        }

        viewModel.scanResults.observe(viewLifecycleOwner) { results ->
            Log.i(TAG, "Observed scanResults (allUserDeviceScanItems): ${results.size} items.")
            scanResultAdapter.submitList(results.toList()) {
                updateNoResultsTextAndRecyclerViewVisibility()
            }
        }

        viewModel.isLinked.observe(viewLifecycleOwner) { isLinked ->
            Log.d(TAG, "Observed isLinked: $isLinked")
            linkButton.text = if (isLinked) getString(R.string.scanner_button_unlink) else getString(R.string.scanner_button_link)

            scanSwitch.isEnabled = isLinked
            forceScanButton.isEnabled = isLinked && (viewModel.isScanning.value == false)
            intervalLayout.isEnabled = isLinked
            intervalEditText.isEnabled = isLinked
            setIntervalButton.isEnabled = isLinked

            if (!isLinked) {
                if (!scanSwitch.isPressed) scanSwitch.isChecked = false
            } else {
                if (!scanSwitch.isPressed) {
                    scanSwitch.isChecked = viewModel.isPeriodicScanUserEnabled.value ?: false
                }
            }
            updateNoResultsTextAndRecyclerViewVisibility()
        }

        viewModel.tokenGenerationResult.observe(viewLifecycleOwner) { result ->
            val (success, message) = result
            Log.d(TAG, "Observed tokenGenerationResult: Success=$success, Msg='$message'")
            message?.let {
                Toast.makeText(context, it, if (success) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
            }
        }

        viewModel.currentScanIntervalSeconds.observe(viewLifecycleOwner) { interval ->
            Log.d(TAG, "Observed currentScanIntervalSeconds: $interval")
            intervalEditText.hint = getString(R.string.scanner_interval_hint, ScannerViewModel.MIN_SCAN_INTERVAL_SECONDS)
            if (intervalEditText.text.toString() != interval.toString()) {
                intervalEditText.setText(interval.toString())
            }
        }

        viewModel.isLoadingInitialDeviceList.observe(viewLifecycleOwner) { isLoading ->
            Log.d(TAG, "Observed isLoadingInitialDeviceList: $isLoading")
            loadingDevicesProgressBar.visibility = if (isLoading) View.VISIBLE else View.GONE
            if (isLoading) {
                recyclerView.visibility = View.GONE
                noResultsTextView.visibility = View.GONE
                progressBar.visibility = View.GONE
            } else {
                updateNoResultsTextAndRecyclerViewVisibility()
            }
        }
        Log.d(TAG, "ViewModel observers setup.")
    }

    private fun updateNoResultsTextAndRecyclerViewVisibility() {
        val results = viewModel.allUserDeviceScanItems.value.orEmpty()
        val isCurrentlyScanning = viewModel.isScanning.value ?: false
        val isLinked = viewModel.isLinked.value ?: false
        val isLoadingInitial = viewModel.isLoadingInitialDeviceList.value ?: false

        if (isLoadingInitial) {
            recyclerView.visibility = View.GONE
            noResultsTextView.visibility = View.GONE
            loadingDevicesProgressBar.visibility = View.VISIBLE
            progressBar.visibility = View.GONE
            return
        }

        loadingDevicesProgressBar.visibility = View.GONE
        progressBar.visibility = if (isCurrentlyScanning) View.VISIBLE else View.GONE


        if (!isLinked) {
            recyclerView.visibility = View.GONE
            noResultsTextView.text = getString(R.string.scanner_info_link_account)
            noResultsTextView.visibility = View.VISIBLE
            return
        }

        if (results.isEmpty()) {
            recyclerView.visibility = View.GONE
            if (isCurrentlyScanning) {
                noResultsTextView.text = getString(R.string.scanner_no_results)
            } else {
                noResultsTextView.text = getString(R.string.scanner_info_no_devices_configured)
            }
            noResultsTextView.visibility = View.VISIBLE
            return
        }

        recyclerView.visibility = View.VISIBLE
        val allNeverSeen = results.all { it.lastSeenTimestampMillis == ScannerViewModel.NEVER_SEEN_TIMESTAMP }

        if (allNeverSeen && !isCurrentlyScanning) {
            noResultsTextView.text = getString(R.string.scanner_info_scan_to_find)
            noResultsTextView.visibility = View.VISIBLE
        } else {
            noResultsTextView.visibility = View.GONE
        }
    }


    private fun showCredentialsDialog() {
        val context = requireContext()
        val builder = AlertDialog.Builder(context)
        builder.setTitle(getString(R.string.scanner_dialog_link_title))

        val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_credentials, null)
        val usernameInput = dialogView.findViewById<TextInputEditText>(R.id.dialog_username_edittext)
        val passwordInput = dialogView.findViewById<TextInputEditText>(R.id.dialog_password_edittext)

        builder.setView(dialogView)
        builder.setPositiveButton(getString(R.string.scanner_button_link_action)) { dialog, _ ->
            val username = usernameInput.text.toString().trim()
            val password = passwordInput.text.toString()
            if (username.isNotEmpty() && password.isNotEmpty()) {
                viewModel.generateApiToken(username, password)
            } else {
                Toast.makeText(context, getString(R.string.scanner_toast_credentials_required), Toast.LENGTH_SHORT).show()
            }
            dialog.dismiss()
        }
        builder.setNegativeButton(getString(R.string.scanner_button_cancel)) { dialog, _ -> dialog.cancel() }
        builder.show()
    }

    private fun showUnlinkConfirmationDialog() {
        AlertDialog.Builder(requireContext())
            .setTitle(getString(R.string.scanner_dialog_unlink_title))
            .setMessage(getString(R.string.scanner_dialog_unlink_message))
            .setPositiveButton(getString(R.string.scanner_button_unlink_action)) { dialog, _ -> viewModel.unlinkAccount(); dialog.dismiss() }
            .setNegativeButton(getString(R.string.scanner_button_cancel), null)
            .show()
    }

    private fun checkAndPromptBluetooth(): Boolean {
        val localBtAdapter = bluetoothAdapterInstance
        if (localBtAdapter == null) {
            Toast.makeText(context, getString(R.string.scanner_toast_bt_unavailable), Toast.LENGTH_LONG).show()
            Log.e(TAG, "Bluetooth adapter is null, hardware likely unavailable.")
            return false
        }
        if (localBtAdapter.isEnabled) {
            Log.d(TAG, "Bluetooth is already enabled.")
            return true
        }

        Log.w(TAG, "Bluetooth is disabled. Prompting user.")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(requireContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(requireContext(), getString(R.string.scanner_toast_bt_connect_perm_needed_detail), Toast.LENGTH_LONG).show()
                Log.e(TAG, "BLUETOOTH_CONNECT permission missing for enabling BT. Should be granted by MainActivity.")
                return false
            }
        }

        val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
        try {
            requestBluetoothEnableLauncher.launch(enableBtIntent)
            Log.d(TAG, "Bluetooth enable intent launched. Waiting for user response.")
            return false
        } catch (se: SecurityException) {
            Log.e(TAG, "SecurityException trying to launch Bluetooth enable intent (BLUETOOTH_CONNECT missing?)", se)
            Toast.makeText(requireContext(), getString(R.string.scanner_toast_bt_permission_issue), Toast.LENGTH_LONG).show()
            return false
        } catch (e: Exception) {
            Log.e(TAG, "Exception trying to launch Bluetooth enable intent", e)
            Toast.makeText(requireContext(), getString(R.string.scanner_toast_bt_request_failed), Toast.LENGTH_LONG).show()
            return false
        }
    }


    override fun onResume() {
        super.onResume()
        Log.d(TAG, "onResume.")
        viewModel.checkInitialStates()
        viewModel.currentScanIntervalSeconds.value?.let {
            intervalEditText.hint = getString(R.string.scanner_interval_hint, ScannerViewModel.MIN_SCAN_INTERVAL_SECONDS)
        }
    }
}