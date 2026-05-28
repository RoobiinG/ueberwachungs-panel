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
                tvCpu.text = "CPU: ${String.format("%.1f", agent.cpu ?: 0.0)}%"
                tvMem.text = "RAM: ${String.format("%.1f", agent.memory ?: 0.0)}%"
                tvDisk.text = "Disk: ${String.format("%.1f", agent.disk ?: 0.0)}%"
            } else {
                tvCpu.text = ""
                tvMem.text = ""
                tvDisk.text = ""
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
