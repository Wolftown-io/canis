package io.wolftown.kaiku.data.api

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.http.*
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
data class IceServerConfig(
    val iceServers: List<IceServer>
)

@Serializable
data class IceServer(
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null
)

interface VoiceApi {
    suspend fun getIceServers(): IceServerConfig
}

class VoiceApiImpl @Inject constructor(
    private val httpClient: HttpClient
) : VoiceApi {

    override suspend fun getIceServers(): IceServerConfig {
        val response = httpClient.get("/api/voice/ice-servers")

        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.body<ApiErrorResponse>() }.getOrNull()
            throw ApiException(
                response.status,
                errorBody?.message ?: "Failed to fetch ICE servers"
            )
        }

        return response.body()
    }
}
