package de.roobiin.panel.data

import com.google.gson.annotations.SerializedName

data class LoginRequest(val username: String, val password: String)

data class LoginResponse(
    val token: String,
    val user: UserInfo,
    val permissions: List<String>?,
    val hideLocal: Boolean = false
)

data class UserInfo(
    val id: Int,
    val username: String,
    val role: String
)

data class Agent(
    val id: Int,
    val name: String,
    val url: String,
    val token: String?,
    @SerializedName("last_seen") val lastSeen: String?,
    val version: String?,
    @SerializedName("latest_version") val latestVersion: String?,
    @SerializedName("online", alternate = ["is_online", "status"]) val online: Boolean = false,
    @SerializedName("cpu", alternate = ["cpu_usage", "cpu_percent"]) val cpu: Double? = null,
    @SerializedName("memory", alternate = ["memory_usage", "memory_percent", "mem_usage"]) val memory: Double? = null,
    @SerializedName("disk", alternate = ["disk_usage", "disk_percent"]) val disk: Double? = null,
    val uptime: Long? = null,
    val hostname: String? = null,
    val os: String? = null,
    @SerializedName("load_avg") val loadAvg: List<Double>? = null
)

data class AgentMetrics(
    @SerializedName("cpu", alternate = ["cpu_usage", "cpu_percent"]) val cpu: Double,
    @SerializedName("memory", alternate = ["memory_usage", "memory_percent", "mem_usage"]) val memory: Double,
    @SerializedName("disk", alternate = ["disk_usage", "disk_percent"]) val disk: Double,
    val uptime: Long,
    val hostname: String?,
    val os: String?,
    @SerializedName("load_avg") val loadAvg: List<Double>?
)

data class DashboardData(
    @SerializedName("cpu", alternate = ["cpu_usage", "cpu_percent"]) val cpu: Double?,
    @SerializedName("memory", alternate = ["memory_usage", "memory_percent", "mem_usage"]) val memory: Double?,
    @SerializedName("disk", alternate = ["disk_usage", "disk_percent"]) val disk: Double?,
    val uptime: Long?,
    val hostname: String?,
    val os: String?,
    @SerializedName("agent_count") val agentCount: Int = 0,
    @SerializedName("agents_online") val agentsOnline: Int = 0,
    @SerializedName("alert_count") val alertCount: Int = 0
)

data class AlertRule(
    val id: Int,
    val name: String,
    val metric: String,
    val condition: String,
    val threshold: Double,
    @SerializedName("duration_seconds") val durationSeconds: Int = 0,
    @SerializedName("cooldown_minutes") val cooldownMinutes: Int = 30,
    @SerializedName("webhook_id") val webhookId: Int,
    @SerializedName("webhook_name") val webhookName: String?,
    @SerializedName("agent_id") val agentId: Int?,
    @SerializedName("agent_name") val agentName: String?,
    val enabled: Int = 1
)

data class AlertHistory(
    val id: Int,
    @SerializedName("triggered_at") val triggeredAt: String,
    val value: Double,
    val message: String?,
    val type: String?,
    @SerializedName("rule_name") val ruleName: String?,
    val metric: String?,
    val threshold: Double?,
    val condition: String?,
    @SerializedName("agent_name") val agentName: String?
)

data class MetricPoint(
    val ts: Long,
    val cpu: Double?,
    val memory: Double?,
    val disk: Double?
)

data class DockerContainer(
    val id: String,
    val name: String,
    val image: String,
    val status: String,
    val state: String,
    val created: Long,
    @SerializedName("cpu_percent") val cpuPercent: Double?,
    @SerializedName("mem_percent") val memPercent: Double?,
    val ports: String?
)

data class DockerAction(val action: String)

data class DockerActionResponse(val success: Boolean, val message: String?)

data class ServiceInfo(
    val name: String,
    val description: String?,
    @SerializedName("load_state") val loadState: String?,
    @SerializedName("active_state") val activeState: String?,
    @SerializedName("sub_state") val subState: String?
)

data class ApiResponse<T>(val data: T?, val error: String?)

data class VersionInfo(val version: String, val buildDate: String?)

data class WebSocketMessage(
    val type: String,
    val data: Any?
)

data class SystemStats(
    val cpu: CpuStats?,
    val memory: MemoryStats?,
    val disk: List<DiskStats>?,
    val os: OsStats?
)

data class CpuStats(
    val usage: Double,
    val cores: Int
)

data class MemoryStats(
    val total: Long,
    val used: Long,
    val free: Long,
    val usedPercent: Double
)

data class DiskStats(
    val fs: String,
    val size: Long,
    val used: Long,
    val free: Long,
    val usedPercent: Double,
    val mount: String
)

data class OsStats(
    val distro: String?,
    val release: String?,
    val arch: String?,
    val hostname: String?,
    val uptime: Long?
)

data class MetricsResponse(
    val range: String,
    val rows: List<MetricRow>
)

data class MetricRow(
    val t: Long,
    val cpu: Double?,
    val mem: Double?,
    val disk: Double?,
    @SerializedName("net_rx") val netRx: Double?,
    @SerializedName("net_tx") val netTx: Double?
)

sealed class ApiResult<out T> {
    data class Success<out T>(val data: T) : ApiResult<T>()
    data class Error(val message: String, val code: Int? = null) : ApiResult<Nothing>()
    object Loading : ApiResult<Nothing>()
}

