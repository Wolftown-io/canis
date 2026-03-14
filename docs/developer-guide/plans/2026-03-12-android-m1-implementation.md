# Android Milestone 1 Implementation Plan


**Goal:** A native Android app that supports login, guild/channel navigation, text messaging, voice chat, and screen share viewing against the existing Kaiku v1 server.

**Architecture:** Pure Kotlin + Jetpack Compose, MVVM with Hilt DI. Ktor for REST, OkHttp for WebSocket, stream-webrtc-android for voice. No Rust/UniFFI — all networking in Kotlin. Minimal caching (EncryptedSharedPreferences for tokens only).

**Tech Stack:** Kotlin 2.x, Jetpack Compose + Material 3, Hilt, Navigation Compose, Ktor, OkHttp, kotlinx.serialization, stream-webrtc-android, Coil

**Design Reference:** `docs/developer-guide/plans/2026-03-12-android-app-design.md`

**Server Protocol Reference:** `shared/vc-common/src/protocol/mod.rs` (WebSocket events), `server/src/ws/mod.rs` (connection handling), `server/src/api/mod.rs` (REST routes)

---

### Task 1: Android Project Scaffold

**Files:**
- Create: `mobile/android/settings.gradle.kts`
- Create: `mobile/android/build.gradle.kts` (project-level)
- Create: `mobile/android/gradle.properties`
- Create: `mobile/android/app/build.gradle.kts`
- Create: `mobile/android/app/src/main/AndroidManifest.xml`
- Create: `mobile/android/app/src/main/java/io/wolftown/kaiku/KaikuApplication.kt`

**Step 1: Create project-level Gradle files**

`settings.gradle.kts`: pluginManagement with google/mavenCentral repos, dependencyResolutionManagement, rootProject.name = "kaiku-android", include ":app".

`build.gradle.kts` (project): apply Kotlin, Compose compiler, Hilt, KSP plugins with `apply false`.

`gradle.properties`: android.useAndroidX=true, kotlin.code.style=official, org.gradle.jvmargs=-Xmx2048m.

**Step 2: Create app-level build.gradle.kts**

- minSdk 26, targetSdk 35, compileSdk 35
- applicationId `io.wolftown.kaiku`
- Enable Compose with `buildFeatures { compose = true }`
- Dependencies: Compose BOM (2025.01+), Material3, Navigation Compose, Hilt, Ktor (client-okhttp, content-negotiation, kotlinx-serialization), OkHttp, kotlinx-serialization-json, Coil Compose, AndroidX Security Crypto, stream-webrtc-android, JUnit, MockK, Compose UI testing
- Apply hilt and ksp plugins

**Step 3: Create AndroidManifest.xml**

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />

    <application
        android:name=".KaikuApplication"
        android:allowBackup="false"
        android:usesCleartextTraffic="false"
        android:theme="@style/Theme.Kaiku">

        <activity
            android:name=".ui.MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <!-- OIDC deep link -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="kaiku" android:host="auth" />
            </intent-filter>
        </activity>

        <service
            android:name=".service.VoiceCallService"
            android:foregroundServiceType="microphone"
            android:exported="false" />
    </application>
</manifest>
```

**Step 4: Create KaikuApplication.kt**

```kotlin
package io.wolftown.kaiku

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class KaikuApplication : Application()
```

**Step 5: Create MainActivity.kt stub**

`mobile/android/app/src/main/java/io/wolftown/kaiku/ui/MainActivity.kt` — @AndroidEntryPoint Activity with setContent { KaikuApp() } composable stub.

**Step 6: Verify build**

```bash
cd mobile/android && ./gradlew assembleDebug
```

**Step 7: Commit**

```bash
git add mobile/android/
git commit -m "feat(client): scaffold Android project with Compose + Hilt"
```

---

### Task 2: Domain Models & Serialization

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/domain/model/` — User.kt, Guild.kt, Channel.kt, Message.kt, Attachment.kt
- Create: `app/src/test/java/io/wolftown/kaiku/domain/model/SerializationTest.kt`

**Step 1: Write serialization tests**

Test that JSON from the server (snake_case) deserializes correctly into Kotlin data classes. Use sample JSON from the server responses documented in the design doc. Test roundtrip for each model.

