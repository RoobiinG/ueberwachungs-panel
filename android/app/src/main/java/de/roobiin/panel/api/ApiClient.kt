package de.roobiin.panel.api

import android.content.Context
import de.roobiin.panel.BuildConfig
import de.roobiin.panel.utils.SessionManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object ApiClient {

    private var retrofit: Retrofit? = null
    private var currentBaseUrl: String = ""

    // Verhindert mehrfache 401-Events in kurzer Zeit
    private val sessionExpiredFired = AtomicBoolean(false)

    fun getClient(context: Context): PanelApi {
        val session = SessionManager(context)
        val baseUrl = session.getBaseUrl() ?: "http://localhost:3001/"
        val token = session.getToken()

        if (retrofit == null || currentBaseUrl != baseUrl) {
            currentBaseUrl = baseUrl
            retrofit = buildRetrofit(baseUrl, token)
        }

        return retrofit!!.create(PanelApi::class.java)
    }

    fun rebuild(context: Context): PanelApi {
        retrofit = null
        sessionExpiredFired.set(false)
        return getClient(context)
    }

    private fun buildRetrofit(baseUrl: String, token: String?): Retrofit {
        val clientBuilder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request: Request = if (!token.isNullOrEmpty() && token != "temp") {
                    chain.request().newBuilder()
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                } else {
                    chain.request()
                }
                val response = chain.proceed(request)
                // Nur einmal feuern — verhindert mehrfache Login-Redirects
                if (response.code == 401 && sessionExpiredFired.compareAndSet(false, true)) {
                    de.roobiin.panel.utils.AuthState.sessionExpired.postValue(true)
                }
                response
            }

        // Logging nur im Debug-Build — schützt Token vor Logcat-Leaks
        if (BuildConfig.DEBUG) {
            clientBuilder.addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                }
            )
        }

        val normalizedUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

        return Retrofit.Builder()
            .baseUrl(normalizedUrl)
            .client(clientBuilder.build())
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun buildWebSocketUrl(baseUrl: String): String {
        return baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .trimEnd('/') + "/ws"
    }
}
