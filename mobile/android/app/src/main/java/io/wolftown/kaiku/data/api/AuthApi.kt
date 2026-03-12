package io.wolftown.kaiku.data.api

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.wolftown.kaiku.domain.model.AuthResponse
import io.wolftown.kaiku.domain.model.User
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
data class OidcProvider(
    val slug: String,
    val displayName: String,
    val iconHint: String? = null
)

interface AuthApi {
    suspend fun login(username: String, password: String, mfaCode: String? = null): AuthResponse
    suspend fun register(
        username: String,
        password: String,
        email: String? = null,
        displayName: String? = null
    ): AuthResponse
    suspend fun refresh(refreshToken: String): AuthResponse
    suspend fun logout()
    suspend fun getMe(): User
    suspend fun getOidcProviders(): List<OidcProvider>
}

@Serializable
private data class LoginRequest(
    val username: String,
    val password: String,
    val mfaCode: String? = null
)

@Serializable
private data class RegisterRequest(
    val username: String,
    val password: String,
    val email: String? = null,
    val displayName: String? = null
)

@Serializable
private data class RefreshTokenRequest(
    val refreshToken: String
)

class AuthApiImpl @Inject constructor(
    private val httpClient: HttpClient
) : AuthApi {

    override suspend fun login(
        username: String,
        password: String,
        mfaCode: String?
    ): AuthResponse {
        val response = httpClient.post("/auth/login") {
            setBody(LoginRequest(username, password, mfaCode))
        }

        if (response.status == HttpStatusCode.Forbidden) {
            val errorBody = response.body<ApiErrorResponse>()
            if (errorBody.error == "mfa_required") {
                throw MfaRequiredApiException(errorBody.message ?: "MFA required")
            }
            throw ApiException(response.status, errorBody.message ?: "Forbidden")
        }

        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.body<ApiErrorResponse>() }.getOrNull()
            throw ApiException(response.status, errorBody?.message ?: "Login failed")
        }

        return response.body()
    }

    override suspend fun register(
        username: String,
        password: String,
        email: String?,
        displayName: String?
    ): AuthResponse {
        val response = httpClient.post("/auth/register") {
            setBody(RegisterRequest(username, password, email, displayName))
        }

        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.body<ApiErrorResponse>() }.getOrNull()
            throw ApiException(response.status, errorBody?.message ?: "Registration failed")
        }

        return response.body()
    }

    override suspend fun refresh(refreshToken: String): AuthResponse {
        val response = httpClient.post("/auth/refresh") {
            setBody(RefreshTokenRequest(refreshToken))
        }

        if (!response.status.isSuccess()) {
            throw ApiException(response.status, "Token refresh failed")
        }

        return response.body()
    }

    override suspend fun logout() {
        httpClient.post("/auth/logout")
    }

    override suspend fun getMe(): User {
        val response = httpClient.get("/auth/me")

        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.body<ApiErrorResponse>() }.getOrNull()
            throw ApiException(response.status, errorBody?.message ?: "Failed to get user")
        }

        return response.body()
    }

    override suspend fun getOidcProviders(): List<OidcProvider> {
        val response = httpClient.get("/auth/oidc/providers")

        if (!response.status.isSuccess()) {
            return emptyList()
        }

        return response.body()
    }
}

@Serializable
internal data class ApiErrorResponse(
    val error: String? = null,
    val message: String? = null
)

open class ApiException(
    val status: HttpStatusCode,
    override val message: String
) : Exception(message)

class MfaRequiredApiException(
    message: String
) : ApiException(HttpStatusCode.Forbidden, message)
