package io.wolftown.kaiku.ui.voice

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.wolftown.kaiku.data.repository.VoiceRepository
import io.wolftown.kaiku.data.voice.AudioRoute
import io.wolftown.kaiku.data.voice.AudioRouteManager
import io.wolftown.kaiku.data.ws.ScreenShareInfo
import io.wolftown.kaiku.data.ws.VoiceParticipant
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.logging.Level
import java.util.logging.Logger
import javax.inject.Inject

/**
 * ViewModel for the voice channel screen.
 *
 * Exposes voice state (participants, mute, connection, screen shares, audio route)
 * and provides actions (join, leave, mute toggle, route switch).
 */
@HiltViewModel
class VoiceViewModel @Inject constructor(
    private val voiceRepository: VoiceRepository,
    private val audioRouteManager: AudioRouteManager,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private val logger = Logger.getLogger("VoiceViewModel")
    }

    private val channelId: String = savedStateHandle["channelId"]!!

    val participants: StateFlow<List<VoiceParticipant>> = voiceRepository.participants
    val isMuted: StateFlow<Boolean> = voiceRepository.isMuted
    val isConnected: StateFlow<Boolean> = voiceRepository.isConnected
    val screenShares: StateFlow<List<ScreenShareInfo>> = voiceRepository.screenShares
    val currentRoute: StateFlow<AudioRoute> = audioRouteManager.currentRoute
    val availableRoutes: StateFlow<Set<AudioRoute>> = audioRouteManager.availableRoutes

    init {
        onJoin()
    }

    /** Joins the voice channel. Called automatically on init. */
    fun onJoin() {
        viewModelScope.launch {
            try {
                voiceRepository.joinChannel(channelId)
            } catch (e: Exception) {
                logger.log(Level.WARNING, "Failed to join voice channel: $channelId", e)
            }
        }
    }

    /** Leaves the voice channel explicitly. */
    fun onLeave() {
        viewModelScope.launch {
            try {
                voiceRepository.leaveChannel()
            } catch (e: Exception) {
                logger.log(Level.WARNING, "Failed to leave voice channel", e)
            }
        }
    }

    /** Toggles the local microphone mute state. */
    fun onToggleMute() {
        voiceRepository.toggleMute()
    }

    /** Switches the audio output route (speaker, earpiece, bluetooth, wired headset). */
    fun onSwitchAudioRoute(route: AudioRoute) {
        audioRouteManager.switchRoute(route)
    }

    public override fun onCleared() {
        // Leave the channel when the ViewModel is destroyed
        viewModelScope.launch {
            try {
                voiceRepository.leaveChannel()
            } catch (e: Exception) {
                logger.log(Level.WARNING, "Failed to leave voice channel on clear", e)
            }
        }
        super.onCleared()
    }
}
