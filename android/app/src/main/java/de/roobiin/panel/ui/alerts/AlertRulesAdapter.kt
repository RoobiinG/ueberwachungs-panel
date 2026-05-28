package de.roobiin.panel.ui.alerts

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import de.roobiin.panel.data.AlertRule
import de.roobiin.panel.databinding.ItemAlertRuleBinding

class AlertRulesAdapter(
    private val onToggle: (Int, Boolean) -> Unit,
    private val onTest: (Int) -> Unit
) : ListAdapter<AlertRule, AlertRulesAdapter.VH>(DIFF) {

    inner class VH(val binding: ItemAlertRuleBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemAlertRuleBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val rule = getItem(position)
        with(holder.binding) {
            tvName.text = rule.name
            val condStr = if (rule.condition == "gt") ">" else "<"
            tvCondition.text = "${rule.metric.uppercase()} $condStr ${rule.threshold.toInt()}%"
            tvWebhook.text = "Webhook: ${rule.webhookName ?: rule.webhookId.toString()}"
            tvAgent.text = if (rule.agentName != null) "Agent: ${rule.agentName}" else "Lokal"

            switchEnabled.isChecked = rule.enabled == 1
            switchEnabled.setOnCheckedChangeListener { _, checked ->
                onToggle(rule.id, checked)
            }

            btnTest.setOnClickListener { onTest(rule.id) }
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<AlertRule>() {
            override fun areItemsTheSame(a: AlertRule, b: AlertRule) = a.id == b.id
            override fun areContentsTheSame(a: AlertRule, b: AlertRule) = a == b
        }
    }
}
