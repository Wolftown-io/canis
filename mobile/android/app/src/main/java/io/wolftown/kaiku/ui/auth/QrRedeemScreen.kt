package io.wolftown.kaiku.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun QrRedeemScreen(
    serverUrl: String,
    token: String,
    onSuccess: () -> Unit,
    onError: () -> Unit
) {
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    val viewModel: QrRedeemViewModel = hiltViewModel()

    LaunchedEffect(Unit) {
        val result = viewModel.redeem(serverUrl, token)
        if (result.isSuccess) {
            onSuccess()
        } else {
            isLoading = false
            error = result.exceptionOrNull()?.message ?: "QR code expired or already used"
        }
    }

    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        if (isLoading) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(16.dp))
                Text("Signing in...", style = MaterialTheme.typography.bodyLarge)
            }
        } else if (error != null) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = error ?: "An error occurred",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyLarge
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(onClick = onError) {
                    Text("Go back")
                }
            }
        }
    }
}
