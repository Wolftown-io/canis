# Network Module

**Parent:** [Tauri Source](../AGENTS.md)

**Purpose:** HTTP client for REST API calls and WebSocket client for real-time server events. Provides the communication layer between Tauri client and server.

## Architecture

```
Tauri Commands
    ↓ HTTP (reqwest)
Server REST API (/auth, /channels, /messages, /users)
    ↓ JSON responses
Tauri Commands return data to frontend

Frontend Events
    ↓ WebSocket (tokio-tungstenite)
Server WebSocket (/ws?token=...)
    ↓ ServerEvent JSON
WebSocketManager forwards to frontend via Tauri events
```

## Module Structure

| File | Purpose | Key Types |
|------|---------|-----------|
| `mod.rs` | Module root | Re-exports `WebSocketManager`, `ClientEvent`, `ConnectionStatus` |
| `websocket.rs` | WebSocket lifecycle and event routing | `WebSocketManager`, `ClientEvent`, `ServerEvent` |

## Key Files

### `websocket.rs`
**Purpose:** Bidirectional real-time communication with server.

**Key Types:**

#### `ClientEvent` (Client → Server)
```rust
enum ClientEvent {
    Ping,
    Subscribe { channel_id: String },
    Unsubscribe { channel_id: String },
    Typing { channel_id: String },
    StopTyping { channel_id: String },
    VoiceJoin { channel_id: String },
    VoiceLeave { channel_id: String },
    VoiceAnswer { channel_id: String, sdp: String },
    VoiceIceCandidate { channel_id: String, candidate: String },
    VoiceMute { channel_id: String },
    VoiceUnmute { channel_id: String },
}
```

#### `ServerEvent` (Server → Client)
```rust
enum ServerEvent {
    Ready { user_id: String },
    Pong,
    Subscribed { channel_id: String },
    Unsubscribed { channel_id: String },
    MessageNew { channel_id: String, message: Value },
    MessageEdit { channel_id: String, message_id: String, content: String, edited_at: String },
    MessageDelete { channel_id: String, message_id: String },
    TypingStart { channel_id: String, user_id: String },
    TypingStop { channel_id: String, user_id: String },
    PresenceUpdate { user_id: String, status: String },
    VoiceOffer { channel_id: String, sdp: String },
    VoiceIceCandidate { channel_id: String, candidate: String },
    // ... (truncated for brevity)
}
```

#### `ConnectionStatus`
```rust
enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}
```

#### `WebSocketManager`
Manages WebSocket lifecycle:
- **Connect**: Establish WebSocket, start send/receive tasks
- **Disconnect**: Clean shutdown
- **Send**: Queue `ClientEvent` for server
- **Receive**: Forward `ServerEvent` to frontend via Tauri events

## Key Patterns

### Connection Flow
1. **Connect:**
   ```rust
   let ws_manager = WebSocketManager::new(&server_url, &token, app_handle).await?;
   *state.websocket.write().await = Some(ws_manager);
   ```

2. **WebSocket URL:** `wss://{server_url}/ws?token={access_token}`

3. **Handshake:** Server sends `ServerEvent::Ready { user_id }` on success

4. **Heartbeat:** Client sends `ClientEvent::Ping` every 30s, expects `ServerEvent::Pong`

### Send/Receive Tasks
WebSocketManager spawns two tokio tasks:

**Send Task:**
- Reads from `mpsc::Receiver<ClientEvent>`
- Serializes to JSON, sends as WebSocket message

**Receive Task:**
- Reads WebSocket messages
- Deserializes to `ServerEvent`
- Emits Tauri event to frontend (e.g., `app.emit("ws:message_new", event)`)

**Lifetime:** Tasks run until WebSocket closes or `disconnect()` called.

### Event Routing (Server → Frontend)
Server events map to Tauri events:

| ServerEvent | Tauri Event | Payload |
|-------------|-------------|---------|
| `MessageNew` | `ws:message_new` | `{ channel_id, message }` |
| `TypingStart` | `ws:typing_start` | `{ channel_id, user_id }` |
| `VoiceOffer` | `ws:voice_offer` | `{ channel_id, sdp }` |
| `PresenceUpdate` | `ws:presence_update` | `{ user_id, status }` |

