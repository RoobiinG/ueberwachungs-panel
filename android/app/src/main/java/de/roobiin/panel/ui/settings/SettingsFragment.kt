package de.roobiin.panel.ui.settings

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import de.roobiin.panel.databinding.FragmentSettingsBinding
import de.roobiin.panel.service.MonitoringService
import de.roobiin.panel.ui.login.LoginActivity
import de.roobiin.panel.utils.SessionManager

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val session = SessionManager(requireContext())

        binding.tvUsername.text = session.getUsername() ?: "-"
        binding.tvServerUrl.text = session.getBaseUrl() ?: "-"

        binding.switchMonitoring.isChecked = session.isMonitoringEnabled()
        binding.switchNotifications.isChecked = session.isNotificationsEnabled()

        val intervalOptions = listOf(15, 30, 60, 120, 300)
        val currentInterval = session.getMonitoringInterval()
        val idx = intervalOptions.indexOf(currentInterval).coerceAtLeast(0)
        binding.spinnerInterval.setSelection(idx)

        binding.switchMonitoring.setOnCheckedChangeListener { _, checked ->
            session.setMonitoringEnabled(checked)
            if (checked) {
                requireContext().startForegroundService(
                    Intent(requireContext(), MonitoringService::class.java)
                        .setAction(MonitoringService.ACTION_START)
                )
            } else {
                requireContext().startService(
                    Intent(requireContext(), MonitoringService::class.java)
                        .setAction(MonitoringService.ACTION_STOP)
                )
            }
        }

        binding.switchNotifications.setOnCheckedChangeListener { _, checked ->
            session.setNotificationsEnabled(checked)
        }

        binding.btnSaveInterval.setOnClickListener {
            val selected = intervalOptions[binding.spinnerInterval.selectedItemPosition]
            session.setMonitoringInterval(selected)
        }

        binding.btnLogout.setOnClickListener {
            requireContext().startService(
                Intent(requireContext(), MonitoringService::class.java)
                    .setAction(MonitoringService.ACTION_STOP)
            )
            session.clearSession()
            startActivity(Intent(requireContext(), LoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            })
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
