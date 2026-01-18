# Tauri Rust Client Source

**Parent:** [Client Root](../../AGENTS.md)

**Purpose:** Core Rust backend for the Tauri desktop client. Provides native capabilities for audio processing, WebRTC connections, cryptography, and system integration. Acts as the bridge between the Solid.js frontend (WebView) and low-level system resources.

## Architecture

```
Frontend (Solid.js) → Tauri IPC → Rust Backend → System Resources
                                   ├── Audio (cpal, opus)
                                   ├── WebRTC (webrtc-rs)
                                   ├── Network (reqwest, WebSocket)
                                   └── Crypto (vodozemac)
```

## Key Files

### `lib.rs`
Main library entry point. Defines:
- **`AppState`**: Shared application state (HTTP client, auth, WebSocket, voice)
- **`run()`**: Tauri application builder with all command handlers
- **`AuthState`**: Authentication tokens and user profile
- **`VoiceState`**: WebRTC client and audio handle
- **`User`** / **`UserStatus`**: User data models

**Key Pattern:** All state is wrapped in `Arc<RwLock<T>>` for thread-safe async access across Tauri commands.

### `main.rs`
Minimal entry point. Calls `vc_client::run()` to start the application.

## Module Structure

| Module | Purpose | Critical Path |
|--------|---------|---------------|
| `audio/` | Audio I/O with cpal, Opus encoding/decoding | **PERFORMANCE CRITICAL** |
| `commands/` | Tauri IPC command handlers (auth, chat, voice, settings, WebSocket) | Frontend bridge |
| `crypto/` | E2EE with vodozemac (Olm/Megolm) | Placeholder for future |
| `network/` | HTTP (reqwest) and WebSocket (tokio-tungstenite) | Real-time events |
| `webrtc/` | WebRTC peer connections for voice | **PERFORMANCE CRITICAL** |

## Important Patterns

### State Management
All commands receive `State<'_, AppState>` injected by Tauri. State is shared across all command invocations:

```rust
#[command]
pub async fn some_command(state: State<'_, AppState>) -> Result<T, String> {
    let auth = state.auth.read().await;
    // ...
}
```

### Error Handling
- Commands return `Result<T, String>` for frontend-friendly errors
- Internal modules use `thiserror` for structured errors
- Always log errors with `tracing::{error, warn}`

### Async/Tokio
- All commands are `async fn`
- Use `tokio::spawn` for background tasks
- Use `mpsc::channel` for inter-task communication

### Voice State Initialization
Voice state (WebRTC + Audio) is lazily initialized on first use:

```rust
state.ensure_voice().await?; // Initializes if needed
```

## Performance Constraints

| Constraint | Target | Measurement |
|------------|--------|-------------|
| Voice Latency | <50ms end-to-end | Audio capture → encode → send + receive → decode → playback |
| RAM (Idle) | <80MB | Process memory |
| CPU (Idle) | <1% | Process CPU usage |
| Startup | <3s | App launch to ready |

## Security Patterns

### Token Storage
- **Access tokens**: In-memory only (`AppState.auth`)
- **Refresh tokens**: Stored in OS keyring (keyring-rs)
- Never log tokens

### Input Validation
- All user input from frontend is untrusted
- Validate before sending to server
- Use server-side validation as final authority

### Secrets Management
- No hardcoded credentials
- Use environment variables for development config
- Production config from secure storage

## Testing

Run tests:
```bash
cd client/src-tauri
cargo test
```

Key test patterns:
- Audio tests may fail on CI without hardware (wrapped with `let _ = result;`)
- WebRTC tests create clients but don't require network
- Commands should be integration tested with mock `AppState`

## Common Operations

### Add New Command
1. Define function in `commands/<module>.rs` with `#[command]` attribute
2. Register in `lib.rs` `invoke_handler!` macro
3. Call from frontend with `invoke('<command_name>', { args })`

### Add New Dependency
1. Check license compatibility (see `CLAUDE.md`)
2. Run `cargo deny check licenses` after adding
3. Document in `LICENSE_COMPLIANCE.md`

### Debugging
Enable debug logs:
```bash
RUST_LOG=vc_client=debug cargo run
```

Or set in `lib.rs` setup:
```rust
tracing_subscriber::EnvFilter::from_default_env()
    .or_else(|_| "vc_client=debug".into())
```

## Related Documentation

- [Architecture](../../../../ARCHITECTURE.md) — Overall system design
- [Client Frontend](../src/AGENTS.md) — Solid.js WebView layer
- [Standards](../../../../STANDARDS.md) — WebRTC, E2EE protocols
