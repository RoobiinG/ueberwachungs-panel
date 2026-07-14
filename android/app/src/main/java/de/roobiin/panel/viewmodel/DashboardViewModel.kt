package de.roobiin.panel.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import de.roobiin.panel.api.ApiClient
import de.roobiin.panel.data.Agent
import de.roobiin.panel.data.DashboardData
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class DashboardViewModel(app: Application) : AndroidViewModel(app) {

    private val api by lazy { ApiClient.getClient(app) }

    private val _dashboard = MutableLiveData<DashboardData?>()
    val dashboard: LiveData<DashboardData?> = _dashboard

    private val _agents = MutableLiveData<List<Agent>>()
    val agents: LiveData<List<Agent>> = _agents

    private val _loading = MutableLiveData(false)
    val loading: LiveData<Boolean> = _loading

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            
            // Kleiner Delay für UI-Feedback
            delay(300)

            try {
                // Agents laden
                val agentsResp = api.getAgents()
                val baseAgents = if (agentsResp.isSuccessful) agentsResp.body() ?: emptyList() else emptyList()
                
                // Für jeden Agent die detaillierten Werte abrufen (inkl. CPU/RAM/Disk)
                val updatedAgents = baseAgents.map { agent ->
                    try {
                        val statsResp = api.getAgentStats(agent.id)
                        if (statsResp.isSuccessful && statsResp.body() != null) {
                            val stats = statsResp.body()!!
                            agent.copy(
                                online = true,
                                cpu = stats.cpu?.usage,
                                memory = stats.memory?.usedPercent,
                                disk = stats.disk?.firstOrNull()?.usedPercent,
                                uptime = stats.os?.uptime,
                                hostname = stats.os?.hostname,
                                os = stats.os?.distro
                            )
                        } else {
                            agent.copy(online = false)
                        }
                    } catch (e: Exception) {
                        agent.copy(online = false)
                    }
                }
                _agents.value = updatedAgents

                // Dashboard-Logik
                try {
                    val sysStatsResp = api.getSystemStats()
                    if (sysStatsResp.isSuccessful && sysStatsResp.body() != null) {
                        val stats = sysStatsResp.body()!!
                        _dashboard.value = DashboardData(
                            cpu = stats.cpu?.usage,
                            memory = stats.memory?.usedPercent,
                            disk = stats.disk?.firstOrNull()?.usedPercent,
                            uptime = stats.os?.uptime,
                            hostname = stats.os?.hostname ?: "Panel-Server",
                            os = stats.os?.distro,
                            agentCount = updatedAgents.size,
                            agentsOnline = updatedAgents.count { it.online },
                            alertCount = 0
                        )
                    } else {
                        throw Exception("Local stats failed")
                    }
                } catch (e: Exception) {
                    // Fallback: Daten aus dem ersten verfügbaren Agent bauen
                    val firstOnline = updatedAgents.firstOrNull { it.online } ?: updatedAgents.firstOrNull()
                    if (firstOnline != null) {
                        _dashboard.value = DashboardData(
                            cpu = firstOnline.cpu,
                            memory = firstOnline.memory,
                            disk = firstOnline.disk,
                            uptime = firstOnline.uptime,
                            hostname = firstOnline.hostname ?: firstOnline.name,
                            os = firstOnline.os,
                            agentCount = updatedAgents.size,
                            agentsOnline = updatedAgents.count { it.online },
                            alertCount = 0
                        )
                    }
                }
                
                if (!agentsResp.isSuccessful) {
                    _error.value = "Agents konnten nicht geladen werden (Code: ${agentsResp.code()})"
                }
            } catch (e: Exception) {
                Log.e("DashboardVM", "Load failed", e)
                _error.value = "Verbindung zum Server fehlgeschlagen"
            } finally {
                _loading.value = false
            }
        }
    }
}
