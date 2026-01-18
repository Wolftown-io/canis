# vc-common — Shared Types & WebSocket Protocol

**Parent:** [../AGENTS.md](../AGENTS.md)

## Purpose

Common types and protocol definitions shared between server and client. Ensures type-safe communication across the WebSocket boundary and consistent domain model representations.

**Key responsibilities:**
- Domain types (User, Channel, Message)
- WebSocket protocol events (ClientEvent, ServerEvent)
- Common error types
- Serialization contracts (JSON via serde)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib.rs` | Public API surface, re-exports |
| `src/error.rs` | Common error types |
| `src/protocol/mod.rs` | WebSocket protocol (ClientEvent, ServerEvent, WsMessage) |
| `src/types/mod.rs` | Domain types re-exports |
| `src/types/user.rs` | User, UserProfile, UserStatus |
| `src/types/channel.rs` | Channel types |
| `src/types/message.rs` | Message types |

## Subdirectories

### `src/protocol/`
WebSocket protocol definitions for real-time bidirectional communication.

**Key types:**
- `ClientEvent` — Tagged enum of client-to-server events (Subscribe, Typing, VoiceJoin, etc.)
- `ServerEvent` — Tagged enum of server-to-client events (MessageCreate, PresenceUpdate, VoiceOffer, etc.)
- `WsMessage<T>` — Wrapper with optional request ID for correlation

### `src/types/`
Core domain types representing platform entities.

**Modules:**
- `user.rs` — User identity and presence
- `channel.rs` — Text and voice channels
- `message.rs` — Chat messages and metadata

## For AI Agents

### When to modify this crate

**DO modify when:**
- Adding new domain entities (new types that both client and server need)
- Extending WebSocket protocol (new events for real-time features)
- Adding common error variants that cross boundaries
- Changing serialization format (coordinate with server + client)

**DON'T modify when:**
- Adding server-only logic (goes in `server/`)
- Adding client-only UI state (goes in `client/`)
- Implementing business logic (types here are data-only)

### Critical constraints

**Serialization stability:**
- All public types must be `#[derive(Serialize, Deserialize)]`
- Field renames require `#[serde(rename = "...")]` for backwards compatibility
- Enum variants use `#[serde(tag = "type", rename_all = "snake_case")]` for tagged unions

**Dependencies:**
- Only data-oriented crates (serde, uuid, chrono, thiserror)
- NO async runtime (tokio/async-std)
- NO database/network libraries
- Must build in WASM (client target)

**Breaking changes:**
- Protocol changes (ClientEvent/ServerEvent) are ALWAYS breaking
- Adding fields OK if `#[serde(default)]` or `Option<T>`
- Removing/renaming fields requires version coordination

### Common patterns

**Adding a new WebSocket event:**
```rust
// In src/protocol/mod.rs

// Client-to-server
pub enum ClientEvent {
    // ...existing variants...

    /// New feature event
    NewFeature {
        /// Field documentation
        field: Type,
    },
}

// Server-to-client
pub enum ServerEvent {
    // ...existing variants...

    /// New feature response
    NewFeatureResponse {
        /// Response data
        data: Type,
    },
}
```

**Adding a new domain type:**
```rust
// Create src/types/new_entity.rs
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEntity {
    pub id: Uuid,
    // Other fields...
}

// Export from src/types/mod.rs
mod new_entity;
pub use new_entity::*;
```

### Testing notes

- No business logic means minimal unit tests
- Focus on serialization round-trips
- Verify JSON format matches API documentation
- Test backwards compatibility when evolving types

### Architecture notes

**Contract-first design:**
- This crate IS the contract between client and server
- Changes here ripple to both sides
- Document expected behaviors in type comments
- Keep types minimal (no Helper methods that belong in server/client)

**UUIDv7 everywhere:**
- All IDs use UUIDv7 (time-sortable, decentralized generation)
- Enables offline-first features later

**WebSocket protocol:**
- Uses tagged enums for type safety
- Optional request IDs for request-response correlation
- Error events carry structured codes for client handling
