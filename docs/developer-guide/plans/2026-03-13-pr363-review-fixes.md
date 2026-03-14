# PR #363 Review Fixes Implementation Plan


**Goal:** Fix all critical, important, and suggestion-level issues found in the comprehensive PR #363 review across code quality, error handling, tests, and type design.

**Architecture:** Grouped fixes by affected layer/file to minimize commits. Each task touches a coherent set of files. No new features — only correctness, safety, and type improvements.

**Tech Stack:** Kotlin/Compose (Android), MockK (tests). No build system available locally — verify with code review only.

**Note:** No Android SDK/JDK available on this machine. Tests cannot be run locally. All changes must be verified by code inspection.

---

### Task 1: Fix duplicate companion object in KaikuHttpClient

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/KaikuHttpClient.kt`

**Step 1: Merge the two companion objects into one**

The file has two `companion object` blocks (lines 44-46 and 55-68). Kotlin allows only one. Merge them:

```kotlin
internal companion object {
    private val logger = Logger.getLogger("KaikuHttpClient")
    private val SkipAuthInterceptor = AttributeKey<Boolean>("SkipAuthInterceptor")

    fun forTesting(
        tokenStorage: TokenStorage,
        authState: AuthState,
        engine: HttpClientEngine
    ): KaikuHttpClient {
        return KaikuHttpClient(tokenStorage, authState).apply {
            testClient = createConfiguredClient(engine)
        }
    }
}
```

Remove the first `companion object` block entirely and put the `logger` declaration into the second one.

**Step 2: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/KaikuHttpClient.kt
git commit -m "fix(client): merge duplicate companion objects in KaikuHttpClient"
```

---

### Task 2: Fix CancellationException handling in HomeViewModel

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/home/HomeViewModel.kt`

**Step 1: Add CancellationException re-throw to both catch blocks**

In `onGuildSelected()` (around line 53-58), change:

```kotlin
} catch (e: Exception) {
    _error.value = e.message ?: "Failed to load channels"
}
```

To:

```kotlin
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    _error.value = e.message ?: "Failed to load channels"
}
```

Same fix in `loadGuilds()` (around line 78-85) — add the `CancellationException` catch before the generic `Exception` catch.

Add import: `import kotlinx.coroutines.CancellationException`

**Step 2: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/ui/home/HomeViewModel.kt
git commit -m "fix(client): re-throw CancellationException in HomeViewModel"
```

---

### Task 3: Voice layer thread safety

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/service/VoiceCallService.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt`

**Step 1: Add @Volatile to VoiceCallService static callbacks**

In `VoiceCallService.kt` companion object (lines 44-45), change:

```kotlin
var onMuteToggle: (() -> Unit)? = null
var onDisconnect: (() -> Unit)? = null
```

To:

```kotlin
@Volatile var onMuteToggle: (() -> Unit)? = null
@Volatile var onDisconnect: (() -> Unit)? = null
```

Also add null-logging in the action handlers. In `onStartCommand`, where `onMuteToggle?.invoke()` and `onDisconnect?.invoke()` are called, add logging for null cases:

```kotlin
ACTION_MUTE_TOGGLE -> {
    val handler = onMuteToggle
    if (handler != null) handler.invoke()
    else logger.warning("Mute toggle callback is null — voice session may have ended")
    return START_NOT_STICKY
}
ACTION_DISCONNECT -> {
    val handler = onDisconnect
    if (handler != null) handler.invoke()
    else logger.warning("Disconnect callback is null — voice session may have ended")
    return START_NOT_STICKY
}
```

Add a logger to the companion object if not present: `private val logger = Logger.getLogger("VoiceCallService")`

**Step 2: Add Mutex to WebRtcManager.initialize()**

In `WebRtcManager.kt`, add a Mutex field and wrap `initialize()`:

```kotlin
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// Add field near the top of the class:
private val initMutex = Mutex()

// Change initialize() to:
suspend fun initialize() {
    initMutex.withLock {
        if (factory != null) return
        // ... rest of existing initialization code unchanged
    }
}
```

**Step 3: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/service/VoiceCallService.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt
git commit -m "fix(client): add thread safety to VoiceCallService callbacks and WebRtcManager init"
```

---

