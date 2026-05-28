package de.roobiin.panel.ui.alerts

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import de.roobiin.panel.data.AlertHistory
import de.roobiin.panel.databinding.ItemAlertHistoryBinding
import java.text.SimpleDateFormat
import java.util.*

class AlertHistoryAdapter : ListAdapter<AlertHistory, AlertHistoryAdapter.VH>(DIFF) {

    inner class VH(val binding: ItemAlertHistoryBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemAlertHistoryBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = getItem(position)
        with(holder.binding) {
            tvRuleName.text = item.ruleName ?: "Unbekannte Regel"
            val condStr = if (item.condition == "gt") ">" else "<"
            tvValue.text = "${item.metric?.uppercase() ?: ""} ${String.format("%.1f", item.value)}% ($condStr ${item.threshold?.toInt()}%)"
            tvAgent.text = item.agentName ?: "Lokal"
            tvTime.text = formatTime(item.triggeredAt)
        }
    }

    private fun formatTime(ts: String): String {
        return try {
            val inputFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
            val outputFmt = SimpleDateFormat("dd.MM.yy HH:mm", Locale.getDefault())
            outputFmt.format(inputFmt.parse(ts)!!)
        } catch (e: Exception) {
            ts
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<AlertHistory>() {
            override fun areItemsTheSame(a: AlertHistory, b: AlertHistory) = a.id == b.id
            override fun areContentsTheSame(a: AlertHistory, b: AlertHistory) = a == b
        }
    }
}
