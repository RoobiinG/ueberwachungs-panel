package de.roobiin.panel.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SessionManager(context: Context) {

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context, "panel_session", masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            context.getSharedPreferences("panel_session_fallback", Context.MODE_PRIVATE)
        }
    }

    private val settingsPrefs: SharedPreferences =
        context.getSharedPreferences("panel_settings", Context.MODE_PRIVATE)

    fun saveSession(token: String, username: String, baseUrl: String) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USERNAME, username)
            .putString(KEY_BASE_URL, baseUrl)
            .apply()
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)
    fun getUsername(): String? = prefs.getString(KEY_USERNAME, null)
    fun getBaseUrl(): String? = prefs.getString(KEY_BASE_URL, null)
    fun isLoggedIn(): Boolean = getToken() != null && getBaseUrl() != null

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    // Settings
    fun getMonitoringInterval(): Int = settingsPrefs.getInt(KEY_INTERVAL, 30)
    fun setMonitoringInterval(seconds: Int) = settingsPrefs.edit().putInt(KEY_INTERVAL, seconds).apply()

    fun isMonitoringEnabled(): Boolean = settingsPrefs.getBoolean(KEY_MONITORING, true)
    fun setMonitoringEnabled(enabled: Boolean) = settingsPrefs.edit().putBoolean(KEY_MONITORING, enabled).apply()

    fun isNotificationsEnabled(): Boolean = settingsPrefs.getBoolean(KEY_NOTIFICATIONS, true)
    fun setNotificationsEnabled(enabled: Boolean) = settingsPrefs.edit().putBoolean(KEY_NOTIFICATIONS, enabled).apply()

    // App-Sperre
    fun isAppLockEnabled(): Boolean = settingsPrefs.getBoolean(KEY_APP_LOCK, false)
    fun setAppLockEnabled(enabled: Boolean) = settingsPrefs.edit().putBoolean(KEY_APP_LOCK, enabled).apply()

    fun getPinHash(): String? = prefs.getString(KEY_PIN_HASH, null)
    fun setPinHash(hash: String) = prefs.edit().putString(KEY_PIN_HASH, hash).apply()
    fun clearPin() = prefs.edit().remove(KEY_PIN_HASH).apply()

    fun getLockTimeoutSeconds(): Int = settingsPrefs.getInt(KEY_LOCK_TIMEOUT, 30)
    fun setLockTimeoutSeconds(seconds: Int) = settingsPrefs.edit().putInt(KEY_LOCK_TIMEOUT, seconds).apply()

    companion object {
        private const val KEY_TOKEN = "token"
        private const val KEY_USERNAME = "username"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_INTERVAL = "monitoring_interval"
        private const val KEY_MONITORING = "monitoring_enabled"
        private const val KEY_NOTIFICATIONS = "notifications_enabled"
        private const val KEY_APP_LOCK = "app_lock_enabled"
        private const val KEY_PIN_HASH = "pin_hash"
        private const val KEY_LOCK_TIMEOUT = "lock_timeout_seconds"
    }
}