Reference: Server response shapes are in `server/src/auth/handlers.rs` (User), `server/src/guild/handlers.rs` (Guild), `server/src/chat/messages.rs` (Message).

**Step 2: Implement domain models**

All wire-format fields use `@SerialName("snake_case")`. Key models:

- `User`: id, username, display_name, avatar_url, status, created_at
- `Guild`: id, name, description, icon_url, member_count, created_at
- `Channel`: id, name, channel_type (text/voice/dm), category_id, topic, user_limit, position, created_at
- `Message`: id, channel_id, author (User), content, encrypted, attachments, reply_to, edited_at, created_at
- `Attachment`: id, filename, mime_type, size, url, width, height, blurhash, thumbnail_url, medium_url
- `AuthResponse`: access_token, refresh_token, expires_in, token_type, setup_required

Use kotlinx.serialization `@Serializable` with `Json { ignoreUnknownKeys = true; namingStrategy = JsonNamingStrategy.SnakeCase }`.

**Step 3: Run tests, verify pass**

```bash
./gradlew testDebugUnitTest --tests "*.SerializationTest"
```

**Step 4: Commit**

```bash
git commit -m "feat(client): add domain models with snake_case serialization"
```

---

### Task 3: Token Storage & Auth State

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/local/TokenStorage.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/local/AuthState.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/di/StorageModule.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/data/local/AuthStateTest.kt`

**Step 1: Write tests for AuthState**

Test: storing tokens, clearing tokens, checking isLoggedIn, token expiry detection.

**Step 2: Implement TokenStorage**

Wrapper around EncryptedSharedPreferences (AndroidX Security Crypto). Stores access_token, refresh_token, expires_at (epoch millis), user_id. Provides `isAccessTokenExpired(): Boolean`.

**Step 3: Implement AuthState**

StateFlow-based observable auth state. Exposes `val isLoggedIn: StateFlow<Boolean>`, `val currentUserId: StateFlow<String?>`. Updated by AuthRepository on login/logout/refresh.

**Step 4: Implement StorageModule**

Hilt `@Module` providing TokenStorage singleton with EncryptedSharedPreferences.

**Step 5: Run tests, commit**

```bash
git commit -m "feat(client): add encrypted token storage and auth state"
```

---

### Task 4: Ktor HTTP Client & Auth Interceptor

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/api/KaikuHttpClient.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/di/NetworkModule.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/data/api/KaikuHttpClientTest.kt`

**Step 1: Write tests**

Test: requests include Bearer token, 401 triggers token refresh and retry, refresh failure triggers logout.

**Step 2: Implement KaikuHttpClient**

Ktor HttpClient with:
- `ContentNegotiation` plugin with `json(Json { ignoreUnknownKeys = true; namingStrategy = JsonNamingStrategy.SnakeCase })`
- Custom auth plugin: attach `Authorization: Bearer <token>` to requests, intercept 401 responses → call refresh endpoint → retry original request → if refresh fails emit logout event
- Base URL configurable (user enters server URL on first launch)

**Step 3: Implement NetworkModule**

Hilt `@Module` providing HttpClient singleton, injecting TokenStorage.

**Step 4: Run tests, commit**

```bash
git commit -m "feat(client): add Ktor HTTP client with token refresh interceptor"
```

---

### Task 5: Auth API & Login Screen

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/auth/LoginViewModel.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/auth/LoginScreen.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/auth/RegisterScreen.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/auth/ServerUrlScreen.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/ui/auth/LoginViewModelTest.kt`

**Step 1: Write ViewModel tests**

Test: successful login stores tokens and navigates, MFA required shows MFA input, login failure shows error, register flow works.

**Step 2: Implement AuthApi**

Endpoints (see `server/src/auth/mod.rs` for exact routes):
- `POST /auth/login` → `AuthResponse`
- `POST /auth/register` → `AuthResponse`
- `POST /auth/refresh` → `AuthResponse`
- `POST /auth/logout`
- `GET /auth/me` → `User`
- `GET /auth/oidc/providers` → `List<OidcProvider>`

**Step 3: Implement AuthRepository**

Orchestrates AuthApi + TokenStorage + AuthState. Handles: login (with optional mfa_code), register, refresh, logout, getCurrentUser.

**Step 4: Implement screens**

- `ServerUrlScreen` — first launch, user enters server URL (e.g., `https://chat.example.com`), stored in SharedPreferences
- `LoginScreen` — username/password fields, optional MFA code field (shown on MFA_REQUIRED response), login button, link to register, OIDC provider buttons
- `RegisterScreen` — username, email (optional), password, display_name

