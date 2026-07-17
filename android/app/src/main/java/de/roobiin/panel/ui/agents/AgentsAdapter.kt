package de.roobiin.panel.ui.agents

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import de.roobiin.panel.R
import de.roobiin.panel.data.Agent
import de.roobiin.panel.databinding.ItemAgentBinding

class AgentsAdapter(
    private val onClick: (Agent) -> Unit
) : ListAdapter<Agent, AgentsAdapter.VH>(DIFF) {

    inner class VH(val binding: ItemAgentBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        return VH(ItemAgentBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val agent = getItem(position)
        with(holder.binding) {
            tvName.text = agent.name
            tvUrl.text = agent.url
            tvHostname.text = agent.hostname ?: agent.os ?: ""

            val onlineColor = if (agent.online)
                ContextCompat.getColor(root.context, R.color.status_online)
            else
                ContextCompat.getColor(root.context, R.color.status_offline)
            statusDot.setColorFilter(onlineColor)
            tvStatus.text = if (agent.online) "Online" else "Offline"
            tvStatus.setTextColor(onlineColor)

            if (agent.online) {
                val cpu = agent.cpu
                val mem = agent.memory
                val disk = agent.disk

                tvCpu.text = if (cpu != null) "CPU: ${String.format("%.1f", cpu)}%" else "CPU: N/A"
                pbCpu.progress = cpu?.toInt() ?: 0

                tvMem.text = if (mem != null) "RAM: ${String.format("%.1f", mem)}%" else "RAM: N/A"
                pbMem.progress = mem?.toInt() ?: 0

                tvDisk.text = if (disk != null) "Disk: ${String.format("%.1f", disk)}%" else "Disk: N/A"
                pbDisk.progress = disk?.toInt() ?: 0
            } else {
                tvCpu.text = ""
                pbCpu.progress = 0
                tvMem.text = ""
                pbMem.progress = 0
                tvDisk.text = ""
                pbDisk.progress = 0
            }

            root.setOnClickListener { onClick(agent) }
        }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<Agent>() {
            override fun areItemsTheSame(a: Agent, b: Agent) = a.id == b.id
            override fun areContentsTheSame(a: Agent, b: Agent) = a == b
        }
    }
}
