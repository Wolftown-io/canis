package io.wolftown.kaiku.data.api

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.util.*
import io.wolftown.kaiku.data.KaikuJson
import io.wolftown.kaiku.data.local.AuthState
import io.wolftown.kaiku.data.local.TokenStorage
import io.wolftown.kaiku.domain.model.AuthResponse
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import javax.inject.Inject

/** Request body for the token refresh endpoint. */
@Serializable
internal data class RefreshRequest(val refreshToken: String)

/**
 * Configured Ktor [HttpClient] wrapper for all Kaiku API calls.
 *
 * Provides:
 * - Content negotiation with [KaikuJson] (snake_case)
 * - Base URL from [TokenStorage.getServerUrl]
 * - Automatic Bearer token injection
 * - Transparent 401 -> refresh -> retry flow
 * - Mutex-guarded refresh to prevent concurrent refresh storms
 */
class KaikuHttpClient @Inject constructor(
    private val tokenStorage: TokenStorage,
    private val authState: AuthState
) {
    private val refreshMutex = Mutex()

    val httpClient: HttpClient = createConfiguredClient(OkHttp.create())

    /**
     * Creates a [KaikuHttpClient] with a custom engine (for testing with MockEngine).
     */
    internal companion object {
        /** Attribute key to mark requests that should skip the auth interceptor. */
        private val SkipAuthInterceptor = AttributeKey<Boolean>("SkipAuthInterceptor")

        fun forTesting(
            tokenStorage: TokenStorage,
            authState: AuthState,
            engine: HttpClientEngine
        ): KaikuHttpClient {
            return KaikuHttpClient(tokenStorage, authState).apply {
                testClient = createConfiguredClient(engine)
            }
        }
    }

    @Volatile
    private var testClient: HttpClient? = null

    /** Returns the active [HttpClient] (test override or production OkHttp). */
    internal fun activeClient(): HttpClient = testClient ?: httpClient

    private fun createConfiguredClient(engine: HttpClientEngine): HttpClient {
        val client = HttpClient(engine) {
            install(ContentNegotiation) {
                json(KaikuJson)
            }

            defaultRequest {
                val serverUrl = tokenStorage.getServerUrl()
                if (serverUrl != null) {
                    url(serverUrl)
                }
                contentType(ContentType.Application.Json)
            }
        }

        client.plugin(HttpSend).intercept { request ->
            // Skip auth logic for internal requests (e.g. token refresh)
            if (request.attributes.getOrNull(SkipAuthInterceptor) == true) {
                return@intercept execute(request)
            }

            // Attach Bearer token if available
            tokenStorage.getAccessToken()?.let { token ->
                request.headers[HttpHeaders.Authorization] = "Bearer $token"
            }

            val originalCall = execute(request)

            if (originalCall.response.status != HttpStatusCode.Unauthorized) {
                return@intercept originalCall
            }

            // 401 received -- attempt token refresh
            val refreshToken = tokenStorage.getRefreshToken()
            if (refreshToken == null) {
                authState.setLoggedOut()
                return@intercept originalCall
            }

            val tokenUsedInRequest =
                request.headers[HttpHeaders.Authorization]?.removePrefix("Bearer ")

            val refreshSucceeded = refreshMutex.withLock {
                // Double-check: another coroutine may have already refreshed
                val currentToken = tokenStorage.getAccessToken()
                if (currentToken != null && currentToken != tokenUsedInRequest) {
                    // Token was already refreshed by another coroutine
                    true
                } else {
                    performRefresh(refreshToken)
                }
            }

            if (!refreshSucceeded) {
                authState.setLoggedOut()
                return@intercept originalCall
            }

            // Retry original request with new token
            val newToken = tokenStorage.getAccessToken()
            request.headers[HttpHeaders.Authorization] = "Bearer $newToken"
            execute(request)
        }

        return client
    }

    /**
     * Performs the token refresh request.
     * Returns true if refresh succeeded and tokens were saved, false otherwise.
     */
    private suspend fun Sender.performRefresh(refreshToken: String): Boolean {
        return try {
            val body = KaikuJson.encodeToString(RefreshRequest(refreshToken))
            val refreshRequest = HttpRequestBuilder().apply {
                method = HttpMethod.Post
                url.encodedPath = "/auth/refresh"
                contentType(ContentType.Application.Json)
                setBody(TextContent(body, ContentType.Application.Json))
                // Mark this request to skip the auth interceptor
                attributes.put(SkipAuthInterceptor, true)
            }
            val refreshCall = execute(refreshRequest)
            val status = refreshCall.response.status

            if (status == HttpStatusCode.Unauthorized || status == HttpStatusCode.Forbidden) {
                return false
            }

            if (!status.isSuccess()) {
                return false
            }

            val authResponse = refreshCall.response.body<AuthResponse>()

            // Use existing userId since the refresh response does not include it
            val userId = tokenStorage.getUserId() ?: return false

            tokenStorage.saveTokens(
                accessToken = authResponse.accessToken,
                refreshToken = authResponse.refreshToken ?: refreshToken,
                expiresIn = authResponse.expiresIn,
                userId = userId
            )
            true
        } catch (_: Exception) {
            false
        }
    }
}
