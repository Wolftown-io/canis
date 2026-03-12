package io.wolftown.kaiku.ui.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.wolftown.kaiku.data.voice.AudioRoute
import io.wolftown.kaiku.data.ws.ScreenShareInfo
import io.wolftown.kaiku.data.ws.VoiceParticipant

/**
 * Full-screen voice channel view.
 *
 * Layout:
 * - Top bar with channel name and back button (leaves voice on back)
 * - Screen share area (placeholder, shown when active)
 * - Participant grid: 2-column LazyVerticalGrid
 * - Bottom bar: mute toggle, audio route picker, disconnect button
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceChannelScreen(
    channelName: String,
    onNavigateBack: () -> Unit,
    viewModel: VoiceViewModel = hiltViewModel()
) {
    val participants by viewModel.participants.collectAsState()
    val isMuted by viewModel.isMuted.collectAsState()
    val isConnected by viewModel.isConnected.collectAsState()
    val screenShares by viewModel.screenShares.collectAsState()
    val currentRoute by viewModel.currentRoute.collectAsState()
    val availableRoutes by viewModel.availableRoutes.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("#$channelName") },
                navigationIcon = {
                    IconButton(onClick = {
                        viewModel.onLeave()
                        onNavigateBack()
                    }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Leave and go back"
                        )
                    }
                }
            )
        },
        bottomBar = {
            VoiceBottomBar(
                isMuted = isMuted,
                currentRoute = currentRoute,
                availableRoutes = availableRoutes,
                onToggleMute = viewModel::onToggleMute,
                onSwitchRoute = viewModel::onSwitchAudioRoute,
                onDisconnect = {
                    viewModel.onLeave()
                    onNavigateBack()
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Screen share area (placeholder for Task 12)
            if (screenShares.isNotEmpty()) {
                ScreenSharePlaceholder(screenShares = screenShares)
            }

            // Connection status
            if (!isConnected) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Participant grid
            if (participants.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No one else is here yet",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    modifier = Modifier
                        .fillMaxSize()
                        .weight(1f),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(participants, key = { it.userId }) { participant ->
                        ParticipantCard(participant = participant)
                    }
                }
            }
        }
    }
}

@Composable
private fun ParticipantCard(participant: VoiceParticipant) {
    val isSpeaking = !participant.muted
    val borderColor = if (isSpeaking) {
        MaterialTheme.colorScheme.primary
    } else {
        Color.Transparent
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Avatar circle
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.2f))
                    .border(
                        width = if (isSpeaking) 3.dp else 0.dp,
                        color = borderColor,
                        shape = CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = (participant.displayName ?: participant.username ?: "?")
                        .take(1)
                        .uppercase(),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Display name
            Text(
                text = participant.displayName ?: participant.username ?: "Unknown",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center
            )

            // Mute indicator
            if (participant.muted) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Muted",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ScreenSharePlaceholder(screenShares: List<ScreenShareInfo>) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp)
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.Share,
                    contentDescription = "Screen share",
                    modifier = Modifier.size(32.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "${screenShares.size} screen share(s) active",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                screenShares.firstOrNull()?.let { share ->
                    Text(
                        text = "${share.username} sharing: ${share.sourceLabel}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun VoiceBottomBar(
    isMuted: Boolean,
    currentRoute: AudioRoute,
    availableRoutes: Set<AudioRoute>,
    onToggleMute: () -> Unit,
    onSwitchRoute: (AudioRoute) -> Unit,
    onDisconnect: () -> Unit
) {
    var showRouteMenu by remember { mutableStateOf(false) }

    Surface(
        tonalElevation = 3.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Mute/unmute toggle
            FilledIconToggleButton(
                checked = isMuted,
                onCheckedChange = { onToggleMute() }
            ) {
                if (isMuted) {
                    Text("🔇", style = MaterialTheme.typography.titleLarge)
                } else {
                    Text("🎤", style = MaterialTheme.typography.titleLarge)
                }
            }

            // Audio route picker
            Box {
                IconButton(onClick = { showRouteMenu = true }) {
                    Text(
                        text = when (currentRoute) {
                            AudioRoute.Speaker -> "🔊"
                            AudioRoute.Earpiece -> "📱"
                            AudioRoute.Bluetooth -> "🎧"
                            AudioRoute.WiredHeadset -> "🎧"
                        },
                        style = MaterialTheme.typography.titleLarge
                    )
                }

                DropdownMenu(
                    expanded = showRouteMenu,
                    onDismissRequest = { showRouteMenu = false }
                ) {
                    availableRoutes.forEach { route ->
                        DropdownMenuItem(
                            text = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = when (route) {
                                            AudioRoute.Speaker -> "🔊 Speaker"
                                            AudioRoute.Earpiece -> "📱 Earpiece"
                                            AudioRoute.Bluetooth -> "🎧 Bluetooth"
                                            AudioRoute.WiredHeadset -> "🎧 Wired Headset"
                                        }
                                    )
                                    if (route == currentRoute) {
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = "✓",
                                            color = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                }
                            },
                            onClick = {
                                onSwitchRoute(route)
                                showRouteMenu = false
                            }
                        )
                    }
                }
            }

            // Disconnect button
            FilledIconButton(
                onClick = onDisconnect,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError
                )
            ) {
                Icon(
                    imageVector = Icons.Default.Call,
                    contentDescription = "Disconnect"
                )
            }
        }
    }
}
