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
                if (dashResp.isSuccessful) _dashboard.value = dashResp.body()

                val agentsResp = api.getAgents()
                if (agentsResp.isSuccessful) _agents.value = agentsResp.body() ?: emptyList()
            } catch (e: Exception) {
                _error.value = e.message ?: "Verbindungsfehler"
            } finally {
                _loading.value = false
            }
        }
    }
}
