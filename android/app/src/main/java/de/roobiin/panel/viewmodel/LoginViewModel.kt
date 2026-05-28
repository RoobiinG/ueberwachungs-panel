package de.roobiin.panel.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import de.roobiin.panel.api.ApiClient
import de.roobiin.panel.data.LoginRequest
import de.roobiin.panel.utils.SessionManager
import kotlinx.coroutines.launch

class LoginViewModel(app: Application) : AndroidViewModel(app) {

    private val _loginSuccess = MutableLiveData(false)
    val loginSuccess: LiveData<Boolean> = _loginSuccess

    private val _loading = MutableLiveData(false)
    val loading: LiveData<Boolean> = _loading

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error

    fun login(baseUrl: String, username: String, password: String) {
        if (baseUrl.isBlank() || username.isBlank() || password.isBlank()) {
            _error.value = "Alle Felder ausfüllen"
            return
        }

        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            try {
                val normalizedUrl = if (baseUrl.startsWith("http")) baseUrl else "https://$baseUrl"
                val session = SessionManager(getApplication())
                session.saveSession("temp", username, normalizedUrl)

                val api = ApiClient.rebuild(getApplication())
                val resp = api.login(LoginRequest(username, password))

                if (resp.isSuccessful) {
                    val body = resp.body()!!
                    session.saveSession(body.token, body.user.username, normalizedUrl)
                    ApiClient.rebuild(getApplication())
                    _loginSuccess.value = true
                } else {
                    session.clearSession()
                    _error.value = when (resp.code()) {
                        401 -> "Ungültige Anmeldedaten"
                        429 -> "Zu viele Versuche — bitte warten"
                        else -> "Fehler ${resp.code()}"
                    }
                }
            } catch (e: Exception) {
                _error.value = "Verbindungsfehler: ${e.message}"
            } finally {
                _loading.value = false
            }
        }
    }
}
