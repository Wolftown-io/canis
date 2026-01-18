# Domain Types

**Parent:** [../AGENTS.md](../AGENTS.md)

## Purpose

Core domain type definitions representing platform entities. These types are shared between client and server to ensure consistent data models across the application boundary.

**Entities:**
- User identity and presence (User, UserProfile, UserStatus)
- Channel organization (Channel, ChannelCategory, ChannelType)
- Chat messages (Message)

## Key Files

| File | Purpose | Key Types |
|------|---------|-----------|
| `mod.rs` | Re-exports all domain types | N/A |
| `user.rs` | User identity and presence | `User`, `UserProfile`, `UserStatus` |
| `channel.rs` | Channel and category types | `Channel`, `ChannelCategory`, `ChannelType` |
| `message.rs` | Message types | `Message` |

## For AI Agents

### Type hierarchy

**User types:**
```
UserStatus (enum: Online, Away, Busy, Offline)
   ↓
UserProfile (public info: id, username, display_name, avatar_url, status)
   ↓
User (full info: includes email, mfa_enabled, created_at)
```

**Channel types:**
```
ChannelType (enum: Text, Voice, Dm)
   ↓
Channel (id, name, channel_type, category_id, topic, user_limit, position)
   ↓
ChannelCategory (id, name, position, channels: Vec<Channel>)
```

### user.rs

**`UserStatus`** — User presence state
- `Online` — Actively using the application
- `Away` — Idle/AFK
- `Busy` — Do not disturb mode
- `Offline` — Not connected (default)

Serializes to lowercase JSON: `"online"`, `"away"`, `"busy"`, `"offline"`

**`UserProfile`** — Public user information
- Sent to other users (doesn't contain sensitive data)
- Includes: id, username, display_name, avatar_url, status
- Used in: WebSocket events, API responses, member lists

**`User`** — Complete user data
- Sent only to the authenticated user themselves
- Includes everything in `UserProfile` plus: email, mfa_enabled, created_at
- Used in: `/api/users/@me` response, authentication flows

**When to use which:**
- Other users see you → `UserProfile`
- You see yourself → `User`
- Status updates → `UserStatus`

### channel.rs

**`ChannelType`** — Channel purpose
- `Text` — Text chat channel
- `Voice` — Voice channel
- `Dm` — Direct message (1-on-1 or group)

Serializes to lowercase JSON: `"text"`, `"voice"`, `"dm"`

**`Channel`** — Channel entity
- Belongs to a guild (guild_id not in this type, added server-side)
- Can be grouped under a `category_id`
- `position` controls display order
- `user_limit` only applies to voice channels (None = unlimited)
- `topic` is optional description/subject

**`ChannelCategory`** — Channel grouping
- Visual organization of channels
- Contains `channels: Vec<Channel>` for nested structure
- `position` controls category order

**Typical structure:**
```
Guild
  ├── Category "Text Channels"
  │     ├── #general (Text, position=0)
  │     └── #random (Text, position=1)
  └── Category "Voice Channels"
        ├── General Voice (Voice, position=0)
        └── AFK (Voice, position=1)
```

### message.rs

**`Message`** — Chat message
- Contains: id, channel_id, author (UserProfile), content, created_at
- May include: edited_at, attachments, embeds, reactions
- UUIDv7 for `id` (time-sortable)

**Future extensions:**
- Attachments (file uploads)
- Embeds (rich content)
- Reactions
- Threads/replies
- Message references (quotes)

### Adding new domain types

1. **Create new file:** `src/types/entity_name.rs`
2. **Define types with derives:**
   ```rust
   use serde::{Deserialize, Serialize};
   use uuid::Uuid;
   use chrono::{DateTime, Utc};

   #[derive(Debug, Clone, Serialize, Deserialize)]
   pub struct NewEntity {
       pub id: Uuid,
       pub name: String,
       pub created_at: DateTime<Utc>,
   }
   ```
3. **Export from mod.rs:**
   ```rust
   mod entity_name;
   pub use entity_name::*;
   ```

### Field conventions

**IDs:**
- Always `Uuid` (UUIDv7)
- Named `id`, `user_id`, `channel_id`, `guild_id`, etc.

**Timestamps:**
- Use `DateTime<Utc>` from chrono
- Named `created_at`, `updated_at`, `deleted_at`, `edited_at`

**Optional fields:**
- Use `Option<T>` for nullable fields
- Consider `#[serde(default)]` for backwards compatibility

**Collections:**
- Use `Vec<T>` for lists
- Consider pagination for large collections (don't load everything)

### Serialization patterns

**Enums with simple values:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,    // -> "active"
    Inactive,  // -> "inactive"
}
```

**Enums with data:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Permission {
    Role { role_id: Uuid },
    User { user_id: Uuid },
}
// -> { "type": "role", "role_id": "..." }
```

**Structs:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optional_field: Option<String>,
}
```

### Validation

Types here are **data containers only**. Validation happens server-side:

**DON'T add validation logic here:**
```rust
// ❌ Wrong - no business logic in vc-common
impl User {
    pub fn is_valid_username(&self) -> bool { ... }
}
```

**DO validate server-side:**
```rust
// ✅ Correct - in server/src/services/users.rs
fn validate_username(username: &str) -> Result<(), ValidationError> { ... }
```

### Common mistakes

- Adding methods to types (keep them data-only)
- Importing server-only dependencies (sqlx, tower, etc.)
- Making fields private (all public for serde)
- Forgetting `Serialize, Deserialize` derives
- Using `String` for IDs instead of `Uuid`
- Using `Option<Uuid>` when ID should never be null

### Testing

Focus on serialization correctness and stability:

```rust
#[test]
fn test_user_profile_json_format() {
    let profile = UserProfile {
        id: Uuid::nil(),
        username: "test_user".into(),
        display_name: "Test User".into(),
        avatar_url: None,
        status: UserStatus::Online,
    };

    let json = serde_json::to_value(&profile).unwrap();

    assert_eq!(json["username"], "test_user");
    assert_eq!(json["status"], "online");
}
```

### Backwards compatibility

When evolving types:

**Safe changes:**
- Adding new optional fields: `pub new_field: Option<T>`
- Adding new enum variants (if clients ignore unknown)
- Adding `#[serde(default)]` to new fields

**Breaking changes:**
- Removing fields
- Renaming fields (without `#[serde(rename)]` alias)
- Changing field types
- Making optional fields required

### Architecture notes

**Why separate User and UserProfile?**
- Privacy: Other users shouldn't see email, MFA status
- Performance: Less data over the wire for member lists
- Security: Reduces leak surface for sensitive data

**Why UUIDv7?**
- Time-sortable (better than v4 for databases)
- Decentralized generation (no server round-trip)
- Compatible with offline-first features (future)

**Why no relations in types?**
- These are DTOs (Data Transfer Objects)
- Relations are server-side concern (database layer)
- Client and server assemble relations as needed
