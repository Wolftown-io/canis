package io.wolftown.kaiku.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String? = null,
    val status: String = "offline",
    val mfaEnabled: Boolean = false,
    val createdAt: String = ""
)