**Step 5: Run tests, commit**

```bash
git commit -m "feat(client): add auth flow with login, register, and server URL screens"
```

---

### Task 6: OIDC Login

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/ui/auth/OidcHandler.kt`
- Modify: `app/src/main/java/io/wolftown/kaiku/ui/MainActivity.kt` — handle deep link intent

**Step 1: Implement OidcHandler**

1. Fetch providers via `GET /auth/oidc/providers`
2. Launch Custom Tab to `GET /auth/oidc/authorize/{provider}?redirect_uri=kaiku://auth/callback`
3. Handle deep link in MainActivity: extract `code` and `state` params from `kaiku://auth/callback?code=...&state=...`
4. Exchange via `POST /auth/oidc/callback` with code + state + provider
5. Store tokens from response

Reference: `server/src/auth/oidc.rs` for the server-side OIDC flow.

**Step 2: Test manually** (OIDC requires a running server + provider)

**Step 3: Commit**

```bash
git commit -m "feat(client): add OIDC login via Custom Tab deep link"
```

---

### Task 7: WebSocket Client

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/ws/KaikuWebSocket.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/ws/ServerEvent.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/ws/ClientEvent.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/di/WebSocketModule.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/data/ws/ServerEventParsingTest.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/data/ws/KaikuWebSocketTest.kt`

**Step 1: Write event parsing tests**

Test deserialization of every ServerEvent variant used in M1: Ready, Pong, Subscribed, Unsubscribed, MessageNew, MessageEdit, MessageDelete, ReactionAdd, ReactionRemove, TypingStart, TypingStop, PresenceUpdate, Error, VoiceOffer, VoiceIceCandidate, VoiceUserJoined, VoiceUserLeft, VoiceUserMuted, VoiceUserUnmuted, VoiceRoomState, VoiceError, ScreenShareStarted, ScreenShareStopped, VoiceLayerChanged.

Reference: exact field names and types in `shared/vc-common/src/protocol/mod.rs`.

**Step 2: Implement ServerEvent and ClientEvent**

Sealed classes with kotlinx.serialization. Discriminator field: `"type"` (snake_case).

`ServerEvent` — sealed class with data class per variant. Use `@SerialName("message_new")` etc.

`ClientEvent` — sealed class for: Ping, Subscribe, Unsubscribe, Typing, StopTyping, VoiceJoin, VoiceLeave, VoiceAnswer, VoiceIceCandidate, VoiceMute, VoiceUnmute, VoiceSetLayerPreference.

**Step 3: Write WebSocket client tests**

Test: connects with token in Sec-WebSocket-Protocol header, emits Ready event, reconnects on close with exponential backoff (1s, 2s, 4s, 8s, max 30s), pauses reconnect when offline.

**Step 4: Implement KaikuWebSocket**

OkHttp WebSocket client. Key design:

```kotlin
class KaikuWebSocket @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val tokenStorage: TokenStorage,
    private val connectivityMonitor: ConnectivityMonitor,
    private val json: Json
) {
    val events: SharedFlow<ServerEvent>  // subscribers observe this
    val connectionState: StateFlow<ConnectionState>  // Connected, Connecting, Disconnected

    fun connect(serverUrl: String)
    fun disconnect()
    fun send(event: ClientEvent)
}
```

- Connection: `Request.Builder().url("wss://.../ws").addHeader("Sec-WebSocket-Protocol", "access_token.$jwt")`
- Parse incoming text frames as ServerEvent via json.decodeFromString
- Send Ping every 30s, expect Pong
- On close/failure: exponential backoff reconnect
- ConnectivityMonitor: `ConnectivityManager.NetworkCallback` — pause reconnect when offline

**Step 5: Run tests, commit**

```bash
git commit -m "feat(client): add WebSocket client with event parsing and auto-reconnect"
```

---

### Task 8: Guild List & Channel Navigation

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/api/GuildApi.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/api/ChannelApi.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/repository/GuildRepository.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/home/HomeViewModel.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/home/HomeScreen.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/home/GuildSidebar.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/home/ChannelList.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/KaikuNavGraph.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/ui/home/HomeViewModelTest.kt`

