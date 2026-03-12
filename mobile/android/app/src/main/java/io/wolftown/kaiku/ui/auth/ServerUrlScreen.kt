package io.wolftown.kaiku.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.wolftown.kaiku.data.local.TokenStorage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

data class ServerUrlUiState(
    val url: String = "",
    val error: String? = null,
    val connectSuccess: Boolean = false
)

@HiltViewModel
class ServerUrlViewModel @Inject constructor(
    private val tokenStorage: TokenStorage
) : ViewModel() {

    private val _uiState = MutableStateFlow(ServerUrlUiState())
    val uiState: StateFlow<ServerUrlUiState> = _uiState.asStateFlow()

    fun onUrlChanged(url: String) {
        _uiState.update { it.copy(url = url, error = null) }
    }

    fun onConnectClicked() {
        val url = _uiState.value.url.trim()

        if (!isValidUrl(url)) {
            _uiState.update {
                it.copy(error = "URL must start with https:// or http://")
            }
            return
        }

        // Remove trailing slash for consistency
        val normalizedUrl = url.trimEnd('/')
        tokenStorage.saveServerUrl(normalizedUrl)
        _uiState.update { it.copy(connectSuccess = true) }
    }

    private fun isValidUrl(url: String): Boolean {
        return url.startsWith("https://") || url.startsWith("http://")
    }
}

@Composable
fun ServerUrlScreen(
    onConnectSuccess: () -> Unit,
    viewModel: ServerUrlViewModel = androidx.hilt.navigation.compose.hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(uiState.connectSuccess) {
        if (uiState.connectSuccess) {
            onConnectSuccess()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Welcome to Kaiku",
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Enter your server address to get started",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = uiState.url,
            onValueChange = viewModel::onUrlChanged,
            label = { Text("Server URL") },
            placeholder = { Text("https://chat.example.com") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Uri,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(
                onDone = { viewModel.onConnectClicked() }
            ),
            isError = uiState.error != null,
            supportingText = if (uiState.error != null) {
                { Text(uiState.error!!) }
            } else {
                null
            },
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = viewModel::onConnectClicked,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Connect")
        }
    }
}
