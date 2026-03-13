package io.wolftown.kaiku.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ChannelType {
    @SerialName("text") TEXT,
    @SerialName("voice") VOICE,
    @SerialName("dm") DM;
}

@Serializable
data class Channel(
    val id: String,
    val name: String,
    val channelType: ChannelType,
    val categoryId: String? = null,
    val topic: String? = null,
    val userLimit: Int? = null,
    val position: Int = 0,
    val createdAt: String = ""
)
