package de.roobiin.panel.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import de.roobiin.panel.api.ApiClient
import de.roobiin.panel.data.Agent
import de.roobiin.panel.data.DashboardData
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
            try {
                val dashResp = api.getDashboard()
                val agentsResp = api.getAgents()
                
                if (dashResp.isSuccessful) {
                    _dashboard.value = dashResp.body()
                } else if (dashResp.code() != 404) {
                    _error.value = "Dashboard-Fehler: ${dashResp.code()}"
                }

                if (agentsResp.isSuccessful) {
                    val agents = agentsResp.body() ?: emptyList()
                    _agents.value = agents
                    
                    // Fallback: Wenn Dashboard 404 liefert, baue Daten aus Agents zusammen
                    if (_dashboard.value == null && agents.isNotEmpty()) {
                        val firstOnline = agents.firstOrNull { it.online } ?: agents.first()
                        _dashboard.value = DashboardData(
                            cpu = firstOnline.cpu,
                            memory = firstOnline.memory,
                            disk = firstOnline.disk,
                            uptime = firstOnline.uptime,
                            hostname = firstOnline.hostname ?: firstOnline.name,
                            os = firstOnline.os,
                            agentCount = agents.size,
                            agentsOnline = agents.count { it.online },
                            alertCount = 0
                        )
                    }
                } else if (_error.value == null) {
                    _error.value = "Agents konnten nicht geladen werden"
                }
            } catch (e: Exception) {
                _error.value = "Verbindung zum Server fehlgeschlagen"
            } finally {
                _loading.value = false
            }
        }
    }
}
