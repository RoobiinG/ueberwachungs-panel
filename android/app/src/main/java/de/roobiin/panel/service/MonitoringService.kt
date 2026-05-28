package de.roobiin.panel.service

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import de.roobiin.panel.api.ApiClient
import de.roobiin.panel.notifications.NotificationHelper
import de.roobiin.panel.utils.SessionManager
import kotlinx.coroutines.*
import okhttp3.*
import com.google.gson.Gson
import com.google.gson.JsonObject

class MonitoringService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var monitoringJob: Job? = null
    private var webSocket: WebSocket? = null
    private val gson = Gson()

    companion object {
        const val ACTION_START = "START"
        const val ACTION_STOP = "STOP"
        var isRunning = false
    }

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)
        startForeground(
            NotificationHelper.NOTIF_MONITORING_SERVICE,
            NotificationHelper.buildServiceNotification(this)
        )
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            else -> startMonitoring()
        }
        return START_STICKY
    }

    private fun startMonitoring() {
        val session = SessionManager(this)
        if (!session.isLoggedIn()) return

        connectWebSocket(session)
        startPolling(session)
    }

    private fun connectWebSocket(session: SessionManager) {
        val baseUrl = session.getBaseUrl() ?: return
        val token = session.getToken() ?: return
        val wsUrl = ApiClient.buildWebSocketUrl(baseUrl)

        val client = okhttp3.OkHttpClient()
        val request = Request.Builder()
            .url(wsUrl)
            .addHeader("Authorization", "Bearer $token")
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                handleWsMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w("MonitoringService", "WebSocket-Fehler: ${t.message}")
                // Reconnect nach 15 Sekunden
                scope.launch {
                    delay(15_000)
                    connectWebSocket(session)
                }
            }
        })
    }

    private fun handleWsMessage(text: String) {
        try {
            val obj = gson.fromJson(text, JsonObject::class.java)
            val type = obj.get("type")?.asString ?: return
            if (type == "alert" || type == "alert_triggered") {
                val data = obj.getAsJsonObject("data")
                val ruleName = data?.get("rule_name")?.asString ?: "Alarm"
                val metric = data?.get("metric")?.asString ?: ""
                val value = data?.get("value")?.asDouble ?: 0.0
                val agentName = data?.get("agent_name")?.asString

                val session = SessionManager(this)
                if (session.isNotificationsEnabled()) {
                    val server = if (agentName != null) " ($agentName)" else " (Lokal)"
                    NotificationHelper.showAlertNotification(
                        this,
                        "Alarm: $ruleName$server",
                        "${metric.uppercase()} bei ${String.format("%.1f", value)}%"
                    )
                }
            }
        } catch (e: Exception) {
            Log.e("MonitoringService", "WS-Parse-Fehler: ${e.message}")
        }
    }

    private fun startPolling(session: SessionManager) {
        monitoringJob?.cancel()
        monitoringJob = scope.launch {
            val api = ApiClient.getClient(this@MonitoringService)
            while (isActive) {
                val intervalMs = session.getMonitoringInterval() * 1000L
                try {
                    // Alert-History prüfen auf neue Alerts
                    val historyResp = api.getAlertHistory(limit = 5)
                    if (historyResp.isSuccessful && session.isNotificationsEnabled()) {
                        val history = historyResp.body() ?: emptyList()
                        checkNewAlerts(history, session)
                    }
                } catch (e: Exception) {
                    Log.w("MonitoringService", "Polling-Fehler: ${e.message}")
                }
                delay(intervalMs)
            }
        }
    }

    private var lastAlertId: Int = -1

    private fun checkNewAlerts(history: List<de.roobiin.panel.data.AlertHistory>, session: SessionManager) {
        if (history.isEmpty()) return
        val latest = history.first()
        if (lastAlertId == -1) {
            lastAlertId = latest.id
            return
        }
        val newAlerts = history.takeWhile { it.id > lastAlertId }
        newAlerts.forEach { alert ->
            val server = if (alert.agentName != null) " (${alert.agentName})" else " (Lokal)"
            NotificationHelper.showAlertNotification(
                this,
                "Alarm: ${alert.ruleName ?: "Unbekannt"}$server",
                "${alert.metric?.uppercase() ?: ""} bei ${String.format("%.1f", alert.value)}%",
                alert.id
            )
        }
        if (newAlerts.isNotEmpty()) lastAlertId = newAlerts.first().id
    }

    override fun onDestroy() {
        isRunning = false
        scope.cancel()
        webSocket?.close(1000, "Service beendet")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
