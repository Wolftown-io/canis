package io.wolftown.kaiku.data.repository

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import io.wolftown.kaiku.data.voice.AudioRouteManager
import io.wolftown.kaiku.data.voice.WebRtcManager
import io.wolftown.kaiku.data.ws.ClientEvent
import io.wolftown.kaiku.data.ws.KaikuWebSocket
import io.wolftown.kaiku.data.ws.ScreenShareInfo
import io.wolftown.kaiku.data.ws.ServerEvent
import io.wolftown.kaiku.data.ws.VoiceParticipant
import io.wolftown.kaiku.service.VoiceCallService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.logging.Level
import java.util.logging.Logger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Orchestrates WebRtcManager + KaikuWebSocket for the complete voice flow.
 *
 * Manages:
 * - Joining and leaving voice channels
 * - Participant tracking via WebSocket events
 * - Mute/unmute state
 * - Screen share tracking
 * - Audio focus and foreground service lifecycle
 */
@Singleton
class VoiceRepository @Inject constructor(
    private val webRtcManager: WebRtcManager,
    private val webSocket: KaikuWebSocket,
    private val audioRouteManager: AudioRouteManager,
    @ApplicationContext private val context: Context
) {
    companion object {
        private val logger = Logger.getLogger("VoiceRepository")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _currentChannelId = MutableStateFlow<String?>(null)
    /** The channel ID currently connected to, or null if not in a voice channel. */
    val currentChannelId: StateFlow<String?> = _currentChannelId.asStateFlow()

    private val _participants = MutableStateFlow<List<VoiceParticipant>>(emptyList())
    /** List of participants in the current voice channel. */
    val participants: StateFlow<List<VoiceParticipant>> = _participants.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    /** Whether the local user's microphone is muted. */
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    /** Whether the WebRTC connection is established. */
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _screenShares = MutableStateFlow<List<ScreenShareInfo>>(emptyList())
    /** Active screen shares in the current voice channel. */
    val screenShares: StateFlow<List<ScreenShareInfo>> = _screenShares.asStateFlow()

    /** WebSocket event collection job — cancelled when leaving a channel. */
    private var eventCollectionJob: Job? = null

    // -- Public API ------------------------------------------------------------

    /**
     * Joins a voice channel.
     *
     * 1. Initialize WebRtcManager (create PeerConnectionFactory if needed)
     * 2. Create PeerConnection (fetches ICE servers)
     * 3. Wire up signaling callbacks
     * 4. Send VoiceJoin via WebSocket
     * 5. Request audio focus
     * 6. Start foreground service
     */
    suspend fun joinChannel(channelId: String) {
        // If already in a channel, leave first
        if (_currentChannelId.value != null) {
            leaveChannel()
        }

        try {
            _currentChannelId.value = channelId

            // 1. Initialize WebRTC
            webRtcManager.initialize()

            // 2. Create PeerConnection
            webRtcManager.createPeerConnection()

            // 3. Wire up signaling callbacks
            webRtcManager.onLocalDescription = { sdp ->
                webSocket.send(ClientEvent.VoiceAnswer(channelId, sdp))
            }
            webRtcManager.onIceCandidate = { candidateJson ->
                webSocket.send(ClientEvent.VoiceIceCandidate(channelId, candidateJson))
            }

            // Start collecting WebSocket events
            startCollectingEvents(channelId)

            // 4. Send VoiceJoin
            webSocket.send(ClientEvent.VoiceJoin(channelId))

            // 5. Request audio focus
            audioRouteManager.requestAudioFocus()

            // 6. Start foreground service
            VoiceCallService.start(context, channelId, channelId)

            _isConnected.value = true
            logger.info("Joined voice channel: $channelId")
        } catch (e: Exception) {
            logger.log(Level.SEVERE, "Failed to join voice channel: $channelId", e)
            // Clean up on failure
            cleanUp()
            throw e
        }
    }

    /**
     * Leaves the current voice channel.
     *
     * 1. Send VoiceLeave via WebSocket
     * 2. Close PeerConnection
     * 3. Abandon audio focus
     * 4. Stop foreground service
     * 5. Clear state
     */
    suspend fun leaveChannel() {
        val channelId = _currentChannelId.value ?: return

        try {
            // 1. Send VoiceLeave
            webSocket.send(ClientEvent.VoiceLeave(channelId))
        } catch (e: Exception) {
            logger.log(Level.WARNING, "Failed to send VoiceLeave", e)
        }

        cleanUp()
        logger.info("Left voice channel: $channelId")
    }

    /**
     * Toggles the local microphone mute state.
     */
    fun toggleMute() {
        val channelId = _currentChannelId.value ?: return
        val newMuted = !_isMuted.value

        webRtcManager.setMuted(newMuted)
        _isMuted.value = newMuted

        if (newMuted) {
            webSocket.send(ClientEvent.VoiceMute(channelId))
        } else {
            webSocket.send(ClientEvent.VoiceUnmute(channelId))
        }
    }

    // -- Internal -------------------------------------------------------------

    private fun cleanUp() {
        // Stop event collection
        eventCollectionJob?.cancel()
        eventCollectionJob = null

        // Close PeerConnection
        webRtcManager.closePeerConnection()
        webRtcManager.onLocalDescription = null
        webRtcManager.onIceCandidate = null

        // Abandon audio focus
        audioRouteManager.abandonAudioFocus()

        // Stop foreground service
        VoiceCallService.stop(context)

        // Clear state
        _currentChannelId.value = null
        _participants.value = emptyList()
        _screenShares.value = emptyList()
        _isConnected.value = false
        _isMuted.value = false
    }

    private fun startCollectingEvents(channelId: String) {
        eventCollectionJob?.cancel()
        eventCollectionJob = scope.launch {
            webSocket.events.collect { event ->
                handleServerEvent(channelId, event)
            }
        }
    }

    private fun handleServerEvent(channelId: String, event: ServerEvent) {
        when (event) {
            is ServerEvent.VoiceRoomState -> {
                if (event.channelId == channelId) {
                    _participants.value = event.participants
                    _screenShares.value = event.screenShares
                }
            }

            is ServerEvent.VoiceOffer -> {
                if (event.channelId == channelId) {
                    webRtcManager.handleOffer(event.sdp)
                }
            }

            is ServerEvent.VoiceIceCandidate -> {
                if (event.channelId == channelId) {
                    webRtcManager.addIceCandidate(event.candidate)
                }
            }

            is ServerEvent.VoiceUserJoined -> {
                if (event.channelId == channelId) {
                    val newParticipant = VoiceParticipant(
                        userId = event.userId,
                        username = event.username,
                        displayName = event.displayName
                    )
                    val current = _participants.value
                    if (current.none { it.userId == event.userId }) {
                        _participants.value = current + newParticipant
                    }
                }
            }

            is ServerEvent.VoiceUserLeft -> {
                if (event.channelId == channelId) {
                    _participants.value = _participants.value.filter {
                        it.userId != event.userId
                    }
                }
            }

            is ServerEvent.VoiceUserMuted -> {
                if (event.channelId == channelId) {
                    _participants.value = _participants.value.map {
                        if (it.userId == event.userId) it.copy(muted = true) else it
                    }
                }
            }

            is ServerEvent.VoiceUserUnmuted -> {
                if (event.channelId == channelId) {
                    _participants.value = _participants.value.map {
                        if (it.userId == event.userId) it.copy(muted = false) else it
                    }
                }
            }

            is ServerEvent.ScreenShareStarted -> {
                if (event.channelId == channelId) {
                    val info = ScreenShareInfo(
                        streamId = event.streamId,
                        userId = event.userId,
                        username = event.username,
                        sourceLabel = event.sourceLabel,
                        hasAudio = event.hasAudio,
                        quality = event.quality,
                        startedAt = event.startedAt
                    )
                    val current = _screenShares.value
                    if (current.none { it.streamId == event.streamId }) {
                        _screenShares.value = current + info
                    }
                }
            }

            is ServerEvent.ScreenShareStopped -> {
                if (event.channelId == channelId) {
                    _screenShares.value = _screenShares.value.filter {
                        it.streamId != event.streamId
                    }
                }
            }

            else -> { /* Ignored — other events handled elsewhere */ }
        }
    }
}
