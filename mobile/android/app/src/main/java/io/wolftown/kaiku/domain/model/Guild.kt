package io.wolftown.kaiku.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class Guild(
    val id: String,
    val name: String,
    val description: String? = null,
    val iconUrl: String? = null,
    val memberCount: Int = 0,
    val createdAt: String = ""
)
