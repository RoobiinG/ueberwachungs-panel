package de.roobiin.panel.viewmodel

import android.app.Application
import android.util.Patterns
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

        val normalizedUrl = normalizeUrl(baseUrl)
        if (normalizedUrl == null) {
            _error.value = "Ungültige Server-URL"
            return
        }

        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val session = SessionManager(getApplication())
            try {
                // Retrofit mit neuer URL konfigurieren — noch KEIN Token speichern
                session.saveSession("temp", username, normalizedUrl)
                val api = ApiClient.rebuild(getApplication())
                val resp = api.login(LoginRequest(username, password))

                if (resp.isSuccessful) {
                    val body = resp.body()
                    if (body?.token == null) {
                        session.clearSession()
                        _error.value = "Ungültige Server-Antwort"
                        return@launch
                    }
                    // Erst jetzt echten Token speichern (überschreibt "temp")
                    session.saveSession(body.token, body.user.username, normalizedUrl)
                    ApiClient.rebuild(getApplication())
                    _loginSuccess.value = true
                } else {
                    session.clearSession()
                    _error.value = when (resp.code()) {
                        401 -> "Ungültige Anmeldedaten"
                        429 -> "Zu viele Versuche — bitte warten"
                        404 -> "Server-URL nicht gefunden"
                        else -> "Server-Fehler ${resp.code()}"
                    }
                }
            } catch (e: Exception) {
                session.clearSession()
                _error.value = "Verbindungsfehler: ${e.message}"
            } finally {
                _loading.value = false
            }
        }
    }

    private fun normalizeUrl(input: String): String? {
        val url = if (input.startsWith("http://") || input.startsWith("https://")) {
            input.trimEnd('/')
        } else {
            "https://${input.trimEnd('/')}"
        }
        // Mindest-Validierung: muss Host haben
        return try {
            val parsed = java.net.URL(url)
            if (parsed.host.isNullOrBlank()) null else url
        } catch (e: Exception) {
            null
        }
    }
}
