package io.wolftown.kaiku.data.local

import android.content.SharedPreferences
import java.util.logging.Logger
import javax.inject.Inject

class TokenStorage @Inject constructor(
    private val prefs: SharedPreferences
) {

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_EXPIRES_AT = "expires_at"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_SERVER_URL = "server_url"
        private val logger = Logger.getLogger("TokenStorage")
    }

    fun saveTokens(
        accessToken: String,
        refreshToken: String,
        expiresIn: Int,
        userId: String
    ) {
        val expiresAt = System.currentTimeMillis() + expiresIn * 1000L
        val success = prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putLong(KEY_EXPIRES_AT, expiresAt)
            .putString(KEY_USER_ID, userId)
            .commit()
        if (!success) {
            logger.warning("Failed to persist tokens to storage")
        }
    }

    fun getAccessToken(): String? = prefs.getString(KEY_ACCESS_TOKEN, null)

    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)

    fun getUserId(): String? = prefs.getString(KEY_USER_ID, null)

    fun getServerUrl(): String? = prefs.getString(KEY_SERVER_URL, null)

    fun saveServerUrl(url: String) {
        val success = prefs.edit()
            .putString(KEY_SERVER_URL, url)
            .commit()
        if (!success) {
            logger.warning("Failed to persist server URL to storage")
        }
    }

    fun isAccessTokenExpired(): Boolean {
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        return System.currentTimeMillis() >= expiresAt
    }

    fun clear() {
        val success = prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_EXPIRES_AT)
            .remove(KEY_USER_ID)
            .commit()
        if (!success) {
            logger.warning("Failed to clear tokens from storage")
        }
    }
}
