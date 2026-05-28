package de.roobiin.panel.api

import de.roobiin.panel.data.*
import retrofit2.Response
import retrofit2.http.*

interface PanelApi {

    // Auth
    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @GET("api/auth/me")
    suspend fun getMe(): Response<UserInfo>

    // Dashboard
    @GET("api/dashboard")
    suspend fun getDashboard(): Response<DashboardData>

    // Agents
    @GET("api/agents")
    suspend fun getAgents(): Response<List<Agent>>

    @GET("api/agents/{id}")
    suspend fun getAgent(@Path("id") id: Int): Response<Agent>

    @GET("api/agents/{id}/metrics")
    suspend fun getAgentMetrics(
        @Path("id") id: Int,
        @Query("range") range: String = "1h"
    ): Response<List<MetricPoint>>

    // Alerts
    @GET("api/alerts/rules")
    suspend fun getAlertRules(): Response<List<AlertRule>>

    @GET("api/alerts/history")
    suspend fun getAlertHistory(@Query("limit") limit: Int = 50): Response<List<AlertHistory>>

    @PUT("api/alerts/rules/{id}")
    suspend fun updateAlertRule(
        @Path("id") id: Int,
        @Body body: Map<String, Any>
    ): Response<Map<String, Any>>

    @POST("api/alerts/rules/{id}/test")
    suspend fun testAlertRule(@Path("id") id: Int): Response<Map<String, Any>>

    // Metrics
    @GET("api/metrics")
    suspend fun getMetrics(
        @Query("range") range: String = "1h",
        @Query("agent_id") agentId: Int? = null
    ): Response<List<MetricPoint>>

    // Docker (lokal via Agent-Proxy)
    @GET("api/agents/{id}/docker/containers")
    suspend fun getContainers(@Path("id") agentId: Int): Response<List<DockerContainer>>

    @POST("api/agents/{id}/docker/containers/{containerId}/{action}")
    suspend fun dockerAction(
        @Path("id") agentId: Int,
        @Path("containerId") containerId: String,
        @Path("action") action: String
    ): Response<DockerActionResponse>

    // Services
    @GET("api/services")
    suspend fun getServices(): Response<List<ServiceInfo>>

    // Version
    @GET("api/version")
    suspend fun getVersion(): Response<VersionInfo>
}
