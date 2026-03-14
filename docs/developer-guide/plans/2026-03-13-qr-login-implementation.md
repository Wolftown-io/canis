# QR Code Mobile Login Implementation Plan


**Goal:** Let a desktop user generate a QR code that an Android device can scan to instantly log in — server URL + one-time auth token in a single scan.

**Architecture:** Two new server endpoints (create/redeem) using Valkey for ephemeral token storage. Desktop settings gets a modal with QR display. Android gets ML Kit barcode scanning on ServerUrlScreen and SettingsScreen.

**Tech Stack:** Rust/axum (server), fred (Valkey client), Solid.js + qrcode npm (desktop), Kotlin/Compose + ML Kit Barcode Scanning (Android)

**Design Reference:** `docs/developer-guide/plans/2026-03-13-qr-login-design.md`

---

### Task 1: Server — QR Token Endpoints

**Files:**
- Modify: `server/src/auth/handlers.rs` — add `qr_create` and `qr_redeem` handlers
- Modify: `server/src/auth/mod.rs` — register routes
- Test: `server/tests/auth_qr.rs` (or inline tests)

**Step 1: Add request/response types to handlers.rs**

Add near the other request structs (around line 105):

```rust
#[derive(Deserialize, utoipa::ToSchema)]
pub struct QrRedeemRequest {
    pub token: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct QrCreateResponse {
    pub token: String,
    pub expires_in: u64,
}
```

**Step 2: Implement `qr_create` handler**

Add at the end of `handlers.rs`:

```rust
/// Creates a one-time QR login token for the authenticated user.
/// Token is stored in Valkey with 120-second TTL.
#[tracing::instrument(skip(state))]
pub async fn qr_create(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AuthResult<Json<QrCreateResponse>> {
    let token = Uuid::now_v7().to_string();
    let redis_key = format!("qr_login:{token}");

    state
        .redis
        .set::<(), _, _>(
            &redis_key,
            auth.id.to_string(),
            Some(fred::types::Expiration::EX(120)),
            Some(fred::types::SetOptions::NX),
            false,
        )
        .await
        .map_err(|e| AuthError::Internal(format!("Failed to store QR token: {e}")))?;

    tracing::info!(user_id = %auth.id, "Created QR login token");

    Ok(Json(QrCreateResponse {
        token,
        expires_in: 120,
    }))
}
```

**Step 3: Implement `qr_redeem` handler**

```rust
/// Redeems a one-time QR login token for a full auth session.
/// The token is consumed atomically (one-use).
#[tracing::instrument(skip(state, body))]
pub async fn qr_redeem(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(body): Json<QrRedeemRequest>,
) -> AuthResult<(CookieJar, Json<AuthResponse>)> {
    let redis_key = format!("qr_login:{}", body.token);

    // Atomic get-and-delete (one-use)
    let user_id_str: Option<String> = state
        .redis
        .getdel(&redis_key)
        .await
        .map_err(|e| AuthError::Internal(format!("Failed to read QR token: {e}")))?;

    let user_id_str = user_id_str.ok_or(AuthError::InvalidCredentials)?;
    let user_id: Uuid = user_id_str
        .parse()
        .map_err(|_| AuthError::Internal("Invalid user ID in QR token".to_string()))?;

    // Issue tokens
    let tokens = generate_token_pair(
        user_id,
        &state.config.jwt_private_key,
        state.config.jwt_access_expiry,
        state.config.jwt_refresh_expiry,
    )?;

    // Compute refresh token hash for session tracking
    let token_hash = crate::auth::sessions::hash_token(&tokens.refresh_token);
    let expires_at = Utc::now()
        + chrono::Duration::seconds(state.config.jwt_refresh_expiry);

    // Create session (no IP/UA for QR login — the desktop user initiated it)
    create_session(&state.db, user_id, &token_hash, expires_at, None, None, None, None).await?;

    let setup_complete = is_setup_complete(&state.db).await?;

    tracing::info!(user_id = %user_id, "QR login token redeemed");
    crate::observability::metrics::record_auth_login_attempt(true);

    let include_refresh_token = should_return_refresh_token(&headers);

    let jar = jar.add(cookies::build_refresh_cookie(
        &tokens.refresh_token,
        state.config.jwt_refresh_expiry,
        &state.config,
    ));

    Ok((
        jar,
        Json(AuthResponse {
            access_token: tokens.access_token,
            refresh_token: include_refresh_token.then_some(tokens.refresh_token),
            expires_in: tokens.access_expires_in,
            token_type: "Bearer".to_string(),
            setup_required: !setup_complete,
        }),
    ))
}
```

