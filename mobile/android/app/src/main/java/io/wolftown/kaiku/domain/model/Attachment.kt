package io.wolftown.kaiku.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class Attachment(
    val id: String,
    val filename: String,
    val mimeType: String,
    val size: Long,
    val url: String,
    val width: Int? = null,
    val height: Int? = null,
    val blurhash: String? = null,
    val thumbnailUrl: String? = null,
    val mediumUrl: String? = null
)
