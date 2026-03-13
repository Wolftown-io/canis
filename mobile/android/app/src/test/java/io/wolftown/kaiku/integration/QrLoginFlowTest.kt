package io.wolftown.kaiku.integration

import io.mockk.*
import io.wolftown.kaiku.data.api.AuthApi
import io.wolftown.kaiku.data.local.AuthState
import io.wolftown.kaiku.data.local.TokenStorage
import io.wolftown.kaiku.data.repository.AuthRepository
import io.wolftown.kaiku.domain.model.AuthResponse
import io.wolftown.kaiku.domain.model.User
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Integration test verifying the QR code login flow:
 * scan QR → redeem token → store server URL + tokens → auth state update.
 *
 * Uses mocked server responses but real AuthState and AuthRepository logic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QrLoginFlowTest {

    private lateinit var authApi: AuthApi
    private lateinit var tokenStorage: TokenStorage
    private lateinit var authState: AuthState
    private lateinit var authRepository: AuthRepository

    private val testUser = User(
        id = "user-42",
        username = "testuser",
        displayName = "Test User"
    )

    private val testAuthResponse = AuthResponse(
        accessToken = "qr-access-token-abc",
        refreshToken = "qr-refresh-token-xyz",
        expiresIn = 900,
        tokenType = "Bearer"
    )

    private val testServerUrl = "https://kaiku.example.com"
    private val testToken = "qr-token-abc123"

    @Before
    fun setUp() {
        authApi = mockk()
        tokenStorage = mockk(relaxed = true)
        authState = AuthState()

        authRepository = AuthRepository(authApi, tokenStorage, authState)
    }

    // ========================================================================
    // QR redeem success
    // ========================================================================

    @Test
    fun `QR redeem stores server URL, tokens, and sets auth state to logged in`() = runTest {
        coEvery { authApi.redeemQrToken(testServerUrl, testToken) } returns testAuthResponse
        coEvery { authApi.getMe() } returns testUser

        val result = authRepository.redeemQrToken(testServerUrl, testToken)

        assertTrue(result.isSuccess)
        assertEquals(testUser, result.getOrNull())

        // Verify tokens were saved (twice: once before getMe, once after with userId)
        verify(exactly = 2) {
            tokenStorage.saveTokens(
                accessToken = "qr-access-token-abc",
                refreshToken = "qr-refresh-token-xyz",
                expiresIn = 900,
                userId = any()
            )
        }

        // Server URL and final tokens must be saved AFTER getMe succeeds
        verifyOrder {
            tokenStorage.saveTokens(
                accessToken = "qr-access-token-abc",
                refreshToken = "qr-refresh-token-xyz",
                expiresIn = 900,
                userId = ""
            )
            tokenStorage.saveServerUrl(testServerUrl)
            tokenStorage.saveTokens(
                accessToken = "qr-access-token-abc",
                refreshToken = "qr-refresh-token-xyz",
                expiresIn = 900,
                userId = "user-42"
            )
        }

        // Auth state should be logged in
        assertTrue(authState.isLoggedIn.value)
        assertEquals("user-42", authState.currentUserId.value)
    }

    // ========================================================================
    // QR redeem partial success (redeem OK, getMe fails)
    // ========================================================================

    @Test
    fun `QR redeem cleans up when getMe fails after successful redeem`() = runTest {
        coEvery { authApi.redeemQrToken(testServerUrl, testToken) } returns testAuthResponse
        coEvery { authApi.getMe() } throws RuntimeException("getMe failed")

        val result = authRepository.redeemQrToken(testServerUrl, testToken)

        assertTrue(result.isFailure)
        // Server URL should NOT be saved (deferred to after getMe in Task 8)
        verify(exactly = 0) { tokenStorage.saveServerUrl(any()) }
        // Tokens should be cleared
        verify { tokenStorage.clear() }
        // Auth state should remain logged out
        assertFalse(authState.isLoggedIn.value)
    }

    // ========================================================================
    // QR redeem with expired token
    // ========================================================================

    @Test
    fun `QR redeem with expired token fails without updating auth state`() = runTest {
        coEvery {
            authApi.redeemQrToken(testServerUrl, testToken)
        } throws Exception("QR code expired or already used")

        val result = authRepository.redeemQrToken(testServerUrl, testToken)

        assertTrue(result.isFailure)
        assertEquals("QR code expired or already used", result.exceptionOrNull()?.message)

        // Server URL should NOT be saved on failure (saved after API call)
        verify(exactly = 0) { tokenStorage.saveServerUrl(any()) }

        // No tokens should be saved
        verify(exactly = 0) { tokenStorage.saveTokens(any(), any(), any(), any()) }

        // Partial state should be cleaned up
        verify { tokenStorage.clear() }

        // Auth state should remain logged out
        assertFalse(authState.isLoggedIn.value)
        assertNull(authState.currentUserId.value)
    }
}
