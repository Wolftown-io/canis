package io.wolftown.kaiku.data.repository

import io.wolftown.kaiku.data.api.AuthApi
import io.wolftown.kaiku.data.api.MfaRequiredApiException
import io.wolftown.kaiku.data.local.AuthState
import io.wolftown.kaiku.data.local.TokenStorage
import io.wolftown.kaiku.domain.model.User
import io.wolftown.kaiku.ui.auth.MfaRequiredException
import javax.inject.Inject

class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val tokenStorage: TokenStorage,
    private val authState: AuthState
) {

    suspend fun login(
        username: String,
        password: String,
        mfaCode: String? = null
    ): Result<User> {
        return try {
            val authResponse = authApi.login(username, password, mfaCode)

            tokenStorage.saveTokens(
                accessToken = authResponse.accessToken,
                refreshToken = authResponse.refreshToken ?: "",
                expiresIn = authResponse.expiresIn,
                userId = "" // Will be populated after getMe
            )

            val user = authApi.getMe()

            // Re-save tokens with correct userId
            tokenStorage.saveTokens(
                accessToken = authResponse.accessToken,
                refreshToken = authResponse.refreshToken ?: "",
                expiresIn = authResponse.expiresIn,
                userId = user.id
            )

            authState.setLoggedIn(user.id)
            Result.success(user)
        } catch (_: MfaRequiredApiException) {
            Result.failure(MfaRequiredException())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun register(
        username: String,
        password: String,
        email: String?,
        displayName: String?
    ): Result<User> {
        return try {
            val authResponse = authApi.register(username, password, email, displayName)

            tokenStorage.saveTokens(
                accessToken = authResponse.accessToken,
                refreshToken = authResponse.refreshToken ?: "",
                expiresIn = authResponse.expiresIn,
                userId = "" // Will be populated after getMe
            )

            val user = authApi.getMe()

            tokenStorage.saveTokens(
                accessToken = authResponse.accessToken,
                refreshToken = authResponse.refreshToken ?: "",
                expiresIn = authResponse.expiresIn,
                userId = user.id
            )

            authState.setLoggedIn(user.id)
            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout() {
        try {
            authApi.logout()
        } catch (_: Exception) {
            // Best-effort server-side logout; always clear local state
        }
        tokenStorage.clear()
        authState.setLoggedOut()
    }

    suspend fun getCurrentUser(): Result<User> {
        return try {
            val user = authApi.getMe()
            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun isLoggedIn(): Boolean {
        return authState.isLoggedIn.value
    }
}
