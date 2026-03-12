package io.wolftown.kaiku.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class AuthResponse(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresIn: Int,
    val tokenType: String,
    val setupRequired: Boolean = false
)
