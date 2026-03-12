package io.wolftown.kaiku.data.voice

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Serializable representation of an ICE candidate for WebSocket transport.
 *
 * This is separated from the WebRTC `IceCandidate` class so that
 * serialization/deserialization logic can be unit-tested without the
 * Android WebRTC runtime.
 */
@Serializable
data class IceCandidateData(
    val candidate: String,
    val sdpMLineIndex: Int,
    val sdpMid: String?
) {
    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** Deserialize from the JSON wire format used over WebSocket. */
        fun fromJson(jsonString: String): IceCandidateData =
            json.decodeFromString(jsonString)
    }

    /** Serialize to the JSON wire format for WebSocket transport. */
    fun toJson(): String = json.encodeToString(this)
}
