package de.roobiin.panel.ui.dashboard

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import de.roobiin.panel.R
import de.roobiin.panel.databinding.FragmentDashboardBinding
import de.roobiin.panel.viewmodel.DashboardViewModel

class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!
    private val vm: DashboardViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupObservers()
        binding.swipeRefresh.setOnRefreshListener { vm.load() }
        vm.load()
    }

    private fun setupObservers() {
        vm.loading.observe(viewLifecycleOwner) { loading ->
            binding.swipeRefresh.isRefreshing = loading
        }

        vm.error.observe(viewLifecycleOwner) { err ->
            if (err != null) {
                binding.tvError.text = err
                binding.tvError.visibility = View.VISIBLE
                binding.tvError.postDelayed({ binding.tvError.visibility = View.GONE }, 5000)
            } else {
                binding.tvError.visibility = View.GONE
            }
        }

        vm.dashboard.observe(viewLifecycleOwner) { data ->
            if (data == null) return@observe
            binding.tvHostname.text = data.hostname ?: "Panel-Server"
            binding.tvOs.text = data.os ?: "Linux"
            binding.cpuGauge.setMetric("CPU", data.cpu)
            binding.memGauge.setMetric("RAM", data.memory)
            binding.diskGauge.setMetric("Disk", data.disk)

            binding.tvUptime.text = data.uptime?.let { formatUptime(it) } ?: "--"
            binding.tvAlertCount.text = "${data.alertCount}"
            
            val alertColor = if (data.alertCount > 0) 
                ContextCompat.getColor(requireContext(), R.color.accent_red)
            else 
                ContextCompat.getColor(requireContext(), R.color.text_secondary)
            
            binding.tvAlertCount.setTextColor(alertColor)
        }

        vm.agents.observe(viewLifecycleOwner) { agents ->
            val onlineCount = agents.count { it.online }
            binding.tvAgentsInfo.text = "$onlineCount/${agents.size} Agents online"
            
            // Status-Punkt bei Infrastruktur dynamisch färben
            val statusColor = if (onlineCount == agents.size && agents.isNotEmpty())
                ContextCompat.getColor(requireContext(), R.color.status_online)
            else if (onlineCount > 0)
                ContextCompat.getColor(requireContext(), R.color.accent_orange)
            else
                ContextCompat.getColor(requireContext(), R.color.status_offline)
            
            binding.statusDotInfra.setColorFilter(statusColor)
        }
    }

    private fun formatUptime(seconds: Long): String {
        val days = seconds / 86400
        val hours = (seconds % 86400) / 3600
        val mins = (seconds % 3600) / 60
        return when {
            days > 0 -> "${days}d ${hours}h"
            hours > 0 -> "${hours}h ${mins}m"
            else -> "${mins}m"
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
