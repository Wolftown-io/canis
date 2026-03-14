# PR #363 Review Round 2 Fixes — Implementation Plan


**Goal:** Fix all critical, important, and suggestion-level issues from the comprehensive round-2 review of PR #363 (Android M1 + QR login).

**Architecture:** Fixes are grouped by affected layer/file to minimize commits. Each task is a coherent set of related changes. No new features — only correctness, safety, type alignment, and comment accuracy.

**Tech Stack:** Kotlin/Compose (Android), Rust (server). No Android SDK/JDK available locally — verify by code review only.

**Note on Critical 4 (unknown ServerEvent types):** `KaikuWebSocket.onMessage` (line 160) already wraps `json.decodeFromString<ServerEvent>(text)` in a try-catch that logs and drops unknown events. The WebSocket connection does NOT crash. No action needed for M1.

---

### Task 1: Fix wire-format mismatches and MFA error code

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/User.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/Channel.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/ws/ServerEvent.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/settings/SettingsScreen.kt` (if status display uses enum names)
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/domain/model/SerializationTest.kt`
- Modify: Any files comparing `ChannelType.ANNOUNCEMENT`

**Step 1: Fix MFA error code case**

In `AuthApi.kt` line 87, change:
```kotlin
if (errorBody.error == "mfa_required") {
```
To:
```kotlin
if (errorBody.error == "MFA_REQUIRED") {
```
The server sends `"MFA_REQUIRED"` (uppercase) per `server/src/auth/error.rs` line 131.

**Step 2: Fix UserStatus wire names**

In `User.kt`, the server sends `"away"` and `"busy"` (per `server/src/db/models.rs`), not `"idle"` and `"dnd"`. Change:
```kotlin
@Serializable
enum class UserStatus {
    @SerialName("online") ONLINE,
    @SerialName("away") IDLE,
    @SerialName("busy") DND,
    @SerialName("offline") OFFLINE;
}
```
Keep the Kotlin names `IDLE`/`DND` for code readability — only the `@SerialName` wire values change.

**Step 3: Fix ChannelType — replace ANNOUNCEMENT with DM**

In `Channel.kt`, the server has `{text, voice, dm}` — no `announcement`. Change:
```kotlin
@Serializable
enum class ChannelType {
    @SerialName("text") TEXT,
    @SerialName("voice") VOICE,
    @SerialName("dm") DM;
}
```

Search the codebase for all references to `ChannelType.ANNOUNCEMENT` and remove/replace them. If any code filters announcements, remove that filter. Check:
- `ChannelList.kt`
- `HomeScreen.kt`
- `HomeViewModel.kt`

**Step 4: Promote PresenceUpdate.status to UserStatus**

In `ServerEvent.kt` line 89, change:
```kotlin
data class PresenceUpdate(val userId: String, val status: String) : ServerEvent()
```
To:
```kotlin
data class PresenceUpdate(val userId: String, val status: UserStatus) : ServerEvent()
```
Add import: `import io.wolftown.kaiku.domain.model.UserStatus`

Update any consumers of `PresenceUpdate.status` that compare against strings.

**Step 5: Update tests**

In `SerializationTest.kt`:
- Update any test using `"away"` / `"busy"` / `"idle"` / `"dnd"` to use the correct wire values
- Update any test using `ChannelType.ANNOUNCEMENT` to `ChannelType.DM`
- Update `ServerEventParsingTest.kt` if it tests `PresenceUpdate` with a raw String status

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/User.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/Channel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/ws/ServerEvent.kt
# Also add all files with updated ChannelType/UserStatus references and tests
git commit -m "fix(client): align ChannelType, UserStatus, and MFA error code with server wire format"
```

---

### Task 2: Fix CancellationException in VoiceRepository.joinChannel

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/VoiceRepository.kt`

**Step 1: Add CancellationException re-throw**

At line 138, add the CancellationException catch before the generic catch:

```kotlin
        } catch (e: CancellationException) {
            cleanUp()
            throw e
        } catch (e: Exception) {
            logger.log(Level.SEVERE, "Failed to join voice channel: $channelId", e)
            cleanUp()
            throw e
        }
```

Add import: `import kotlinx.coroutines.CancellationException` (if not already present).

