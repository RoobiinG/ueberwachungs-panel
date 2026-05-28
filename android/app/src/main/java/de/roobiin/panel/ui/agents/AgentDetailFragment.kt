package de.roobiin.panel.ui.agents

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import com.github.mikephil.charting.components.XAxis
import com.github.mikephil.charting.data.*
import com.github.mikephil.charting.formatter.ValueFormatter
import de.roobiin.panel.R
import de.roobiin.panel.data.MetricPoint
import de.roobiin.panel.databinding.FragmentAgentDetailBinding
import de.roobiin.panel.viewmodel.AgentsViewModel
import java.text.SimpleDateFormat
import java.util.*

class AgentDetailFragment : Fragment() {

    private var _binding: FragmentAgentDetailBinding? = null
    private val binding get() = _binding!!
    private val vm: AgentsViewModel by viewModels()
    private var agentId: Int = -1

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAgentDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        agentId = arguments?.getInt("agentId") ?: return

        setupChart()
        setupRangeButtons()
        setupObservers()

        vm.loadAgent(agentId)
        vm.loadMetrics(agentId, "1h")
    }

    private fun setupObservers() {
        vm.selectedAgent.observe(viewLifecycleOwner) { agent ->
            if (agent == null) return@observe
            binding.tvAgentName.text = agent.name
            binding.tvHostname.text = agent.hostname ?: "-"
            binding.tvOs.text = agent.os ?: "-"
            binding.tvVersion.text = "v${agent.version ?: "-"}"

            binding.cpuGauge.setMetric("CPU", agent.cpu)
            binding.memGauge.setMetric("RAM", agent.memory)
            binding.diskGauge.setMetric("Disk", agent.disk)

            val uptime = agent.uptime ?: 0
            binding.tvUptime.text = formatUptime(uptime)

            val loadAvg = agent.loadAvg
            if (loadAvg != null && loadAvg.size >= 3) {
                binding.tvLoadAvg.text = "Load: ${String.format("%.2f", loadAvg[0])} / ${String.format("%.2f", loadAvg[1])} / ${String.format("%.2f", loadAvg[2])}"
            }
        }

        vm.metrics.observe(viewLifecycleOwner) { points ->
            updateChart(points)
        }
    }

    private fun setupRangeButtons() {
        binding.btn1h.setOnClickListener { loadRange("1h") }
        binding.btn6h.setOnClickListener { loadRange("6h") }
        binding.btn24h.setOnClickListener { loadRange("24h") }
        binding.btn7d.setOnClickListener { loadRange("7d") }
    }

    private fun loadRange(range: String) {
        listOf(binding.btn1h, binding.btn6h, binding.btn24h, binding.btn7d).forEach {
            it.isSelected = false
        }
        when (range) {
            "1h" -> binding.btn1h.isSelected = true
            "6h" -> binding.btn6h.isSelected = true
            "24h" -> binding.btn24h.isSelected = true
            "7d" -> binding.btn7d.isSelected = true
        }
        vm.loadMetrics(agentId, range)
    }

    private fun setupChart() {
        val chart = binding.metricsChart
        chart.description.isEnabled = false
        chart.legend.isEnabled = true
        chart.setTouchEnabled(true)
        chart.isDragEnabled = true
        chart.isScaleXEnabled = true
        chart.setDrawGridBackground(false)
        chart.axisRight.isEnabled = false

        chart.xAxis.apply {
            position = XAxis.XAxisPosition.BOTTOM
            setDrawGridLines(false)
            granularity = 1f
            valueFormatter = object : ValueFormatter() {
                val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
                override fun getFormattedValue(value: Float): String {
                    return sdf.format(Date(value.toLong() * 1000))
                }
            }
        }

        chart.axisLeft.apply {
            setDrawGridLines(true)
            axisMinimum = 0f
            axisMaximum = 100f
        }
    }

    private fun updateChart(points: List<MetricPoint>) {
        if (points.isEmpty()) return

        val cpuEntries = points.mapNotNull { p ->
            p.cpu?.let { Entry(p.ts.toFloat(), it.toFloat()) }
        }
        val memEntries = points.mapNotNull { p ->
            p.memory?.let { Entry(p.ts.toFloat(), it.toFloat()) }
        }
        val diskEntries = points.mapNotNull { p ->
            p.disk?.let { Entry(p.ts.toFloat(), it.toFloat()) }
        }

        fun lineSet(entries: List<Entry>, label: String, color: Int) =
            LineDataSet(entries, label).apply {
                this.color = color
                setCircleColor(color)
                circleRadius = 2f
                lineWidth = 2f
                setDrawValues(false)
                mode = LineDataSet.Mode.CUBIC_BEZIER
            }

        val data = LineData(
            lineSet(cpuEntries, "CPU %", Color.rgb(66, 165, 245)),
            lineSet(memEntries, "RAM %", Color.rgb(102, 187, 106)),
            lineSet(diskEntries, "Disk %", Color.rgb(255, 167, 38))
        )

        binding.metricsChart.data = data
        binding.metricsChart.invalidate()
    }

    private fun formatUptime(seconds: Long): String {
        val days = seconds / 86400
        val hours = (seconds % 86400) / 3600
        val mins = (seconds % 3600) / 60
        return when {
            days > 0 -> "${days}d ${hours}h ${mins}m"
            hours > 0 -> "${hours}h ${mins}m"
            else -> "${mins}m"
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