**Step 1: Write ViewModel tests**

Test: loads guilds on init, selecting guild loads channels, channels sorted by position, voice channels show participant count.

**Step 2: Implement APIs**

GuildApi: `GET /api/guilds` → `List<Guild>`, `GET /api/guilds/{id}` → `Guild`
ChannelApi: `GET /api/guilds/{id}/channels` → `List<Channel>`

**Step 3: Implement GuildRepository**

Fetches guilds, caches in-memory. Fetches channels per guild. Exposes StateFlows.

**Step 4: Implement UI**

- `HomeScreen` — scaffold with guild sidebar (left rail) + channel list + content area
- `GuildSidebar` — vertical list of guild icons (circular), selected state
- `ChannelList` — grouped by category_id (null = top), text channels show # prefix, voice channels show speaker icon + participant count
- `KaikuNavGraph` — Navigation Compose: ServerUrl → Login → Home → TextChannel → VoiceChannel

Mobile layout: drawer-based navigation (swipe from left for guilds, channel list as main content, tapping a channel navigates to it full-screen).

**Step 5: Run tests, commit**

```bash
git commit -m "feat(client): add guild list, channel navigation, and app nav graph"
```

---

### Task 9: Text Messaging

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/api/MessageApi.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/repository/ChatRepository.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/channel/TextChannelViewModel.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/channel/TextChannelScreen.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/channel/MessageItem.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/channel/MessageInput.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/ui/channel/TextChannelViewModelTest.kt`

**Step 1: Write ViewModel tests**

Test: loads message history on enter, new WebSocket message appends to list, sending message calls API and shows optimistic update, edit/delete update in-place, subscribes to channel on enter and unsubscribes on leave.

**Step 2: Implement MessageApi**

- `GET /api/messages/channel/{channel_id}?before={id}&limit=50` → `List<Message>` (paginated, newest last)
- `POST /api/messages/channel/{channel_id}` body: `{ "content": "..." }` → `Message`
- `PATCH /api/messages/{id}` body: `{ "content": "..." }` → `Message`
- `DELETE /api/messages/{id}`

**Step 3: Implement ChatRepository**

- Fetches message history via REST
- Subscribes to channel via WebSocket (`ClientEvent.Subscribe`)
- Merges REST messages with real-time WebSocket events (MessageNew, MessageEdit, MessageDelete)
- Sends typing indicators (debounced, 3s cooldown)
- Exposes `messages: StateFlow<List<Message>>` per channel

**Step 4: Implement UI**

- `TextChannelScreen` — LazyColumn of messages (reversed, newest at bottom), MessageInput at bottom, pull-to-load-more at top
- `MessageItem` — author avatar (Coil), display_name, timestamp, content, edited indicator, reactions row. Long-press for edit/delete (own messages only).
- `MessageInput` — TextField with send button, typing indicator display ("User is typing...")

**Step 5: Implement reactions**

- `PUT /api/channels/{channel_id}/messages/{message_id}/reactions` body: `{ "emoji": "👍" }`
- `DELETE /api/channels/{channel_id}/messages/{message_id}/reactions/{emoji}`
- Show reaction chips below message content, highlight own reactions
- Update via WebSocket ReactionAdd/ReactionRemove events

**Step 6: Run tests, commit**

```bash
git commit -m "feat(client): add text messaging with real-time updates and reactions"
```

---

### Task 10: Voice — WebRTC Integration

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/voice/AudioRouteManager.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/api/VoiceApi.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/data/voice/WebRtcManagerTest.kt`

**Step 1: Write tests**

Test: creates PeerConnection with ICE servers, handles SDP offer → creates answer, adds ICE candidates, mute/unmute toggles audio track.

**Step 2: Implement VoiceApi**

- `GET /api/voice/ice-servers` → ICE server configuration (STUN/TURN URLs + credentials)

**Step 3: Implement WebRtcManager**

Key responsibilities:
1. Initialize PeerConnectionFactory (stream-webrtc-android)
2. Fetch ICE servers from REST API
3. Create PeerConnection with ICE server config
4. On `VoiceOffer` (from WebSocket): `setRemoteDescription(SDP offer)` → `createAnswer()` → `setLocalDescription(answer)` → send `ClientEvent.VoiceAnswer` via WebSocket
5. Exchange ICE candidates bidirectionally via WebSocket
6. Manage local audio track (microphone): create AudioSource + AudioTrack, add to PeerConnection
7. Receive remote audio tracks via `onTrack` callback → route to speaker
8. Mute/unmute: `audioTrack.setEnabled(false/true)`

