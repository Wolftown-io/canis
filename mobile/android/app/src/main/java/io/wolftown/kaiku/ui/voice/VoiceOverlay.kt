package io.wolftown.kaiku.ui.voice

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Compact bar shown at the bottom of other screens when the user is in a voice channel.
 *
 * Height: 56dp with accent background.
 * Shows: "Connected to #channel-name"
 * Actions: mute toggle, tap to navigate, disconnect
 */
@Composable
fun VoiceOverlay(
    channelName: String,
    isMuted: Boolean,
    onMuteToggle: () -> Unit,
    onTap: () -> Unit,
    onDisconnect: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clickable(onClick = onTap),
        color = MaterialTheme.colorScheme.primaryContainer,
        tonalElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Channel info
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = "Connected to #$channelName",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    maxLines = 1
                )
            }

            // Mute toggle
            IconButton(onClick = onMuteToggle) {
                Text(
                    text = if (isMuted) "🔇" else "🎤",
                    style = MaterialTheme.typography.titleMedium
                )
            }

            // Disconnect
            IconButton(onClick = onDisconnect) {
                Icon(
                    imageVector = Icons.Default.Call,
                    contentDescription = "Disconnect",
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}
