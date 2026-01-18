<!-- Parent: ../../AGENTS.md -->

# Guild Module

Guild (server/workspace) management including creation, membership, channels, and invite system.

## Purpose

- Guild CRUD operations (create, read, update, delete)
- Member management (join, leave, kick)
- Guild channel listing
- Invite code generation and redemption
- Ownership transfer (future)

## Key Files

- `mod.rs` — Router setup for guild and invite endpoints
- `handlers.rs` — Guild lifecycle handlers (create, update, delete, member operations)
- `invites.rs` — Invite code generation, listing, joining, and deletion
- `types.rs` — Request/response DTOs (CreateGuildRequest, UpdateGuildRequest, etc.)

## For AI Agents

### Guild Lifecycle

**Creation**:
- `POST /api/guilds` with `{ "name": "..." }` (owner_id set to current user)
- Creates guild with default "@everyone" role (permissions_bitfield = all)
- Creates default "general" text channel
- Adds creator as first member with owner role

**Update**:
- `POST /api/guilds/:id` with optional `{ "name": "...", "icon": "..." }`
- Requires `MANAGE_GUILD` permission (owner or role with permission)
- Icon stored as URL (S3 upload handled separately)

**Deletion**:
- `DELETE /api/guilds/:id`
- Only owner can delete guild
- Cascading delete: members, channels, messages, roles (via database foreign keys)
- Consider soft delete in future (archive instead of purge)

### Membership

**Joining**:
- Via invite: `POST /api/invites/:code/join` (handled in `invites.rs`)
- Direct join: `POST /api/guilds/:id/join` (requires guild to be "public" or user has invite)
- Assigns "@everyone" role by default

**Leaving**:
- `POST /api/guilds/:id/leave`
- Owner cannot leave (must transfer ownership first or delete guild)
- Removes user from all guild channels and roles

**Kicking**:
- `DELETE /api/guilds/:id/members/:user_id`
- Requires `KICK_MEMBERS` permission
- Cannot kick owner
- Role hierarchy: Cannot kick users with higher roles (see `permissions::can_moderate_member`)

**Listing Members**:
- `GET /api/guilds/:id/members`
- Returns array of `{ user_id, username, display_name, roles: [...] }`
- Includes role information for permission checking

### Invite System

**Invite Model**:
```rust
{
    id: Uuid,
    guild_id: Uuid,
    code: String,         // 8-char alphanumeric (e.g., "aB3xK9pL")
    creator_id: Uuid,
    created_at: DateTime,
    expires_at: Option<DateTime>,  // NULL = never expires
    max_uses: Option<i32>,         // NULL = unlimited
    uses: i32,                     // Current use count
}
```

**Code Generation**:
```rust
use rand::Rng;
const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let code: String = (0..8).map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char).collect();
```
**Ensure uniqueness**: Check `invites` table before inserting (retry on collision).

**Creating Invites**:
- `POST /api/guilds/:id/invites` with optional `{ "max_uses": 10, "expires_at": "2024-12-31T23:59:59Z" }`
- Requires `CREATE_INVITE` permission
- Defaults: Never expires, unlimited uses

**Listing Invites**:
- `GET /api/guilds/:id/invites`
- Returns all active invites for guild (not expired, not max uses reached)
- Includes creator info and usage stats

**Deleting Invites**:
- `DELETE /api/guilds/:id/invites/:code`
- Requires `MANAGE_GUILD` permission or being the creator

**Joining via Invite**:
- `POST /api/invites/:code/join`
- Validates:
  - Invite exists and belongs to guild
  - Not expired (`expires_at` > now or NULL)
  - Under max uses (`uses` < `max_uses` or `max_uses` is NULL)
  - User not already member
- Increments `uses` counter
- Adds user to guild with "@everyone" role
- Returns guild info

### Permissions Integration

**Required Checks** (see `permissions/resolver.rs`):
- `compute_guild_permissions(pool, guild_id, user_id)` — Returns bitfield of user's permissions
- `can_moderate_member(pool, guild_id, moderator_id, target_id)` — Checks role hierarchy

**Common Permission Flags**:
- `ADMINISTRATOR` (0x1) — Bypass all permission checks
- `MANAGE_GUILD` (0x2) — Edit guild settings, delete invites
- `KICK_MEMBERS` (0x4) — Remove members
- `BAN_MEMBERS` (0x8) — Ban members (future)
- `CREATE_INVITE` (0x10) — Create invite codes
- `MANAGE_CHANNELS` (0x20) — Create/edit/delete channels
- `MANAGE_ROLES` (0x40) — Edit roles and assignments

**Permission Checking Pattern**:
```rust
use crate::permissions::{compute_guild_permissions, GuildPermissions};

let perms = compute_guild_permissions(&state.db, guild_id, current_user_id).await?;
if !perms.contains(GuildPermissions::MANAGE_GUILD) {
    return Err(AuthError::Forbidden);
}
```

### Channel Listing

**Guild Channels**:
- `GET /api/guilds/:id/channels`
- Returns all channels in guild (text and voice types)
- Filters by user's channel access (respects channel-level permissions)
- Ordered by channel position (future: add `position` field to channels table)

### DTOs (Data Transfer Objects)

**Request Types** (in `types.rs`):
```rust
pub struct CreateGuildRequest {
    pub name: String,  // Required, 2-100 chars
}

pub struct UpdateGuildRequest {
    pub name: Option<String>,
    pub icon: Option<String>,  // URL or base64 data URI
}
```

**Validation**:
- Guild name: 2-100 characters, no special characters except spaces/dashes
- Icon URL: Valid HTTP(S) URL or data URI (future: validate image dimensions)

### Testing

**Required Tests**:
- [ ] Create guild, verify default channel and role created
- [ ] Update guild name (as owner)
- [ ] Update guild (as non-owner without MANAGE_GUILD permission, expect 403)
- [ ] Delete guild (as owner)
- [ ] Join guild via invite
- [ ] Kick member with KICK_MEMBERS permission
- [ ] Kick member without permission (expect 403)
- [ ] Create invite, verify code uniqueness
- [ ] Join via expired invite (expect error)
- [ ] Join via max-uses-reached invite (expect error)

### Common Pitfalls

**DO NOT**:
- Allow owner to leave without transferring ownership (breaks guild invariant)
- Skip role hierarchy check when kicking (security bug)
- Return sensitive invite data to non-members (invites should be semi-public)
- Hard-code permission checks (use `permissions` module)

**DO**:
- Use transactions for multi-step operations (create guild + channel + role)
- Validate invite code format (alphanumeric, 8 chars)
- Check guild membership before all operations
- Broadcast WebSocket events for member join/leave (future)
- Consider rate limiting invite creation (prevent spam)

### Future Enhancements

**Planned Features**:
- Guild ownership transfer (`POST /api/guilds/:id/transfer`)
- Banning members (separate `bans` table with reason and duration)
- Vanity invite URLs (`/invite/my-cool-server` instead of random code)
- Guild discovery (public guild directory)
- Guild templates (clone channel/role structure)
- Audit logs (track who did what in guild settings)

**Migration Path**:
- Add `is_public` flag to guilds (for discovery)
- Add `vanity_url` column to guilds (unique constraint)
- Create `bans` table (guild_id, user_id, reason, banned_at, banned_by, expires_at)