Reference: Desktop voice flow in `server/src/voice/sfu.rs` and `server/src/voice/ws_handler.rs`.

**Step 4: Implement AudioRouteManager**

- Manage AudioManager: request audio focus, set mode MODE_IN_COMMUNICATION
- Detect available outputs: speaker, earpiece, wired headset, Bluetooth
- Switch between outputs via AudioManager + BluetoothScoAudioManager
- Headset plug/unplug BroadcastReceiver

**Step 5: Run tests, commit**

```bash
git commit -m "feat(client): add WebRTC manager and audio routing for voice"
```

---

### Task 11: Voice — Service & UI

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/service/VoiceCallService.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/data/repository/VoiceRepository.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/voice/VoiceViewModel.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/voice/VoiceChannelScreen.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/voice/VoiceOverlay.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/ui/voice/VoiceViewModelTest.kt`

**Step 1: Write ViewModel tests**

Test: joining channel sends VoiceJoin event, receives VoiceRoomState with participants, mute/unmute updates local state and sends event, leaving sends VoiceLeave, participant list updates on VoiceUserJoined/Left.

**Step 2: Implement VoiceCallService**

Foreground service (`FOREGROUND_SERVICE_TYPE_MICROPHONE`):
- Started when joining a voice channel
- Shows persistent notification with channel name, mute button, disconnect button
- Keeps audio alive when app is backgrounded
- Stopped when leaving voice channel
- Notification actions via PendingIntent → BroadcastReceiver

**Step 3: Implement VoiceRepository**

Orchestrates WebRtcManager + WebSocket:
1. `joinChannel(channelId)`: send `ClientEvent.VoiceJoin`, start VoiceCallService
2. Handle `ServerEvent.VoiceRoomState`: populate participant list
3. Handle `ServerEvent.VoiceOffer`: pass SDP to WebRtcManager
4. Handle ICE candidates bidirectionally
5. Handle VoiceUserJoined/Left/Muted/Unmuted: update participant list
6. `leaveChannel()`: send `ClientEvent.VoiceLeave`, close PeerConnection, stop service
7. `toggleMute()`: toggle audio track, send VoiceMute/VoiceUnmute

Exposes: `participants: StateFlow<List<VoiceParticipant>>`, `isMuted: StateFlow<Boolean>`, `currentChannel: StateFlow<UUID?>`.

**Step 4: Implement UI**

- `VoiceChannelScreen` — participant grid (avatar + name + mute icon + speaking indicator), bottom bar with mute button + audio route picker + disconnect button
- `VoiceOverlay` — compact bar shown at bottom of other screens when in voice (channel name, mute toggle, tap to return). Use a composable overlaid on the nav host.
- Speaking indicator: voice activity detection from WebRTC audio levels (`audioTrack.getStats()`)

**Step 5: Run tests, commit**

```bash
git commit -m "feat(client): add voice channel UI, foreground service, and participant tracking"
```

---

### Task 12: Screen Share Viewing

**Files:**
- Create: `app/src/main/java/io/wolftown/kaiku/ui/voice/ScreenShareView.kt`
- Modify: `app/src/main/java/io/wolftown/kaiku/data/voice/WebRtcManager.kt` — handle video tracks
- Modify: `app/src/main/java/io/wolftown/kaiku/data/repository/VoiceRepository.kt` — track screen shares
- Modify: `app/src/main/java/io/wolftown/kaiku/ui/voice/VoiceChannelScreen.kt` — show screen share

**Step 1: Extend WebRtcManager for video tracks**

- `onTrack` callback: identify video tracks by track source label (screen_video:{stream_id})
- Route video tracks to SurfaceViewRenderer instances
- Support `VoiceSetLayerPreference` to select simulcast layer (default "auto" on mobile, switch to "low" on cellular)

**Step 2: Extend VoiceRepository**

- Handle `ScreenShareStarted`: add to active screen shares list, request "auto" layer
- Handle `ScreenShareStopped`: remove from list
- Expose `screenShares: StateFlow<List<ScreenShareInfo>>`

**Step 3: Implement ScreenShareView**

- AndroidView wrapping SurfaceViewRenderer (stream-webrtc-android)
- Tap to toggle fullscreen
- Layer quality indicator (high/medium/low badge)
- Pinch-to-zoom (optional, nice-to-have)

**Step 4: Integrate into VoiceChannelScreen**

- When screen shares are active, show them prominently (top area)
- Participant grid moves below/shrinks
- Multiple screen shares: horizontal pager

**Step 5: Test manually** (requires desktop client sharing screen)

**Step 6: Commit**

```bash
git commit -m "feat(client): add screen share viewing with simulcast layer selection"
```

---

### Task 13: Navigation Polish & App Shell

**Files:**
- Modify: `app/src/main/java/io/wolftown/kaiku/ui/KaikuNavGraph.kt`
- Modify: `app/src/main/java/io/wolftown/kaiku/ui/MainActivity.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/shared/KaikuTheme.kt`
- Create: `app/src/main/java/io/wolftown/kaiku/ui/settings/SettingsScreen.kt`

**Step 1: Implement KaikuTheme**

Material 3 theme with Kaiku's Nordic color palette. Reference: `client/src/styles/themes/` for desktop theme colors. Dark theme as default (gaming audience). Dynamic color on Android 12+.

**Step 2: Polish navigation flow**

- Auth guard: if no token → ServerUrl → Login flow; if token → Home
- Token expiry: on 401 after failed refresh → navigate to Login, clear back stack
- Back button: TextChannel → ChannelList → GuildList (drawer close) → exit
- Voice overlay persists across navigation (shown in scaffold, not per-screen)

**Step 3: Implement SettingsScreen**

Minimal for M1: server URL display, current user info (from GET /auth/me), logout button, app version.

**Step 4: Test navigation flows manually**

**Step 5: Commit**

```bash
git commit -m "feat(client): polish navigation, theming, and settings screen"
```

---

### Task 14: Integration Testing & Release Build

**Files:**
- Create: `app/src/test/java/io/wolftown/kaiku/integration/AuthFlowTest.kt`
- Create: `app/src/test/java/io/wolftown/kaiku/integration/MessageFlowTest.kt`
- Modify: `app/build.gradle.kts` — add signing config, ProGuard rules

**Step 1: Write integration tests**

- `AuthFlowTest`: mock server responses, verify login → token storage → WebSocket connect → guild list load full flow
- `MessageFlowTest`: mock WebSocket, verify subscribe → receive message → display in list → send message → optimistic update

Use MockK for mocking, Turbine for testing StateFlows.

**Step 2: Run all tests**

```bash
cd mobile/android && ./gradlew testDebugUnitTest
```

**Step 3: Configure release build**

- ProGuard rules for kotlinx.serialization, Ktor, OkHttp, stream-webrtc-android
- Signing config (keystore path via local.properties, not committed)
- Build: `./gradlew assembleRelease`

**Step 4: Manual smoke test on device**

Checklist:
- [ ] Login with username/password
- [ ] See guild list and channels
- [ ] Send and receive text messages in real-time
- [ ] Edit and delete own messages
- [ ] Add/remove reactions
- [ ] Join voice channel, hear other participants
- [ ] Mute/unmute, audio route switching
- [ ] Voice continues in background (foreground service)
- [ ] View screen share from desktop user
- [ ] Reconnect after network loss
- [ ] Logout and re-login

**Step 5: Commit**

```bash
git commit -m "test(client): add integration tests and release build configuration"
```

---

## Task Dependencies

```
Task 1 (scaffold)
  → Task 2 (models)
    → Task 3 (token storage)
      → Task 4 (HTTP client)
        → Task 5 (auth + login)
          → Task 6 (OIDC)
        → Task 7 (WebSocket)
          → Task 8 (guild/channel nav)
            → Task 9 (text messaging)
          → Task 10 (WebRTC)
            → Task 11 (voice service + UI)
              → Task 12 (screen share)
      → Task 13 (nav polish) — after Tasks 9, 11, 12
        → Task 14 (integration tests) — after Task 13
```

Tasks 5-6 (auth) and Task 7 (WebSocket) can be developed in parallel after Task 4.
Tasks 9 (messaging) and Tasks 10-11 (voice) can be developed in parallel after Task 8.