### Task 4: AuthApi and OidcHandler error handling

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/OidcHandler.kt`

**Step 1: Fix logout() to check response status**

Change `logout()` implementation (around line 131) from:

```kotlin
override suspend fun logout() {
    httpClient.post("/auth/logout")
}
```

To:

```kotlin
override suspend fun logout() {
    val response = httpClient.post("/auth/logout")
    if (!response.status.isSuccess()) {
        logger.log(Level.WARNING, "Logout request failed: ${response.status}")
    }
}
```

Note: Don't throw — the caller (`AuthRepository.logout()`) already treats logout as best-effort and clears local state regardless. Just log the failure.

**Step 2: Fix getOidcProviders() to throw on server error**

Change from returning empty list on failure to throwing, so the caller can distinguish "no providers" from "API error":

```kotlin
override suspend fun getOidcProviders(): List<OidcProvider> {
    val response = httpClient.get("/auth/oidc/providers")
    if (!response.status.isSuccess()) {
        val errorBody = runCatching { response.body<ApiErrorResponse>() }.getOrNull()
        throw ApiException(response.status, errorBody?.message ?: "Failed to load OIDC providers")
    }
    return response.body()
}
```

Then in the caller (`LoginViewModel` or wherever `getOidcProviders` is called), catch the exception and handle gracefully — show an error or fall back to empty list with a warning to the user.

Read `LoginViewModel.kt` to find where `getOidcProviders` is called and add proper error handling there (catch the exception, log it, and optionally set an error state — but still show the login form without OIDC buttons).

**Step 3: Fix OidcHandler.launchOidcLogin() silent return**

In `OidcHandler.kt` (line 39), change from silent return to logging:

```kotlin
fun launchOidcLogin(context: Context, providerSlug: String) {
    val serverUrl = tokenStorage.getServerUrl()
    if (serverUrl == null) {
        logger.log(Level.WARNING, "Cannot launch OIDC login: server URL not configured")
        return
    }
    // ... rest unchanged
}
```

Add a logger if not present: `private val logger = Logger.getLogger("OidcHandler")`

**Step 4: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/OidcHandler.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/LoginViewModel.kt
git commit -m "fix(client): improve error handling in AuthApi logout, OIDC providers, and OidcHandler"
```

---

### Task 5: Handle ServerEvent.Error and VoiceError, fix premature isConnected

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/VoiceRepository.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/ChatRepository.kt`

**Step 1: Add VoiceError and Error handling to VoiceRepository**

In `VoiceRepository.handleServerEvent()` (around lines 273-386), add cases to the `when` block before the `else ->`:

```kotlin
is ServerEvent.VoiceError -> {
    _error.value = "Voice error: ${event.message}"
    logger.warning("Voice error from server: code=${event.code} message=${event.message}")
}

is ServerEvent.Error -> {
    logger.warning("Server error in voice context: code=${event.code} message=${event.message}")
}
```

**Step 2: Add Error handling to ChatRepository**

In `ChatRepository.handleServerEvent()` (around lines 160-171), add before the `else ->`:

```kotlin
is ServerEvent.Error -> {
    logger.warning("Server error: code=${event.code} message=${event.message}")
}
```

Add a logger if not present.

**Step 3: Fix premature isConnected in VoiceRepository**

In `joinChannel()` (around line 137), change `_isConnected.value = true` to only set after the server confirms the join. Move it into the `VoiceRoomState` event handler instead:

Remove: `_isConnected.value = true` from `joinChannel()` (line 137).

In the `handleServerEvent` when block, find the `is ServerEvent.VoiceRoomState` case and add `_isConnected.value = true` there:

```kotlin
is ServerEvent.VoiceRoomState -> {
    _isConnected.value = true
    // ... rest of existing VoiceRoomState handling
}
```

**Step 4: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/VoiceRepository.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/ChatRepository.kt
git commit -m "fix(client): handle ServerEvent.Error/VoiceError and defer isConnected until server confirms"
```

---

### Task 6: Fix QrLoginFlowTest assertion

**Files:**
- Modify: `mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt`

**Step 1: Fix expired token test assertion**

The test for "QR redeem with expired token" asserts that `saveServerUrl` was called, but the implementation (after the fix in commit 9d7c251) saves server URL AFTER the API call — so on failure, `saveServerUrl` should NOT be called.

Find the expired token test (around line 96-120). Change the assertion from verifying that `saveServerUrl` WAS called to verifying it was NOT called:

```kotlin
verify(exactly = 0) { tokenStorage.saveServerUrl(any()) }
```

Also remove any comment saying "Server URL is saved before the API call" — that's no longer true.

Additionally, verify that `saveTokens` was NOT called on failure:

```kotlin
verify(exactly = 0) { tokenStorage.saveTokens(any(), any(), any(), any()) }
```

**Step 2: Commit**

```bash
git add mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt
git commit -m "fix(test): correct QrLoginFlowTest assertions for post-redeem server URL save"
```

---