Frontend listens:
```typescript
import { listen } from '@tauri-apps/api/event';
listen('ws:message_new', (event) => {
    console.log('New message:', event.payload);
});
```

### Reconnection (Future)
Not yet implemented. Planned:
- Exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Persist subscriptions, re-subscribe on reconnect
- Queue client events during disconnection

## HTTP Client

**Location:** `AppState.http` (reqwest client, initialized in `lib.rs`)

**Configuration:**
```rust
HttpClient::builder()
    .timeout(Duration::from_secs(30))
    .build()
```

**Usage in Commands:**
```rust
let response = state.http
    .get(format!("{server_url}/channels"))
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await?;
```

**Error Handling:**
- Network errors: `map_err(|e| format!("Connection failed: {}", e))`
- HTTP errors: Check `response.status().is_success()`
- Deserialize errors: `response.json::<T>().await.map_err(...)`

## Testing

### Unit Tests
Not yet implemented for WebSocketManager.

**Future:**
- Mock WebSocket server (e.g., with `tungstenite` test utilities)
- Test event serialization/deserialization
- Test reconnection logic

### Integration Tests
Test from frontend:
```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

test('WebSocket message flow', async () => {
    await invoke('ws_connect', { serverUrl: 'wss://example.com', token: 'test' });

    const received = new Promise((resolve) => {
        listen('ws:ready', (event) => resolve(event.payload));
    });

    expect(await received).toHaveProperty('user_id');
});
```

## Common Issues

### Connection Refused
- **Cause:** Server not running or wrong URL
- **Debug:** Check server logs, verify URL format (`wss://` not `ws://` in production)

### Authentication Failed
- **Cause:** Invalid/expired token
- **Debug:** Token should be fresh access token, not refresh token
- **Fix:** Re-login to get new token

### Events Not Received
- **Cause:** Event name mismatch (frontend expects `ws:message_new`, backend emits `message_new`)
- **Fix:** Ensure consistent event naming (use `ws:` prefix)

### WebSocket Closes Immediately
- **Cause:** Server rejected connection (auth failure, rate limit)
- **Debug:** Check server logs for close code/reason
- **Fix:** Server should send close frame with reason

## Performance Considerations

### Batching
Not yet implemented. Future optimization:
- Batch multiple `ClientEvent`s into single WebSocket message
- Reduce overhead for high-frequency events (e.g., typing indicators)

### Backpressure
- **Problem:** Frontend receives events faster than it can process
- **Current:** Unbounded channel (risk of OOM)
- **Future:** Bounded channel with overflow strategy (drop old events)

### Compression
Not yet implemented. Future:
- Enable permessage-deflate extension
- Reduce bandwidth for text-heavy events

## Security

### TLS
- **Production:** Always use `wss://` (WebSocket over TLS)
- **Development:** `ws://` acceptable for localhost only

### Authentication
- **Query Param:** `?token={access_token}` (not ideal, but simple)
- **Future:** Send token in WebSocket sub-protocol header

### Input Validation
- **Server-side:** All client events must be validated server-side
- **Client-side:** Validate server events to prevent injection (e.g., malicious JSON)

### Rate Limiting
- **Not yet implemented client-side**
- **Server-side:** Implemented (see `server/src/ratelimit/`)

## Future Improvements

1. **Auto-reconnection:** Exponential backoff, subscription restoration
2. **Event Replay:** Request missed events after reconnection
3. **Compression:** Enable permessage-deflate
4. **Binary Protocol:** Switch to MessagePack or Protobuf for efficiency
5. **WebSocket Subprotocols:** Structured versioning

## Related Documentation

- [Server WebSocket](../../../../server/src/ws/AGENTS.md) — Server-side WebSocket handling
- [Commands](../commands/AGENTS.md) — Tauri commands that use network layer
- [Frontend Events](../../src/lib/api/events.ts) — TypeScript event listeners
