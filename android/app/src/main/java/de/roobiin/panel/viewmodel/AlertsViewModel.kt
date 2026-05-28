package de.roobiin.panel.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import de.roobiin.panel.api.ApiClient
import de.roobiin.panel.data.AlertHistory
import de.roobiin.panel.data.AlertRule
import kotlinx.coroutines.launch

class AlertsViewModel(app: Application) : AndroidViewModel(app) {

    private val api by lazy { ApiClient.getClient(app) }

    private val _rules = MutableLiveData<List<AlertRule>>()
    val rules: LiveData<List<AlertRule>> = _rules

    private val _history = MutableLiveData<List<AlertHistory>>()
    val history: LiveData<List<AlertHistory>> = _history

    private val _loading = MutableLiveData(false)
    val loading: LiveData<Boolean> = _loading

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error

    private val _testResult = MutableLiveData<String?>()
    val testResult: LiveData<String?> = _testResult

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            try {
                val rulesResp = api.getAlertRules()
                if (rulesResp.isSuccessful) _rules.value = rulesResp.body() ?: emptyList()

                val histResp = api.getAlertHistory()
                if (histResp.isSuccessful) _history.value = histResp.body() ?: emptyList()
            } catch (e: Exception) {
                _error.value = e.message
            } finally {
                _loading.value = false
            }
        }
    }

    fun toggleRule(id: Int, enabled: Boolean) {
        viewModelScope.launch {
            try {
                api.updateAlertRule(id, mapOf("enabled" to if (enabled) 1 else 0))
                load()
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun testRule(id: Int) {
        viewModelScope.launch {
            try {
                val resp = api.testAlertRule(id)
                _testResult.value = if (resp.isSuccessful) "Test-Alert gesendet!" else "Fehler: ${resp.code()}"
            } catch (e: Exception) {
                _testResult.value = "Fehler: ${e.message}"
            }
        }
    }

    fun clearTestResult() { _testResult.value = null }
}