### Task 7: Storage improvements

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/di/StorageModule.kt`

**Step 1: Change TokenStorage.saveTokens() from apply() to commit()**

In `saveTokens()` (around line 18-31), change `.apply()` to `.commit()`. Do the same for `saveServerUrl()` and `clear()` if they also use `apply()`.

`commit()` is synchronous and returns a boolean indicating success. Log if it fails:

```kotlin
fun saveTokens(
    accessToken: String,
    refreshToken: String,
    expiresIn: Int,
    userId: String
) {
    val expiresAt = System.currentTimeMillis() + expiresIn * 1000L
    val success = prefs.edit()
        .putString(KEY_ACCESS_TOKEN, accessToken)
        .putString(KEY_REFRESH_TOKEN, refreshToken)
        .putLong(KEY_EXPIRES_AT, expiresAt)
        .putString(KEY_USER_ID, userId)
        .commit()
    if (!success) {
        logger.warning("Failed to persist tokens to storage")
    }
}
```

Add a logger if not present. Apply same pattern to `saveServerUrl()` and `clear()`.

**Step 2: Clean up tokens on getMe() failure in AuthRepository**

In `AuthRepository.login()` (and `register()`, `completeOidcLogin()`, `exchangeOidcCode()`, `redeemQrToken()`), add cleanup in the catch block. When an exception occurs after tokens are saved but before the flow completes, clear them:

The pattern should be:

```kotlin
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    tokenStorage.clear()
    Result.failure(e)
}
```

This ensures that if `getMe()` fails after tokens were saved, we don't leave the app in a half-authenticated state with an empty userId.

Note: Be careful with `redeemQrToken` — the server URL is now saved after the API call, so it will also be cleared. That's acceptable since the whole flow failed.

**Step 3: Add corruption notification flag in StorageModule**

In `StorageModule.kt`, when the EncryptedSharedPreferences is recreated after corruption, set a flag in regular SharedPreferences:

```kotlin
} catch (e: Exception) {
    logger.log(Level.WARNING, "EncryptedSharedPreferences corrupted, recreating", e)
    context.deleteSharedPreferences("kaiku_secure_prefs")

    // Flag for the UI to show a notification on next launch
    context.getSharedPreferences("kaiku_app_state", Context.MODE_PRIVATE)
        .edit()
        .putBoolean("storage_was_reset", true)
        .commit()

    EncryptedSharedPreferences.create(...)
}
```

The flag can be checked and cleared by the UI layer later (out of scope for this task, but the mechanism is in place).

**Step 4: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/di/StorageModule.kt
git commit -m "fix(client): use commit() for token persistence, clean up on getMe failure, flag storage resets"
```

---

### Task 8: UI error states and ICE error propagation

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/settings/SettingsViewModel.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt`

**Step 1: Add error state to SettingsViewModel**

Add an error StateFlow and set it when user loading fails:

```kotlin
private val _error = MutableStateFlow<String?>(null)
val error: StateFlow<String?> = _error.asStateFlow()
```

In `loadUser()`, when `result` is a failure, set the error:

```kotlin
val result = authRepository.getCurrentUser()
if (result.isSuccess) {
    _user.value = result.getOrNull()
} else {
    _error.value = result.exceptionOrNull()?.message ?: "Failed to load user profile"
}
```

**Step 2: Propagate ICE candidate errors to onError**

In `WebRtcManager.addIceCandidate()` (around line 241-253), add error propagation:

```kotlin
try {
    val data = IceCandidateData.fromJson(candidateJson)
    val candidate = IceCandidate(data.sdpMid, data.sdpMLineIndex, data.candidate)
    pc.addIceCandidate(candidate)
} catch (e: Exception) {
    logger.log(Level.WARNING, "Failed to parse ICE candidate: $candidateJson", e)
    onError?.invoke("Failed to process ICE candidate: ${e.message}")
}
```

**Step 3: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/ui/settings/SettingsViewModel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt
git commit -m "fix(client): add SettingsViewModel error state and propagate ICE candidate errors"
```

---

### Task 9: Type safety improvements

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/Channel.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/User.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/AuthState.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/AuthResponse.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt`
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt`
- Modify: Any files that reference `channel.channelType` as String or `user.status` as String

**Step 1: Add ChannelType enum**

In `Channel.kt`, add the enum and change the field type:

```kotlin
@Serializable
enum class ChannelType {
    @SerialName("text") TEXT,
    @SerialName("voice") VOICE,
    @SerialName("announcement") ANNOUNCEMENT;
}

@Serializable
data class Channel(
    val id: String,
    val name: String,
    val channelType: ChannelType,
    val categoryId: String? = null,
    val topic: String? = null,
    val userLimit: Int? = null,
    val position: Int = 0,
    val createdAt: String = ""
)
```

Then search the codebase for all comparisons like `channel.channelType == "text"` or `channel.channelType == "voice"` and replace with `channel.channelType == ChannelType.TEXT` etc. Check:
- `KaikuNavGraph.kt` or any navigation code that filters channels
- `HomeScreen.kt` or channel list code
- Any `when` blocks on channelType

