package io.wolftown.kaiku.data.local

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthState @Inject constructor() {

    private val _isLoggedIn = MutableStateFlow(false)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    private val _currentUserId = MutableStateFlow<String?>(null)
    val currentUserId: StateFlow<String?> = _currentUserId.asStateFlow()

    fun setLoggedIn(userId: String) {
        _currentUserId.value = userId
        _isLoggedIn.value = true
    }

    fun setLoggedOut() {
        _isLoggedIn.value = false
        _currentUserId.value = null
    }

    /**
     * Restores auth state from persisted tokens on app start.
     *
     * If the access token is expired but a refresh token exists, we still
     * consider the user logged in — the HTTP interceptor will refresh the
     * token transparently on the first API call.
     */
    fun initialize(tokenStorage: TokenStorage) {
        val token = tokenStorage.getAccessToken()
        val userId = tokenStorage.getUserId()
        val refreshToken = tokenStorage.getRefreshToken()

        if (token != null && userId != null) {
            // Valid token or expired-but-refreshable — let the HTTP interceptor handle refresh
            if (!tokenStorage.isAccessTokenExpired() || refreshToken != null) {
                setLoggedIn(userId)
                return
            }
        }

        setLoggedOut()
    }
}
