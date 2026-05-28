package de.roobiin.panel.api

import android.content.Context
import de.roobiin.panel.utils.SessionManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    private var retrofit: Retrofit? = null
    private var currentBaseUrl: String = ""

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
        return getClient(context)
    }

    private fun buildRetrofit(baseUrl: String, token: String?): Retrofit {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .addInterceptor { chain ->
                val request: Request = if (token != null) {
                    chain.request().newBuilder()
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                } else {
                    chain.request()
                }
                val response = chain.proceed(request)
                if (response.code == 401) {
                    de.roobiin.panel.utils.AuthState.sessionExpired.postValue(true)
                }
                response
            }
            .build()

        val normalizedUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

        return Retrofit.Builder()
            .baseUrl(normalizedUrl)
            .client(client)
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