**Step 2: Add UserStatus enum**

In `User.kt`, add the enum:

```kotlin
@Serializable
enum class UserStatus {
    @SerialName("online") ONLINE,
    @SerialName("idle") IDLE,
    @SerialName("dnd") DND,
    @SerialName("offline") OFFLINE;
}

@Serializable
data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String? = null,
    val status: UserStatus = UserStatus.OFFLINE,
    val mfaEnabled: Boolean = false,
    val createdAt: String = ""
)
```

Search for `user.status == "online"` etc. and replace with enum references.

**Step 3: Make TokenStorage.saveTokens accept nullable refreshToken**

In `TokenStorage.kt`, change the `refreshToken` parameter to `String?`:

```kotlin
fun saveTokens(
    accessToken: String,
    refreshToken: String?,
    expiresIn: Int,
    userId: String
) {
    // ...
    .putString(KEY_REFRESH_TOKEN, refreshToken ?: "")
    // ...
}
```

Then in `AuthRepository.kt`, remove the `?: ""` coercion at every call site — pass `authResponse.refreshToken` directly:

```kotlin
tokenStorage.saveTokens(
    accessToken = authResponse.accessToken,
    refreshToken = authResponse.refreshToken,
    expiresIn = authResponse.expiresIn,
    userId = user.id
)
```

**Step 4: Refactor AuthState to sealed class**

In `AuthState.kt`, replace the two separate flows with a single sealed class:

```kotlin
sealed class AuthSession {
    data object LoggedOut : AuthSession()
    data class LoggedIn(val userId: String) : AuthSession()
}

@Singleton
class AuthState @Inject constructor() {
    private val _session = MutableStateFlow<AuthSession>(AuthSession.LoggedOut)
    val session: StateFlow<AuthSession> = _session.asStateFlow()

    // Convenience properties for backward compatibility
    val isLoggedIn: StateFlow<Boolean> = _session.map { it is AuthSession.LoggedIn }
        .stateIn(CoroutineScope(Dispatchers.Default), SharingStarted.Eagerly, false)

    val currentUserId: StateFlow<String?> = _session.map { (it as? AuthSession.LoggedIn)?.userId }
        .stateIn(CoroutineScope(Dispatchers.Default), SharingStarted.Eagerly, null)

    fun setLoggedIn(userId: String) {
        _session.value = AuthSession.LoggedIn(userId)
    }

    fun setLoggedOut() {
        _session.value = AuthSession.LoggedOut
    }

    fun initialize(tokenStorage: TokenStorage) {
        val userId = tokenStorage.getUserId()
        if (userId != null && tokenStorage.getAccessToken() != null) {
            _session.value = AuthSession.LoggedIn(userId)
        }
    }
}
```

Keep the `isLoggedIn` and `currentUserId` convenience properties so existing code doesn't need mass refactoring. The sealed class ensures both values are always consistent.

Check if `CoroutineScope(Dispatchers.Default)` needs to be replaced — if `AuthState` already has a scope or if there's a better pattern in the codebase. If not, this works for a singleton.

**Step 5: Update tests**

Update `AuthStateTest.kt` if it directly references `_isLoggedIn` or `_currentUserId`. The public API (`isLoggedIn`, `currentUserId`, `setLoggedIn`, `setLoggedOut`, `initialize`) should remain the same, so most tests should still pass.

Update `QrLoginFlowTest.kt`, `AuthFlowTest.kt` if they check `authState.isLoggedIn.value` or `authState.currentUserId.value` — these should still work via the convenience properties.

Update `SerializationTest.kt` if it tests Channel or User deserialization — the field types changed from String to enum.

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/Channel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/User.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/AuthState.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/domain/model/AuthResponse.kt
# Also add any files that had channelType/status string comparisons updated
git commit -m "refactor(client): add ChannelType/UserStatus enums, AuthState sealed class, nullable refreshToken"
```

---

## Task Dependencies

```
Task 1 (KaikuHttpClient)     — standalone
Task 2 (HomeViewModel)       — standalone
Task 3 (Voice thread safety) — standalone
Task 4 (AuthApi/OidcHandler) — standalone
Task 5 (ServerEvent handling) — standalone
Task 6 (Test fix)            — depends on Task 7 (refreshToken change may affect test)
Task 7 (Storage)             — standalone
Task 8 (UI errors/ICE)       — standalone
Task 9 (Type safety)         — depends on Task 7 (TokenStorage signature change)
```

Tasks 1-5, 7-8 are independent and can be parallelized. Task 6 should run after 7. Task 9 should run last as it touches the most files.