**Step 2: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/VoiceRepository.kt
git commit -m "fix(voice): re-throw CancellationException in VoiceRepository.joinChannel"
```

---

### Task 3: Fix QR scanner — URL validation, thread safety, ML Kit logging

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrScannerScreen.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/ServerUrlScreen.kt`

**Step 1: Expand parseKaikuQrUri private network allowlist**

In `QrScannerScreen.kt` lines 211-215, replace the HTTP validation block:

```kotlin
    // Enforce HTTPS for production; allow HTTP only for local development
    if (!server.startsWith("https://")) {
        val host = android.net.Uri.parse(server).host ?: return null
        val isLocal = host == "localhost" ||
            host.startsWith("127.") ||
            host.startsWith("10.") ||
            host.startsWith("192.168.") ||
            Regex("^172\\.(1[6-9]|2[0-9]|3[0-1])\\.").containsMatchIn(host)
        if (!isLocal) return null
    }
```

**Step 2: Update parseKaikuQrUri KDoc**

Change line 201-203:
```kotlin
/**
 * Parses a `kaiku://qr/login?server=...&token=...` URI.
 * Returns (serverUrl, token) or null if the URI format doesn't match
 * or the server URL fails HTTPS validation (HTTP allowed only for
 * localhost and RFC 1918 private networks).
 */
