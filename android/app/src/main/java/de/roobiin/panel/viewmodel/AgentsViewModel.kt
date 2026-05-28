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
                val resp = api.getAgent(id)
                if (resp.isSuccessful) _selectedAgent.value = resp.body()
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun loadMetrics(agentId: Int, range: String = "1h") {
        viewModelScope.launch {
            try {
                val resp = api.getAgentMetrics(agentId, range)
                if (resp.isSuccessful) _metrics.value = resp.body() ?: emptyList()
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }
}
