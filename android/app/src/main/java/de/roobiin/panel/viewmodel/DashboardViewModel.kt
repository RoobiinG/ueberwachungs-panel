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
                if (agentsResp.isSuccessful) {
                    val baseAgents = agentsResp.body() ?: emptyList()
                    
                    // Für jeden Agent die detaillierten Werte abrufen (inkl. CPU/RAM/Disk)
                    val updatedAgents = baseAgents.map { agent ->
                        try {
                            val detailResp = api.getAgent(agent.id)
                            if (detailResp.isSuccessful && detailResp.body() != null) {
                                detailResp.body()!!
                            } else {
                                agent
                            }
                        } catch (e: Exception) {
                            agent
                        }
                    }
                    _agents.value = updatedAgents

                    // Dashboard-Logik
                    val dashResp = api.getDashboard()
                    if (dashResp.isSuccessful && dashResp.body()?.cpu != null) {
                        _dashboard.value = dashResp.body()
                    } else {
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
                } else {
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
