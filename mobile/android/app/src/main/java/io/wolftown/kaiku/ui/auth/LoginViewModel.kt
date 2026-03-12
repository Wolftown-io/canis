package io.wolftown.kaiku.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.wolftown.kaiku.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val mfaCode: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val mfaRequired: Boolean = false,
    val loginSuccess: Boolean = false
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onUsernameChanged(username: String) {
        _uiState.update { it.copy(username = username) }
    }

    fun onPasswordChanged(password: String) {
        _uiState.update { it.copy(password = password) }
    }

    fun onMfaCodeChanged(code: String) {
        _uiState.update { it.copy(mfaCode = code) }
    }

    fun onLoginClicked() {
        val state = _uiState.value
        _uiState.update { it.copy(isLoading = true, error = null) }

        viewModelScope.launch {
            val mfaCode = state.mfaCode.ifBlank { null }
            val result = authRepository.login(state.username, state.password, mfaCode)

            result.fold(
                onSuccess = {
                    _uiState.update {
                        it.copy(isLoading = false, loginSuccess = true)
                    }
                },
                onFailure = { exception ->
                    if (exception is MfaRequiredException) {
                        _uiState.update {
                            it.copy(isLoading = false, mfaRequired = true)
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                error = exception.message ?: "Login failed"
                            )
                        }
                    }
                }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
