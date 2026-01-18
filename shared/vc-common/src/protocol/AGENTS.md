# WebSocket Protocol

**Parent:** [../AGENTS.md](../AGENTS.md)

## Purpose

WebSocket protocol message definitions for real-time bidirectional communication between client and server. Defines all events that can be sent over the WebSocket connection.

**Key types:**
- `ClientEvent` — Events sent from client to server
- `ServerEvent` — Events sent from server to client
- `WsMessage<T>` — Message wrapper with optional request ID for correlation

## Key Files

| File | Purpose |
|------|---------|
| `mod.rs` | Complete protocol definition (all events and message wrapper) |

## For AI Agents

### Protocol design

The WebSocket protocol uses **tagged enums** for type-safe message parsing:

```rust
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    Ping,
    Subscribe { channel_id: Uuid },
    Typing { channel_id: Uuid },
    // ...
}
```

**JSON representation:**
```json
{
  "type": "subscribe",
  "channel_id": "01936e9a-4b7e-7f3c-8d5a-2f1e3c4b5a6d"
}
```

### Event categories

**ClientEvent categories:**

| Category | Events | Purpose |
|----------|--------|---------|
| Connection | `Ping` | Keepalive |
| Subscriptions | `Subscribe`, `Unsubscribe` | Channel event subscriptions |
| Typing | `Typing`, `StopTyping` | Typing indicators |
| Voice Signaling | `VoiceJoin`, `VoiceLeave`, `VoiceOffer`, `VoiceAnswer`, `VoiceIce` | WebRTC signaling |
| Voice Control | `VoiceMute`, `VoiceUnmute` | Audio control |

**ServerEvent categories:**

| Category | Events | Purpose |
|----------|--------|---------|
| Connection | `Pong`, `Ready` | Keepalive, authentication confirmation |
| Messages | `MessageCreate`, `MessageUpdate`, `MessageDelete` | Chat events |
| Typing | `TypingStart`, `TypingStop` | Typing indicators |
| Presence | `PresenceUpdate` | User status changes |
| Voice Events | `VoiceUserJoined`, `VoiceUserLeft`, `VoiceSpeaking` | Voice channel activity |
| Voice Signaling | `VoiceOffer`, `VoiceAnswer`, `VoiceIce` | WebRTC signaling relay |
| Errors | `Error` | Error responses |

### Adding new events

**Client-to-server event:**
```rust
pub enum ClientEvent {
    // ...existing variants...

    /// Brief description of what client is requesting
    NewAction {
        /// Field documentation
        channel_id: Uuid,
        /// Additional data
        data: String,
    },
}
```

**Server-to-client event:**
```rust
pub enum ServerEvent {
    // ...existing variants...

    /// Brief description of server notification
    NewNotification {
        /// What entity this affects
        channel_id: Uuid,
        /// The actual data
        payload: SomeType,
    },
}
```

### Request-response correlation

For events that need response tracking, use `WsMessage<T>`:

```rust
pub struct WsMessage<T> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,  // Client-generated request ID
    #[serde(flatten)]
    pub event: T,  // The actual ClientEvent or ServerEvent
}
```

**Client sends:**
```json
{
  "id": "req-123",
  "type": "subscribe",
  "channel_id": "..."
}
```

**Server can reference:**
```json
{
  "id": "req-123",
  "type": "error",
  "code": "CHANNEL_NOT_FOUND",
  "message": "Channel does not exist"
}
```

### Voice protocol flow

The voice events implement WebRTC signaling:

1. **Join:** Client sends `VoiceJoin { channel_id }`
2. **Notify:** Server sends `VoiceUserJoined` to all participants
3. **Signaling:** Exchange of `VoiceOffer`, `VoiceAnswer`, `VoiceIce` for WebRTC peer connections
4. **Speaking:** Server sends `VoiceSpeaking { user_id, speaking: bool }` based on audio activity
5. **Leave:** Client sends `VoiceLeave`, server sends `VoiceUserLeft`

### Error handling

Errors use structured codes for client-side handling:

```rust
ServerEvent::Error {
    code: "PERMISSION_DENIED",  // Machine-readable code
    message: "You don't have permission to access this channel",  // Human-readable
}
```

**Common error codes to use:**
- `PERMISSION_DENIED` — Authorization failure
- `NOT_FOUND` — Entity doesn't exist
- `VALIDATION_ERROR` — Invalid input
- `RATE_LIMITED` — Too many requests
- `SERVER_ERROR` — Internal error

### Backwards compatibility

**Breaking changes:**
- Removing event variants
- Renaming event variants (unless aliased with `#[serde(alias)]`)
- Removing fields from events
- Changing field types

**Safe changes:**
- Adding new event variants (clients ignore unknown types)
- Adding optional fields: `field: Option<T>`
- Adding fields to existing events if server includes them conditionally

### Common patterns

**Broadcast events:**
Events like `MessageCreate`, `PresenceUpdate`, `VoiceSpeaking` are broadcast to all relevant clients.

**Targeted events:**
Events like `Ready`, specific `Error` responses are sent only to the requesting client.

**Idempotency:**
Events like `Subscribe`, `VoiceJoin` should be idempotent (subscribing twice = same as once).

### Testing

Test serialization round-trips for all events:

```rust
#[test]
fn test_client_event_serde() {
    let event = ClientEvent::Subscribe {
        channel_id: Uuid::new_v4(),
    };
    let json = serde_json::to_string(&event).unwrap();
    let parsed: ClientEvent = serde_json::from_str(&json).unwrap();
    // Verify structure matches expected JSON format
}
```

### Performance considerations

- Events are serialized/deserialized frequently (hot path)
- Keep event structures flat (avoid deep nesting)
- Use `Uuid` directly instead of `String` for IDs
- Large payloads (file uploads) should NOT use WebSocket (use REST API)

### Security notes

- All events are sent over authenticated WebSocket connections
- Server MUST validate permissions for all ClientEvents
- Server MUST NOT echo sensitive data (passwords, tokens) in any ServerEvent
- Rate limiting applies to all ClientEvents
- Channel subscription doesn't grant permission (server validates on message send)
