package io.wolftown.kaiku.ui.voice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.wolftown.kaiku.data.repository.VoiceRepository
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.logging.Level
import java.util.logging.Logger
import javax.inject.Inject

/**
 * Thin ViewModel for the [VoiceOverlay] bar.
 *
 * Provides voice state (current channel, mute status) to the navigation
 * scaffold so the overlay persists across screen navigation.
 */
@HiltViewModel
class VoiceOverlayViewModel @Inject constructor(
    private val voiceRepository: VoiceRepository
) : ViewModel() {

    companion object {
        private val logger = Logger.getLogger("VoiceOverlayViewModel")
    }

    val currentChannelId: StateFlow<String?> = voiceRepository.currentChannelId
    val isMuted: StateFlow<Boolean> = voiceRepository.isMuted

    fun onToggleMute() {
        voiceRepository.toggleMute()
    }

    fun onDisconnect() {
        viewModelScope.launch {
            try {
                voiceRepository.leaveChannel()
            } catch (e: Exception) {
                logger.log(Level.WARNING, "Failed to disconnect from voice", e)
            }
        }
    }
}