```

**Step 3: Replace hasScanned with AtomicBoolean**

At line 44, change:
```kotlin
var hasScanned by remember { mutableStateOf(false) }
```
To:
```kotlin
val hasScanned = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
```

Update all reads/writes:
- Line 122: `if (mediaImage != null && !hasScanned.get()) {`
- Line 135: `if (parsed != null && hasScanned.compareAndSet(false, true)) {`
  - `compareAndSet` makes the dedup atomic — removes the race window

Remove the `hasScanned` check at line 135 and use `compareAndSet` instead:
```kotlin
if (parsed != null && hasScanned.compareAndSet(false, true)) {
    onQrScanned(parsed.first, parsed.second)
}
```

**Step 4: Add ML Kit failure logging**

At line 142-145, replace the empty failure handler:
```kotlin
.addOnFailureListener { e ->
    logger.log(Level.FINE, "Frame analysis failed", e)
}
```

Add a logger to the composable's scope if not present (use `remember`):
```kotlin
val logger = remember { Logger.getLogger("QrScannerScreen") }
```

**Step 5: Add HTTPS enforcement to ServerUrlScreen**

In `ServerUrlScreen.kt` (the ViewModel), change `isValidUrl` at line 56-58:

```kotlin
private fun isValidUrl(url: String): Boolean {
    if (url.startsWith("https://")) return true
    if (!url.startsWith("http://")) return false
    // Allow HTTP only for local development addresses
    val host = android.net.Uri.parse(url).host ?: return false
    return host == "localhost" ||
        host.startsWith("127.") ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        Regex("^172\\.(1[6-9]|2[0-9]|3[0-1])\\.").containsMatchIn(host)
}
```

Also update the error message at line 45:
```kotlin
it.copy(error = "URL must use HTTPS (HTTP allowed only for local development)")
```

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrScannerScreen.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/ServerUrlScreen.kt
git commit -m "fix(client): expand private network allowlist, enforce HTTPS in ServerUrlScreen, fix QR thread safety"
```

---

### Task 4: Fix token storage — null refreshToken, empty userId, AuthState validation

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/AuthState.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt`
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt` (if assertions change)

**Step 1: Fix TokenStorage null refreshToken handling**

In `TokenStorage.kt` line 29, change:
```kotlin
.putString(KEY_REFRESH_TOKEN, refreshToken ?: "")
```
To:
```kotlin
.apply { if (refreshToken != null) putString(KEY_REFRESH_TOKEN, refreshToken) else remove(KEY_REFRESH_TOKEN) }
```

This stores `null` (absent key) instead of empty string `""` when no refresh token exists. `getRefreshToken()` already returns `null` for absent keys via `getString(KEY_REFRESH_TOKEN, null)`.

**Step 2: Fix getRefreshToken to handle legacy empty strings**

Add a null-or-empty check for backward compatibility with previously stored empty strings:

```kotlin
fun getRefreshToken(): String? {
    val token = prefs.getString(KEY_REFRESH_TOKEN, null)
    return if (token.isNullOrEmpty()) null else token
}
```

**Step 3: Add require(isNotBlank) in AuthState.setLoggedIn**

In `AuthState.kt` line 31:
```kotlin
fun setLoggedIn(userId: String) {
    require(userId.isNotBlank()) { "userId must not be blank" }
    _session.value = AuthSession.LoggedIn(userId)
}
```

**Step 4: Fix AuthState.initialize comment**

Replace lines 39-44:
```kotlin
    /**
     * Restores auth state from persisted tokens on app start.
     *
     * If valid tokens exist (non-expired, or expired with a refresh token
     * available), the user is considered logged in — the HTTP interceptor
     * will refresh the token transparently on the first API call.
     */
```

**Step 5: Fix AuthRepository empty userId pattern**

In all auth flow methods (`login`, `register`, `completeOidcLogin`, `exchangeOidcCode`, `redeemQrToken`), the first `saveTokens` call uses `userId = ""`. Since `AuthState.setLoggedIn` now requires non-blank, and the flow calls `setLoggedIn` only after `getMe` succeeds (with real userId), the empty userId in `saveTokens` is only a storage concern — not an AuthState concern.

However, if the app crashes between the two `saveTokens` calls, on restart `AuthState.initialize` will call `tokenStorage.getUserId()` which returns `""`, and then `setLoggedIn("")` which will now throw. To fix this, skip login initialization when userId is blank:

In `AuthState.kt` `initialize`, line 51, change:
```kotlin
if (token != null && userId != null) {
```
To:
```kotlin
if (token != null && !userId.isNullOrBlank()) {
```

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/AuthState.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt
# Add test files if modified
git commit -m "fix(client): handle null refreshToken properly, validate AuthState userId, guard empty userId on crash recovery"
```

---

### Task 5: Fix WebRtcManager thread safety and error feedback

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt`

**Step 1: Add @Volatile to callback properties**

At lines 87-96, add `@Volatile` to all four callback vars:
```kotlin
@Volatile var onLocalDescription: ((String) -> Unit)? = null
@Volatile var onIceCandidate: ((String) -> Unit)? = null
@Volatile var onTrackAdded: ((MediaStreamTrack) -> Unit)? = null
@Volatile var onError: ((String) -> Unit)? = null
```

**Step 2: Add error feedback in handleOffer/addIceCandidate null PeerConnection cases**

At line 211 (inside the `peerConnection ?: run` block in `handleOffer`):
```kotlin
val pc = peerConnection ?: run {
    logger.warning("handleOffer called but PeerConnection is null")
    onError?.invoke("Voice connection error: not initialized")
    return
}
```

At line 246 (inside the `peerConnection ?: run` block in `addIceCandidate`):
```kotlin
val pc = peerConnection ?: run {
    logger.warning("addIceCandidate called but PeerConnection is null")
    onError?.invoke("Voice connection error: not initialized")
    return
}
```

**Step 3: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt
git commit -m "fix(voice): add @Volatile to WebRtcManager callbacks and propagate null PeerConnection errors"
```

---

### Task 6: Fix KaikuHttpClient refresh — distinguish network vs auth errors

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/KaikuHttpClient.kt`

**Step 1: Return a tri-state from performRefresh**

Currently `performRefresh` returns `Boolean`. Change to distinguish between "auth rejected" (should log out) and "network error" (should NOT log out).

Change `performRefresh` return type and logic:

```kotlin
private enum class RefreshResult { SUCCESS, AUTH_REJECTED, NETWORK_ERROR }

private suspend fun Sender.performRefresh(refreshToken: String): RefreshResult {
    return try {
        // ... existing request setup code unchanged ...

        if (status == HttpStatusCode.Unauthorized || status == HttpStatusCode.Forbidden) {
            return RefreshResult.AUTH_REJECTED
        }
        if (!status.isSuccess()) {
            return RefreshResult.NETWORK_ERROR
        }

        // ... existing token save code unchanged ...
        RefreshResult.SUCCESS
    } catch (e: kotlin.coroutines.cancellation.CancellationException) {
        throw e
    } catch (e: Exception) {
        logger.log(Level.WARNING, "Token refresh failed", e)
        RefreshResult.NETWORK_ERROR
    }
}
```

Then in the interceptor at line 127-130, only log out on auth rejection:
```kotlin
val refreshResult = refreshMutex.withLock {
    val currentToken = tokenStorage.getAccessToken()
    if (currentToken != null && currentToken != tokenUsedInRequest) {
        RefreshResult.SUCCESS
    } else {
        performRefresh(refreshToken)
    }
}

if (refreshResult != RefreshResult.SUCCESS) {
    if (refreshResult == RefreshResult.AUTH_REJECTED) {
        authState.setLoggedOut()
    }
    return@intercept originalCall
}
```

Note: On NETWORK_ERROR, we return the original 401 response without logging out. The next request will retry the refresh.

**Step 2: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/KaikuHttpClient.kt
git commit -m "fix(client): distinguish network vs auth errors in token refresh — don't logout on transient failures"
```

---

### Task 7: Fix silent failures — OidcHandler, WebSocket reconnect, HomeViewModel

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/OidcHandler.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/LoginViewModel.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/ws/KaikuWebSocket.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/home/HomeViewModel.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/AudioRouteManager.kt`

**Step 1: Fix OidcHandler.launchOidcLogin — return success/failure**

Change from `void` to returning a boolean or throwing, so the caller can show an error. Simplest approach — throw on failure:

```kotlin
fun launchOidcLogin(context: Context, providerSlug: String) {
    val serverUrl = tokenStorage.getServerUrl()
    if (serverUrl == null) {
        logger.log(Level.WARNING, "Cannot launch OIDC login: server URL not configured")
        throw IllegalStateException("Server URL not configured")
    }
    val authUrl = "$serverUrl/auth/oidc/authorize/$providerSlug" +
        "?redirect_uri=${Uri.encode(REDIRECT_URI)}"
    try {
        val customTabIntent = CustomTabsIntent.Builder().build()
        customTabIntent.launchUrl(context, Uri.parse(authUrl))
    } catch (e: Exception) {
        logger.log(Level.WARNING, "Failed to launch OIDC login", e)
        throw e
    }
}
```

**Step 2: Handle OidcHandler error in LoginViewModel**

In `LoginViewModel.kt` line 132-133:
```kotlin
fun launchOidcLogin(context: Context, providerSlug: String) {
    try {
        oidcHandler.launchOidcLogin(context, providerSlug)
    } catch (e: Exception) {
        _uiState.update {
            it.copy(error = e.message ?: "Failed to launch OIDC login")
        }
    }
}
```

**Step 3: Fix KaikuWebSocket.doConnect — stop reconnect when no tokens**

In `KaikuWebSocket.kt` line 123-128:
```kotlin
private fun doConnect() {
    val url = serverUrl ?: run {
        logger.warning("No server URL configured, stopping reconnect")
        shouldReconnect = false
        return
    }
    val token = tokenStorage.getAccessToken() ?: run {
        logger.warning("No access token available, stopping reconnect")
        shouldReconnect = false
        _connectionState.value = ConnectionState.Disconnected
        return
    }
```

Setting `shouldReconnect = false` prevents the reconnect loop from spinning indefinitely.

**Step 4: Fix HomeViewModel.connectWebSocket silent return**

In `HomeViewModel.kt` line 74-77:
```kotlin
private fun connectWebSocket() {
    val serverUrl = tokenStorage.getServerUrl() ?: run {
        logger.warning("Server URL not configured, cannot connect WebSocket")
        return
    }
    webSocket.connect(serverUrl)
}
```

Add a logger if not present: `private val logger = Logger.getLogger("HomeViewModel")`

**Step 5: Fix AudioRouteManager silent SecurityException**

In `AudioRouteManager.kt` line 202-204:
```kotlin
} catch (e: SecurityException) {
    logger.warning("Bluetooth permission missing, skipping Bluetooth audio route")
    false
}
```

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/OidcHandler.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/LoginViewModel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/ws/KaikuWebSocket.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/home/HomeViewModel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/AudioRouteManager.kt
git commit -m "fix(client): add error feedback to OidcHandler, stop WS reconnect without tokens, log silent failures"
```

---

### Task 8: Fix AuthRepository.redeemQrToken save order

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt`
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt`

**Step 1: Move saveServerUrl to after getMe succeeds**

In `AuthRepository.kt` `redeemQrToken`, move `saveServerUrl` from before `getMe` to after the second `saveTokens`:

```kotlin
suspend fun redeemQrToken(serverUrl: String, token: String): Result<User> {
    return try {
        val authResponse = authApi.redeemQrToken(serverUrl, token)

        tokenStorage.saveTokens(
            accessToken = authResponse.accessToken,
            refreshToken = authResponse.refreshToken,
            expiresIn = authResponse.expiresIn,
            userId = ""
        )

        val user = authApi.getMe()

        // Save server URL and tokens with correct userId only after full success
        tokenStorage.saveServerUrl(serverUrl)
        tokenStorage.saveTokens(
            accessToken = authResponse.accessToken,
            refreshToken = authResponse.refreshToken,
            expiresIn = authResponse.expiresIn,
            userId = user.id
        )

        authState.setLoggedIn(user.id)
        Result.success(user)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        tokenStorage.clear()
        Result.failure(e)
    }
}
```

Update the doc comment accordingly.

**Step 2: Update QrLoginFlowTest**

The success test likely verifies `saveServerUrl` is called. Verify the assertion still holds (it should — `saveServerUrl` is still called on success, just later). If the test checks call ordering, update it.

**Step 3: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt \
       mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt
git commit -m "fix(auth): move saveServerUrl to after getMe succeeds in redeemQrToken"
```

---

### Task 9: Fix inaccurate comments

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/voice/ScreenShareView.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/ChatRepository.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/voice/VoiceViewModel.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/ws/KaikuWebSocket.kt`

**Step 1: Fix exchangeOidcCode comment (AuthApi.kt lines 165-168)**

Replace:
```kotlin
        // The server's OIDC callback is GET /auth/oidc/callback?code=...&state=...
        // The server handles the code exchange internally and returns/redirects with tokens.
        // For the mobile flow, the server redirects to kaiku://auth/callback with tokens
        // in query params, so this method is used as a fallback POST exchange if needed.
```
With:
```kotlin
        // Fallback: call the server's OIDC callback directly via GET.
        // The server exchanges the authorization code internally and returns tokens.
```

**Step 2: Fix ScreenShareView comments (lines 38-44, 62)**

Remove the hypothetical test list (lines 38-44):
```kotlin
 * Tapping the view toggles the overlay controls visibility.
 */
```

Fix the click handler comment (line 62):
```kotlin
            .clickable {
                // Toggle overlay controls visibility
                showControls = !showControls
            }
```

**Step 3: Fix ChatRepository class doc**

Update the class doc to note reactions are received but not displayed:
```kotlin
 * Processes real-time WebSocket events (new/edit/delete, typing).
 * Reactions are received but not yet reflected in the UI.
```

**Step 4: Fix VoiceViewModel.onCleared comment (line 112)**

Change:
```kotlin
// Use NonCancellable since viewModelScope is already cancelled at this point
```
To:
```kotlin
// Use NonCancellable because viewModelScope is being cancelled during onCleared
```

**Step 5: Fix KaikuWebSocket class doc ping/pong (line 40)**

Change `"Automatic ping/pong heartbeat (30s interval)"` to:
```kotlin
 * - Automatic application-level heartbeat (30s interval)
```

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/voice/ScreenShareView.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/ChatRepository.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/voice/VoiceViewModel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/ws/KaikuWebSocket.kt
git commit -m "docs(client): fix inaccurate comments — OIDC method, ScreenShareView, ping/pong, lifecycle"
```

---

### Task 10: Improve tests — register failure, QR partial success, WebRtc mute, WS sleep

**Files:**
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/integration/AuthFlowTest.kt`
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt`
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/data/voice/WebRtcManagerTest.kt`
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/data/ws/KaikuWebSocketTest.kt`

**Step 1: Add register failure cleanup test in AuthFlowTest.kt**

Add a test that verifies `tokenStorage.clear()` is called when `getMe` fails after successful registration:

```kotlin
@Test
fun `register cleans up tokens when getMe fails`() = runTest {
    coEvery { authApi.register(any(), any(), any(), any()) } returns AuthResponse(
        accessToken = "access", refreshToken = "refresh",
        expiresIn = 900, tokenType = "Bearer"
    )
    coEvery { authApi.getMe() } throws RuntimeException("Network error")

    val result = authRepository.register("user", "pass", null, null)

    assertTrue(result.isFailure)
    verify { tokenStorage.clear() }
}
```

**Step 2: Add QR partial success test in QrLoginFlowTest.kt**

Test the scenario where redeem succeeds but `getMe` fails:

```kotlin
@Test
fun `QR redeem cleans up when getMe fails after successful redeem`() = runTest {
    coEvery { authApi.redeemQrToken(any(), any()) } returns AuthResponse(
        accessToken = "access", refreshToken = "refresh",
        expiresIn = 900, tokenType = "Bearer"
    )
    coEvery { authApi.getMe() } throws RuntimeException("getMe failed")

    val result = authRepository.redeemQrToken(testServerUrl, testToken)

    assertTrue(result.isFailure)
    // Server URL should NOT be saved (moved to after getMe)
    verify(exactly = 0) { tokenStorage.saveServerUrl(any()) }
    // Tokens should be cleared
    verify { tokenStorage.clear() }
    // Auth state should remain logged out
    assertFalse(authState.isLoggedIn.value)
}
```

**Step 3: Fix WebRtcManagerTest mute tests**

The existing mute tests just test boolean variables, not the actual `WebRtcManager.isMuted`. Replace with tests that exercise the real field:

```kotlin
@Test
fun `isMuted is false by default`() {
    assertFalse(webRtcManager.isMuted)
}
```

Remove the tests that just toggle local booleans (they test nothing). If `setMuted` requires Android runtime, document that these tests need Robolectric and leave a `// TODO: requires Robolectric` comment.

**Step 4: Fix KaikuWebSocketTest Thread.sleep**

Replace `Thread.sleep(500)` with a mechanism that waits for the actual event. If the test framework has `advanceUntilIdle()` or similar, use that. Otherwise use a `CountDownLatch`:

```kotlin
val latch = CountDownLatch(1)
// ... set up mock to count down on send ...
assertTrue(latch.await(2, TimeUnit.SECONDS), "Message should be sent within 2s")
```

Alternatively, if the send is synchronous in the mock setup, the sleep may not be needed at all — check if removing it still passes.

**Step 5: Commit**

```bash
git add mobile/android/app/src/test/java/io/wolftown/kaiku/integration/AuthFlowTest.kt \
       mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt \
       mobile/android/app/src/test/java/io/wolftown/kaiku/data/voice/WebRtcManagerTest.kt \
       mobile/android/app/src/test/java/io/wolftown/kaiku/data/ws/KaikuWebSocketTest.kt
git commit -m "test(client): add register/QR failure cleanup tests, fix WebRtcManager mute and WS send tests"
```

---

## Task Dependencies

```
Task 1 (wire-format)            — standalone, HIGHEST PRIORITY
Task 2 (VoiceRepo cancel)       — standalone
Task 3 (QR scanner)             — standalone
Task 4 (token storage/auth)     — standalone
Task 5 (WebRtcManager volatile) — standalone
Task 6 (HTTP refresh)           — depends on Task 4 (getRefreshToken null-or-empty)
Task 7 (silent failures)        — standalone
Task 8 (redeemQrToken order)    — depends on Task 4 (empty userId handling)
Task 9 (comments)               — standalone
Task 10 (tests)                 — depends on Task 1 (wire-format changes affect test data),
                                  depends on Task 8 (redeemQrToken order affects QR test)
```

Tasks 1-5, 7, 9 are independent. Task 6 depends on 4. Task 8 depends on 4. Task 10 should run last.

## Deferred (out of scope)

- **Typed IDs** (`UserId`, `ChannelId`, `GuildId`, `MessageId`) — high value but large refactor touching all domain models. Defer to a dedicated PR.
- **`kotlinx.datetime.Instant` for timestamps** — similar scope concern.
- **`TokenStorage` unit tests with Robolectric** — requires adding Robolectric test dependency.
