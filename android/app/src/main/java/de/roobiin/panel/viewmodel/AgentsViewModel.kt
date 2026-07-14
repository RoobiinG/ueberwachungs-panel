package de.roobiin.panel.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import de.roobiin.panel.api.ApiClient
import de.roobiin.panel.data.Agent
import de.roobiin.panel.data.MetricPoint
import kotlinx.coroutines.launch

class AgentsViewModel(app: Application) : AndroidViewModel(app) {

    private val api by lazy { ApiClient.getClient(app) }

    private val _agents = MutableLiveData<List<Agent>>()
    val agents: LiveData<List<Agent>> = _agents

    private val _selectedAgent = MutableLiveData<Agent?>()
    val selectedAgent: LiveData<Agent?> = _selectedAgent

    private val _metrics = MutableLiveData<List<MetricPoint>>()
    val metrics: LiveData<List<MetricPoint>> = _metrics

    private val _loading = MutableLiveData(false)
    val loading: LiveData<Boolean> = _loading

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error

    fun loadAgents() {
        viewModelScope.launch {
            _loading.value = true
            try {
                val resp = api.getAgents()
                if (resp.isSuccessful) {
                    _agents.value = resp.body() ?: emptyList()
                } else {
                    _error.value = "Fehler ${resp.code()}: ${resp.message()}"
                }
            } catch (e: Exception) {
                _error.value = e.message
            } finally {
                _loading.value = false
            }
        }
    }

    fun loadAgent(id: Int) {
        viewModelScope.launch {
            try {
                val agentsResp = api.getAgents()
                val baseAgent = agentsResp.body()?.find { it.id == id }
                if (baseAgent != null) {
                    val statsResp = api.getAgentStats(id)
                    if (statsResp.isSuccessful && statsResp.body() != null) {
                        val stats = statsResp.body()!!
                        _selectedAgent.value = baseAgent.copy(
                            online = true,
                            cpu = stats.cpu?.usage,
                            memory = stats.memory?.usedPercent,
                            disk = stats.disk?.firstOrNull()?.usedPercent,
                            uptime = stats.os?.uptime,
                            hostname = stats.os?.hostname,
                            os = stats.os?.distro
                        )
                    } else {
                        _selectedAgent.value = baseAgent.copy(online = false)
                    }
                }
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun loadMetrics(agentId: Int, range: String = "1h") {
        viewModelScope.launch {
            try {
                val resp = api.getMetrics(range, "agent:$agentId")
                if (resp.isSuccessful && resp.body() != null) {
                    val mapped = resp.body()!!.rows.map { row ->
                        MetricPoint(
                            ts = row.t,
                            cpu = row.cpu,
                            memory = row.mem,
                            disk = row.disk
                        )
                    }
                    _metrics.value = mapped
                } else {
                    _metrics.value = emptyList()
                }
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }
}