**Step 4: Register routes in `auth/mod.rs`**

Add to the `protected_routes` block (requires auth — only authenticated users can create QR tokens):

```rust
.route("/qr/create", post(handlers::qr_create))
```

Add to the `public_routes` block (no auth — the mobile device redeeming the token isn't authenticated yet):

```rust
let qr_redeem_route = Router::new()
    .route("/qr/redeem", post(handlers::qr_redeem))
    .layer(axum_middleware::from_fn_with_state(
        state.clone(),
        rate_limit_by_ip,
    ))
    .layer(axum_middleware::from_fn(with_category(
        RateLimitCategory::AuthOther,
    )));
```

Then merge it into `public_routes`.

**Step 5: Verify server compiles**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`
Expected: no errors

**Step 6: Commit**

```bash
git add server/src/auth/handlers.rs server/src/auth/mod.rs
git commit -m "feat(auth): add QR login create/redeem endpoints"
```

---

### Task 2: Desktop — API Function and Tauri Command

**Files:**
- Modify: `client/src/lib/tauri.ts` — add `qrLoginCreate()` function
- Modify: `client/src-tauri/src/commands/auth.rs` — add `qr_login_create` Tauri command (if needed)

**Step 1: Add API function in `tauri.ts`**

Add near the MFA functions (around line 1034):

```typescript
export interface QrLoginCreateResponse {
  token: string;
  expires_in: number;
}

export async function qrLoginCreate(): Promise<QrLoginCreateResponse> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("qr_login_create");
  }
  return httpRequest<QrLoginCreateResponse>("POST", "/auth/qr/create");
}
```

**Step 2: Add Tauri command if needed**

Check if `client/src-tauri/src/commands/auth.rs` has a pattern for simple authenticated POST endpoints. If it does, add a matching `qr_login_create` command. If `httpRequest` is used in browser mode, the Tauri command should mirror it.

Look at how `mfa_setup` is implemented as a Tauri command for the pattern.

**Step 3: Commit**

```bash
git add client/src/lib/tauri.ts client/src-tauri/src/commands/auth.rs
git commit -m "feat(client): add qrLoginCreate API function"
```

---

### Task 3: Desktop — QR Login Modal

**Files:**
- Create: `client/src/components/settings/QrLoginModal.tsx`
- Modify: `client/src/components/settings/SecuritySettings.tsx` — add "Link Mobile Device" button

**Step 1: Create QrLoginModal component**

Follow the pattern from `MfaSetupModal.tsx`:

```tsx
import { Component, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import QRCode from "qrcode";
import { qrLoginCreate, type QrLoginCreateResponse } from "../../lib/tauri";
import { showToast } from "../ui/Toast";

interface QrLoginModalProps {
  serverUrl: string;
  onClose: () => void;
}

const QrLoginModal: Component<QrLoginModalProps> = (props) => {
  const [qrDataUrl, setQrDataUrl] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [secondsLeft, setSecondsLeft] = createSignal(0);

  let countdownInterval: number | undefined;

  const generateQr = async () => {
    setIsLoading(true);
    setError("");
    setQrDataUrl(null);

    try {
      const response = await qrLoginCreate();
      const uri = `kaiku://qr/login?server=${encodeURIComponent(props.serverUrl)}&token=${response.token}`;
      const dataUrl = await QRCode.toDataURL(uri, {
        width: 256,
        margin: 2,
      });
      setQrDataUrl(dataUrl);
      setSecondsLeft(response.expires_in);

      // Start countdown
      if (countdownInterval) clearInterval(countdownInterval);
      countdownInterval = window.setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            setQrDataUrl(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Generate on mount
  generateQr();

  onCleanup(() => {
    if (countdownInterval) clearInterval(countdownInterval);
  });

  return (
    <Portal>
      <div
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={props.onClose}
      >
        <div
          class="border border-white/10 rounded-2xl w-[400px] shadow-2xl"
          style="background-color: var(--color-surface-layer1)"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 pt-5 pb-2">
            <h2 class="text-lg font-semibold text-text-primary">
              Link Mobile Device
            </h2>
            <button
              onClick={props.onClose}
              class="text-text-secondary hover:text-text-primary transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div class="px-6 py-4 flex flex-col items-center gap-4">
            <p class="text-sm text-text-secondary text-center">
              Scan this code with the Kaiku mobile app to sign in
            </p>

            <Show
              when={!isLoading() && !error() && qrDataUrl()}
              fallback={
                <Show
                  when={!error()}
                  fallback={
                    <div class="text-center py-8">
                      <p class="text-sm text-red-400 mb-3">{error()}</p>
                      <button
                        onClick={generateQr}
                        class="px-4 py-2 rounded-lg text-sm font-medium"
                        style="background-color: var(--color-accent-primary); color: var(--color-surface-base)"
                      >
                        Try again
                      </button>
                    </div>
                  }
                >
                  <div class="w-64 h-64 flex items-center justify-center">
                    <span class="w-8 h-8 border-2 border-white/30 border-t-accent-primary rounded-full animate-spin" />
                  </div>
                </Show>
              }
            >
              <div class="p-3 bg-white rounded-xl">
                <img
                  src={qrDataUrl()!}
                  alt="QR Code"
                  class="w-58 h-58"
                />
              </div>

              <Show
                when={secondsLeft() > 0}
                fallback={
                  <div class="text-center">
                    <p class="text-sm text-text-secondary mb-2">Code expired</p>
                    <button
                      onClick={generateQr}
                      class="px-4 py-2 rounded-lg text-sm font-medium"
                      style="background-color: var(--color-accent-primary); color: var(--color-surface-base)"
                    >
                      Generate new code
                    </button>
                  </div>
                }
              >
                <p class="text-sm text-text-secondary">
                  Expires in {secondsLeft()}s
                </p>
              </Show>
            </Show>
          </div>

          {/* Footer */}
          <div class="px-6 py-4 border-t border-white/10">
            <button
              onClick={props.onClose}
              class="w-full px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default QrLoginModal;
```

**Step 2: Add button to SecuritySettings**

In `SecuritySettings.tsx`, add a "Link Mobile Device" section. Import the modal and add state:

```tsx
const [showQrLogin, setShowQrLogin] = createSignal(false);
```

Add a button in the component JSX (in the security settings area, or a new "Devices" sub-section):

```tsx
<div class="mt-6">
  <h3 class="text-sm font-semibold text-text-primary mb-2">Mobile App</h3>
  <p class="text-sm text-text-secondary mb-3">
    Sign in to the Kaiku mobile app by scanning a QR code
  </p>
  <button
    onClick={() => setShowQrLogin(true)}
    class="px-4 py-2 rounded-lg text-sm font-medium"
    style="background-color: var(--color-accent-primary); color: var(--color-surface-base)"
  >
    Link Mobile Device
  </button>
</div>

<Show when={showQrLogin()}>
  <QrLoginModal
    serverUrl={serverUrl()}
    onClose={() => setShowQrLogin(false)}
  />
</Show>
```

Note: `serverUrl()` comes from the auth store — check how `SecuritySettings` accesses it (likely via `import { useAuth } from "../../stores/auth"` or similar). If not directly available, get it from `browserState.serverUrl` in `tauri.ts`.

**Step 3: Commit**

```bash
git add client/src/components/settings/QrLoginModal.tsx client/src/components/settings/SecuritySettings.tsx
git commit -m "feat(client): add QR login modal in security settings"
```

---

### Task 4: Android — ML Kit Dependency and Camera Permission

**Files:**
- Modify: `mobile/android/app/build.gradle.kts` — add ML Kit dependency
- Modify: `mobile/android/app/src/main/AndroidManifest.xml` — add CAMERA permission

**Step 1: Add ML Kit dependency to build.gradle.kts**

After the WebRTC line (line 122):

```kotlin
// ML Kit Barcode Scanning (QR code login)
implementation("com.google.mlkit:barcode-scanning:17.3.0")
```

Also add CameraX for the camera preview:

```kotlin
// CameraX (for QR scanner camera preview)
implementation("androidx.camera:camera-camera2:1.4.1")
implementation("androidx.camera:camera-lifecycle:1.4.1")
implementation("androidx.camera:camera-view:1.4.1")
```

**Step 2: Add CAMERA permission to AndroidManifest.xml**

After the existing `BLUETOOTH_CONNECT` permission:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

**Step 3: Commit**

```bash
git add mobile/android/app/build.gradle.kts mobile/android/app/src/main/AndroidManifest.xml
git commit -m "chore(client): add ML Kit and CameraX dependencies for QR scanning"
```

---

### Task 5: Android — QR Redeem API Endpoint

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt` — add `redeemQrToken` method

**Step 1: Add request type and interface method**

In `AuthApi.kt`, add a request data class:

```kotlin
@Serializable
private data class QrRedeemRequest(
    val token: String
)
```

Add to the `AuthApi` interface:

```kotlin
suspend fun redeemQrToken(serverUrl: String, token: String): AuthResponse
```

**Step 2: Implement in AuthApiImpl**

This is special — the mobile device may not have a server URL configured yet, so the HTTP client's base URL might not be set. The `redeemQrToken` method needs to call the provided `serverUrl` directly:

```kotlin
override suspend fun redeemQrToken(serverUrl: String, token: String): AuthResponse {
    val url = serverUrl.trimEnd('/') + "/auth/qr/redeem"
    val response = httpClient.post(url) {
        setBody(QrRedeemRequest(token))
    }

    if (!response.status.isSuccess()) {
        val errorBody = runCatching { response.body<ApiErrorResponse>() }.getOrNull()
        throw ApiException(response.status, errorBody?.message ?: "QR code expired or already used")
    }

    return response.body()
}
```

**Step 3: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/data/api/AuthApi.kt
git commit -m "feat(client): add QR token redeem API endpoint"
```

---

### Task 6: Android — QR Scanner Composable

**Files:**
- Create: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrScannerScreen.kt`

**Step 1: Create the QR scanner screen**

This screen uses CameraX preview + ML Kit barcode analysis:

```kotlin
package io.wolftown.kaiku.ui.auth

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QrScannerScreen(
    onQrScanned: (serverUrl: String, token: String) -> Unit,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
        )
    }
    var hasScanned by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scan QR Code") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (hasCameraPermission) {
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()

                            val preview = Preview.Builder().build().also {
                                it.surfaceProvider = previewView.surfaceProvider
                            }

                            val barcodeScanner = BarcodeScanning.getClient()
                            val analysisExecutor = Executors.newSingleThreadExecutor()

                            val imageAnalysis = ImageAnalysis.Builder()
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .build()

                            imageAnalysis.setAnalyzer(analysisExecutor) { imageProxy ->
                                @androidx.camera.core.ExperimentalGetImage
                                val mediaImage = imageProxy.image
                                if (mediaImage != null && !hasScanned) {
                                    val inputImage = InputImage.fromMediaImage(
                                        mediaImage,
                                        imageProxy.imageInfo.rotationDegrees
                                    )
                                    barcodeScanner.process(inputImage)
                                        .addOnSuccessListener { barcodes ->
                                            for (barcode in barcodes) {
                                                if (barcode.valueType == Barcode.TYPE_URL ||
                                                    barcode.valueType == Barcode.TYPE_TEXT
                                                ) {
                                                    val raw = barcode.rawValue ?: continue
                                                    val parsed = parseKaikuQrUri(raw)
                                                    if (parsed != null && !hasScanned) {
                                                        hasScanned = true
                                                        onQrScanned(parsed.first, parsed.second)
                                                    }
                                                }
                                            }
                                        }
                                        .addOnCompleteListener {
                                            imageProxy.close()
                                        }
                                } else {
                                    imageProxy.close()
                                }
                            }

                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    CameraSelector.DEFAULT_BACK_CAMERA,
                                    preview,
                                    imageAnalysis
                                )
                            } catch (e: Exception) {
                                // Camera bind failed
                            }
                        }, ContextCompat.getMainExecutor(ctx))

                        previewView
                    },
                    modifier = Modifier.fillMaxSize()
                )

                // Overlay hint
                Text(
                    text = "Point your camera at the QR code",
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(32.dp),
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyLarge
                )
            } else {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "Camera permission is required to scan QR codes",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                        Text("Grant permission")
                    }
                }
            }
        }
    }
}

/**
 * Parses a `kaiku://qr/login?server=...&token=...` URI.
 * Returns (serverUrl, token) or null if the URI doesn't match.
 */
private fun parseKaikuQrUri(raw: String): Pair<String, String>? {
    val uri = android.net.Uri.parse(raw)
    if (uri.scheme != "kaiku" || uri.host != "qr" || uri.path != "/login") return null
    val server = uri.getQueryParameter("server") ?: return null
    val token = uri.getQueryParameter("token") ?: return null
    return Pair(server, token)
}
```

**Step 2: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrScannerScreen.kt
git commit -m "feat(client): add QR scanner screen with CameraX and ML Kit"
```

---

### Task 7: Android — QR Login Flow and Navigation

**Files:**
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/KaikuNavGraph.kt` — add `qr_scanner` route
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/ServerUrlScreen.kt` — add "Scan QR Code" button
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/settings/SettingsScreen.kt` — add "Scan QR Code" button
- Modify: `mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt` — add `redeemQrToken` method

**Step 1: Add `redeemQrToken` to AuthRepository**

```kotlin
suspend fun redeemQrToken(serverUrl: String, token: String): Result<User> {
    return try {
        tokenStorage.saveServerUrl(serverUrl)

        val authResponse = authApi.redeemQrToken(serverUrl, token)

        tokenStorage.saveTokens(
            accessToken = authResponse.accessToken,
            refreshToken = authResponse.refreshToken ?: "",
            expiresIn = authResponse.expiresIn,
            userId = ""
        )

        val user = authApi.getMe()

        tokenStorage.saveTokens(
            accessToken = authResponse.accessToken,
            refreshToken = authResponse.refreshToken ?: "",
            expiresIn = authResponse.expiresIn,
            userId = user.id
        )

        authState.setLoggedIn(user.id)
        Result.success(user)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

**Step 2: Add `qr_scanner` route to KaikuNavGraph**

In the `NavHost` block, add:

```kotlin
composable("qr_scanner") {
    QrScannerScreen(
        onQrScanned = { serverUrl, token ->
            // Navigate to a loading/redeem screen, or handle inline
            navController.navigate("qr_redeem/$serverUrl/$token") {
                popUpTo("qr_scanner") { inclusive = true }
            }
        },
        onNavigateBack = { navController.popBackStack() }
    )
}

composable("qr_redeem/{serverUrl}/{token}") { backStackEntry ->
    val serverUrl = backStackEntry.arguments?.getString("serverUrl") ?: ""
    val token = backStackEntry.arguments?.getString("token") ?: ""
    QrRedeemScreen(
        serverUrl = serverUrl,
        token = token,
        onSuccess = {
            navController.navigate("home") {
                popUpTo(0) { inclusive = true }
            }
        },
        onError = {
            navController.popBackStack()
        }
    )
}
```

Note: The `serverUrl` may contain special characters. Use `Uri.encode()`/`Uri.decode()` for safe navigation argument passing, or pass via SavedStateHandle. A simpler approach is to URL-encode the serverUrl in the route.

**Step 3: Create a minimal QrRedeemScreen**

Create `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrRedeemScreen.kt`:

```kotlin
package io.wolftown.kaiku.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.wolftown.kaiku.data.repository.AuthRepository
import kotlinx.coroutines.launch

@Composable
fun QrRedeemScreen(
    serverUrl: String,
    token: String,
    onSuccess: () -> Unit,
    onError: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    // Inject AuthRepository via a ViewModel or directly
    // For simplicity, use a dedicated ViewModel
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
```

Create `mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrRedeemViewModel.kt`:

```kotlin
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
```

**Step 4: Add "Scan QR Code" button to ServerUrlScreen**

In `ServerUrlScreen.kt`, add a button below the "Connect" button:

```kotlin
Spacer(modifier = Modifier.height(16.dp))

HorizontalDivider()

Spacer(modifier = Modifier.height(16.dp))

OutlinedButton(
    onClick = onScanQrCode,
    modifier = Modifier.fillMaxWidth()
) {
    Text("Scan QR Code")
}
```

Add `onScanQrCode: () -> Unit = {}` to the `ServerUrlScreen` composable parameters.

Wire it in `KaikuNavGraph`:

```kotlin
composable("server_url") {
    ServerUrlScreen(
        onConnectSuccess = { /* ... existing ... */ },
        onScanQrCode = { navController.navigate("qr_scanner") }
    )
}
```

**Step 5: Add "Scan QR Code" button to SettingsScreen**

In `SettingsScreen.kt`, add between the Server section and About section:

```kotlin
HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

OutlinedButton(
    onClick = onScanQrCode,
    modifier = Modifier.fillMaxWidth()
) {
    Text("Scan QR Code to sign in")
}
```

Add `onScanQrCode: () -> Unit = {}` to `SettingsScreen` parameters.

Wire in `KaikuNavGraph`:

```kotlin
composable("settings") {
    SettingsScreen(
        appVersion = appVersion,
        onNavigateBack = { navController.popBackStack() },
        onLogout = { /* ... existing ... */ },
        onScanQrCode = { navController.navigate("qr_scanner") }
    )
}
```

**Step 6: Commit**

```bash
git add mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrRedeemScreen.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/QrRedeemViewModel.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/auth/ServerUrlScreen.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/settings/SettingsScreen.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/ui/KaikuNavGraph.kt \
       mobile/android/app/src/main/java/io/wolftown/kaiku/data/repository/AuthRepository.kt
git commit -m "feat(client): wire QR scanner into Android navigation and auth flow"
```

---

### Task 8: Tests and CHANGELOG

**Files:**
- Create: `mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt`
- Modify: `CHANGELOG.md`

**Step 1: Write QrLoginFlowTest**

```kotlin
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
        accessToken = "qr-access-token",
        refreshToken = "qr-refresh-token",
        expiresIn = 900,
        tokenType = "Bearer"
    )

    @Before
    fun setUp() {
        authApi = mockk()
        tokenStorage = mockk(relaxed = true)
        authState = AuthState()
        authRepository = AuthRepository(authApi, tokenStorage, authState)
    }

    @Test
    fun `QR redeem stores server URL, tokens, and sets auth state`() = runTest {
        coEvery { authApi.redeemQrToken("https://chat.example.com", "test-token") } returns testAuthResponse
        coEvery { authApi.getMe() } returns testUser

        val result = authRepository.redeemQrToken("https://chat.example.com", "test-token")

        assertTrue(result.isSuccess)
        assertEquals(testUser, result.getOrNull())

        verify { tokenStorage.saveServerUrl("https://chat.example.com") }
        verify {
            tokenStorage.saveTokens(
                accessToken = "qr-access-token",
                refreshToken = "qr-refresh-token",
                expiresIn = 900,
                userId = "user-42"
            )
        }
        assertTrue(authState.isLoggedIn.value)
        assertEquals("user-42", authState.currentUserId.value)
    }

    @Test
    fun `QR redeem with expired token returns failure`() = runTest {
        coEvery {
            authApi.redeemQrToken("https://chat.example.com", "expired-token")
        } throws Exception("QR code expired or already used")

        val result = authRepository.redeemQrToken("https://chat.example.com", "expired-token")

        assertTrue(result.isFailure)
        assertFalse(authState.isLoggedIn.value)
    }

    @Test
    fun `parseKaikuQrUri extracts server and token`() {
        val uri = android.net.Uri.parse("kaiku://qr/login?server=https%3A%2F%2Fchat.example.com&token=abc-123")
        assertEquals("kaiku", uri.scheme)
        assertEquals("qr", uri.host)
        assertEquals("/login", uri.path)
        assertEquals("https://chat.example.com", uri.getQueryParameter("server"))
        assertEquals("abc-123", uri.getQueryParameter("token"))
    }
}
```

Note: The `parseKaikuQrUri` test uses `android.net.Uri` which requires Robolectric or an instrumented test. If running as pure JUnit, mock it or test with a simple string parser instead. Adjust based on test runner.

**Step 2: Update CHANGELOG.md**

Under `### Added` in `[Unreleased]`:

```markdown
- QR code login — generate a QR code on desktop to instantly sign in on the Android app, no manual URL entry or credentials needed
```

**Step 3: Commit**

```bash
git add mobile/android/app/src/test/java/io/wolftown/kaiku/integration/QrLoginFlowTest.kt CHANGELOG.md
git commit -m "test(auth): add QR login flow test and changelog entry"
```

---

## Task Dependencies

```
Task 1 (server endpoints)
  → Task 2 (desktop API function)
    → Task 3 (desktop QR modal)
  → Task 4 (Android deps) — parallel with Task 2
    → Task 5 (Android API endpoint)
      → Task 6 (QR scanner composable)
        → Task 7 (navigation + flow wiring)
          → Task 8 (tests + changelog)
```

Tasks 2-3 (desktop) and Tasks 4-7 (Android) can be developed in parallel after Task 1.
