# vc-common Source Code

**Parent:** [../AGENTS.md](../AGENTS.md)

## Purpose

Implementation directory for the `vc-common` crate. Contains all Rust source code for shared types, protocol definitions, and error handling used across client and server.

**Modules:**
- `error.rs` — Common error types (`Error`, `Result`)
- `lib.rs` — Crate root with public API re-exports
- `protocol/` — WebSocket protocol message types
- `types/` — Domain entity definitions

## Subdirectories

### `protocol/`
WebSocket protocol definitions for bidirectional real-time communication.

See [protocol/AGENTS.md](protocol/AGENTS.md)

### `types/`
Core domain types representing platform entities (User, Channel, Message, etc.).

See [types/AGENTS.md](types/AGENTS.md)

## For AI Agents

### Module structure

```
vc-common/src/
├── lib.rs          # Public API, re-exports protocol and types
├── error.rs        # thiserror-based Error enum
├── protocol/
│   └── mod.rs      # ClientEvent, ServerEvent, WsMessage
└── types/
    ├── mod.rs      # Re-exports all domain types
    ├── user.rs     # User, UserProfile, UserStatus
    ├── channel.rs  # Channel, ChannelCategory, ChannelType
    └── message.rs  # Message and related types
```

### Key files

| File | Purpose | Key Types |
|------|---------|-----------|
| `lib.rs` | Crate entry point | Re-exports from `error`, `protocol`, `types` |
| `error.rs` | Error handling | `Error`, `Result<T>` |
| `protocol/mod.rs` | WebSocket events | `ClientEvent`, `ServerEvent`, `WsMessage<T>` |
| `types/user.rs` | User entities | `User`, `UserProfile`, `UserStatus` |
| `types/channel.rs` | Channel entities | `Channel`, `ChannelCategory`, `ChannelType` |
| `types/message.rs` | Message entities | `Message` and attachments |

### Serialization conventions

All public types follow strict serialization rules:

```rust
// Enums use tagged unions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    Ping,
    Subscribe { channel_id: Uuid },
    // ...
}

// Simple enums use rename_all
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
    Online,
    Away,
    Busy,
    Offline,
}

// Structs are straightforward
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub username: String,
    // ...
}
```

### Adding new types

**New domain type:**
1. Create file in `types/` (e.g., `guild.rs`)
2. Add module declaration to `types/mod.rs`
3. Add `pub use guild::*;` to `types/mod.rs`
4. Ensure all types derive `Serialize, Deserialize`

**New WebSocket event:**
1. Add variant to `ClientEvent` or `ServerEvent` in `protocol/mod.rs`
2. Use descriptive field names with doc comments
3. Match existing naming patterns (snake_case in JSON)

### Common mistakes to avoid

- DON'T add business logic here (data-only crate)
- DON'T import async runtime (tokio, async-std)
- DON'T import database/network crates
- DON'T break WASM compatibility (client needs to build this)
- DO ensure all public types are serializable
- DO document fields with doc comments
- DO use `Option<T>` for optional fields
- DO use `#[serde(default)]` when adding fields to existing types

### Testing patterns

Focus on serialization correctness:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_status_serde() {
        let status = UserStatus::Online;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, r#""online""#);

        let parsed: UserStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, status);
    }
}
```

### Backwards compatibility

When evolving types:

**Safe changes:**
- Adding new enum variants (if server handles unknown variants)
- Adding optional fields: `pub new_field: Option<T>`
- Adding fields with `#[serde(default)]`

**Breaking changes:**
- Removing fields
- Renaming fields without `#[serde(rename = "old_name")]`
- Changing field types
- Reordering enum variants (if using untagged representation)

Always coordinate protocol changes with both server and client teams.

### Architecture constraints

**Dependencies allowed:**
- serde, serde_json — Serialization
- uuid — UUIDv7 identifiers
- chrono — Timestamps
- thiserror — Error types

**Dependencies NOT allowed:**
- tokio, async-std — No async runtime
- sqlx, diesel — No database
- reqwest, hyper — No HTTP
- Any WASM-incompatible crate

This crate must build for:
- x86_64-unknown-linux-gnu (server)
- wasm32-unknown-unknown (client WebView)
- x86_64-pc-windows-msvc, x86_64-apple-darwin (Tauri client)
