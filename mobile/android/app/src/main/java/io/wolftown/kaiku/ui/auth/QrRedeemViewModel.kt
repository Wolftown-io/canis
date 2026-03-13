package io.wolftown.kaiku.ui.auth

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.wolftown.kaiku.data.repository.AuthRepository
import io.wolftown.kaiku.domain.model.User
import javax.inject.Inject

@HiltViewModel
class QrRedeemViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    suspend fun redeem(serverUrl: String, token: String): Result<User> {
        return authRepository.redeemQrToken(serverUrl, token)
    }
}
