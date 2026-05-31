package de.roobiin.panel.ui.settings

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.google.android.material.snackbar.Snackbar
import de.roobiin.panel.databinding.FragmentSettingsBinding
import de.roobiin.panel.service.MonitoringService
import de.roobiin.panel.ui.lock.PinSetupDialog
import de.roobiin.panel.ui.login.LoginActivity
import de.roobiin.panel.utils.AppLockManager
import de.roobiin.panel.utils.SessionManager

class SettingsFragment : Fragment(), PinSetupDialog.Listener {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!
    private var pinSetupForEnable = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val session = SessionManager(requireContext())

        // ─── Konto ───────────────────────────────────────────────────────────────
        binding.tvUsername.text = session.getUsername() ?: "-"
        binding.tvServerUrl.text = session.getBaseUrl() ?: "-"

        // ─── Monitoring ──────────────────────────────────────────────────────────
        binding.switchMonitoring.isChecked = session.isMonitoringEnabled()
        binding.switchNotifications.isChecked = session.isNotificationsEnabled()

        val intervalOptions = listOf(15, 30, 60, 120, 300)
        binding.spinnerInterval.setSelection(
            intervalOptions.indexOf(session.getMonitoringInterval()).coerceAtLeast(0)
        )

        binding.switchMonitoring.setOnCheckedChangeListener { _, checked ->
            session.setMonitoringEnabled(checked)
            val svcIntent = Intent(requireContext(), MonitoringService::class.java)
            if (checked) {
                requireContext().startForegroundService(svcIntent.setAction(MonitoringService.ACTION_START))
            } else {
                requireContext().startService(svcIntent.setAction(MonitoringService.ACTION_STOP))
            }
        }

        binding.switchNotifications.setOnCheckedChangeListener { _, checked ->
            session.setNotificationsEnabled(checked)
        }

        binding.btnSaveInterval.setOnClickListener {
            val selected = intervalOptions[binding.spinnerInterval.selectedItemPosition]
            session.setMonitoringInterval(selected)
            Snackbar.make(binding.root, "Intervall gespeichert", Snackbar.LENGTH_SHORT).show()
        }

        // ─── App-Sperre ──────────────────────────────────────────────────────────
        binding.switchAppLock.isChecked = session.isAppLockEnabled()

        val timeoutOptions = listOf(0, 15, 30, 60, 300)
        binding.spinnerLockTimeout.setSelection(
            timeoutOptions.indexOf(session.getLockTimeoutSeconds()).coerceAtLeast(0)
        )
        updateLockUi(session.isAppLockEnabled())

        binding.switchAppLock.setOnCheckedChangeListener { _, checked ->
            if (checked) {
                if (session.getPinHash() == null) {
                    pinSetupForEnable = true
                    PinSetupDialog.newInstance().show(childFragmentManager, PinSetupDialog.TAG)
                } else {
                    session.setAppLockEnabled(true)
                    AppLockManager.lockTimeoutMs = session.getLockTimeoutSeconds() * 1000L
                    updateLockUi(true)
                }
            } else {
                session.setAppLockEnabled(false)
                AppLockManager.unlock()
                updateLockUi(false)
            }
        }

        binding.btnChangePin.setOnClickListener {
            pinSetupForEnable = false
            PinSetupDialog.newInstance().show(childFragmentManager, PinSetupDialog.TAG)
        }

        binding.btnSaveLockTimeout.setOnClickListener {
            val selected = timeoutOptions[binding.spinnerLockTimeout.selectedItemPosition]
            session.setLockTimeoutSeconds(selected)
            AppLockManager.lockTimeoutMs = selected * 1000L
            Snackbar.make(binding.root, "Timeout gespeichert", Snackbar.LENGTH_SHORT).show()
        }

        // ─── Abmelden ────────────────────────────────────────────────────────────
        binding.btnLogout.setOnClickListener {
            requireContext().startService(
                Intent(requireContext(), MonitoringService::class.java)
                    .setAction(MonitoringService.ACTION_STOP)
            )
            SessionManager(requireContext()).clearSession()
            AppLockManager.lock()
            startActivity(Intent(requireContext(), LoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            })
        }
    }

    // ─── PinSetupDialog.Listener ─────────────────────────────────────────────────

    override fun onPinSet(hash: String) {
        val session = SessionManager(requireContext())
        session.setPinHash(hash)
        if (pinSetupForEnable) {
            session.setAppLockEnabled(true)
            AppLockManager.lock()
        }
        updateLockUi(session.isAppLockEnabled())
        Snackbar.make(binding.root, "PIN gespeichert", Snackbar.LENGTH_SHORT).show()
    }

    override fun onPinCancelled() {
        if (pinSetupForEnable) {
            binding.switchAppLock.isChecked = false
        }
    }

    private fun updateLockUi(enabled: Boolean) {
        binding.lockOptionsGroup.visibility = if (enabled) View.VISIBLE else View.GONE
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
