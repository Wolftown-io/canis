package io.wolftown.kaiku.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class Channel(
    val id: String,
    val name: String,
    val channelType: String,
    val categoryId: String? = null,
    val topic: String? = null,
    val userLimit: Int? = null,
    val position: Int = 0,
    val createdAt: String = ""
)
