<!-- Parent: ../../AGENTS.md -->

# Social Module

Friend management system (friend requests, blocking, presence).

## Purpose

- Send and receive friend requests
- Accept or reject incoming requests
- List friends, pending requests, blocked users
- Block and unblock users
- User presence/status (online, away, busy, offline)
- Future: Profiles, avatars, custom status

## Key Files

- `mod.rs` — Router setup for friend management endpoints
- `friends.rs` — Friend request handlers (send, accept, reject, block, list)
- `types.rs` — Request/response DTOs (FriendRequest, FriendResponse, etc.)

## For AI Agents

### Friendship Model

**Database Schema**:
```sql
CREATE TABLE friendships (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status friendship_status NOT NULL,  -- 'pending', 'accepted', 'blocked'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, friend_id)
);
```

**Status Values**:
- `pending` — Friend request sent, awaiting response (unidirectional)
- `accepted` — Both users are friends (bidirectional, two rows: A→B and B→A)
- `blocked` — User has blocked another user (unidirectional)

**Bidirectional Relationships**:
- When A sends request to B: `(A, B, pending)` row created
- When B accepts: Update `(A, B, pending)` → `(A, B, accepted)` AND create `(B, A, accepted)`
- Both rows ensure efficient querying (`WHERE user_id = ? AND status = 'accepted'`)

### Friend Request Flow

**Send Request**:
```
POST /api/friends/request
{ "recipient_id": "uuid" }
```
**Validation**:
- Cannot send to yourself
- Cannot send if already friends or request pending
- Cannot send if you've blocked them or they've blocked you
- Creates `(sender_id, recipient_id, 'pending')` row

**List Pending Requests** (incoming):
```
GET /api/friends/pending
```
Returns requests where `friend_id = current_user AND status = 'pending'`

**Accept Request**:
```
POST /api/friends/:id/accept
```
**Actions**:
1. Verify request exists (`friend_id = current_user, user_id = :id, status = pending`)
2. Update `(sender, recipient, pending)` → `(sender, recipient, accepted)`
3. Create reciprocal `(recipient, sender, accepted)`
4. Broadcast WebSocket event to both users (future: `FriendAdded`)

**Reject Request**:
```
POST /api/friends/:id/reject
```
**Action**: Delete `(sender, recipient, pending)` row

### Friend Listing

**List Friends**:
```
GET /api/friends
```
**Query**: `SELECT * FROM friendships WHERE user_id = ? AND status = 'accepted'`

**Response** (enriched with user data):
```json
[
    {
        "user_id": "uuid",
        "username": "alice",
        "display_name": "Alice Wonderland",
        "status": "online",
        "avatar_url": "https://..."
    }
]
```

**Performance**: Join with `users` table to fetch friend details in single query.

### Blocking

**Block User**:
```
POST /api/friends/:id/block
```
**Actions**:
1. Delete any existing friendship (`(current_user, target, *)` and `(target, current_user, *)`)
2. Create `(current_user, target, 'blocked')` row
3. Target user cannot send friend requests to blocker
4. Blocker cannot see target's messages (future: filter in chat handlers)

**List Blocked Users**:
```
GET /api/friends/blocked
```
**Query**: `SELECT * FROM friendships WHERE user_id = ? AND status = 'blocked'`

**Unblock** (future):
```
DELETE /api/friends/:id
```
If `status = 'blocked'`, delete row (allows target to send requests again).

### Remove Friend

**Unfriend**:
```
DELETE /api/friends/:id
```
**Actions**:
1. Delete `(current_user, friend_id, 'accepted')`
2. Delete `(friend_id, current_user, 'accepted')`
3. Broadcast `FriendRemoved` event (future)

### Presence System

**User Status** (in `users` table):
```rust
pub enum UserStatus {
    Online,
    Away,
    Busy,
    Offline,
}
```

**Status Updates**:
- Set to `online` on WebSocket connect (in `ws::handle_socket`)
- Set to `offline` on WebSocket disconnect
- Client can manually set `away` or `busy` via API (future: `POST /api/users/@me/status`)

**Presence Broadcasting** (future):
- When user status changes, broadcast to all friends via WebSocket
- Redis pub/sub pattern: `presence:{user_id}` channel
- Friends subscribe to presence updates on connect

### Privacy Considerations

**Friend Request Spam Prevention**:
- Rate limit: 20 req/60s (uses `RateLimitCategory::Social`)
- Consider: Max pending requests per user (e.g., 50 pending outgoing)
- Block users who send spam requests (manual moderation)

**Block Behavior**:
- Blocker cannot see blocked user's messages (filter in message list queries)
- Blocked user cannot join voice channels with blocker (future)
- Blocked user cannot see blocker's presence (always appears offline)

**Mutual Blocks**:
- If both users block each other: Both have `(user_id, other_id, 'blocked')` rows
- No special handling needed (symmetric blocking)

### WebSocket Integration (Future)

**Events to Broadcast**:
```rust
// Server → Client events
FriendRequestReceived {
    from_user_id: Uuid,
    from_username: String,
}

FriendRequestAccepted {
    user_id: Uuid,
    username: String,
}

FriendRemoved {
    user_id: Uuid,
}

PresenceUpdate {
    user_id: Uuid,
    status: UserStatus,
    custom_status: Option<String>,
}
```

**Implementation**:
1. After friend action (accept, remove), call `ws::broadcast_to_user()`
2. Redis pub/sub on `user:{user_id}` channel (personal notifications)
3. Clients listen for friend events on WebSocket

### Testing

**Required Tests**:
- [ ] Send friend request (success)
- [ ] Send duplicate request (expect error)
- [ ] Send request to self (expect error)
- [ ] Accept friend request (verify bidirectional rows created)
- [ ] Reject friend request (verify row deleted)
- [ ] Block user (verify friendship deleted, block row created)
- [ ] Blocked user cannot send request (expect error)
- [ ] Unfriend (verify both rows deleted)
- [ ] List friends (verify only accepted status returned)
- [ ] List pending (verify only incoming requests returned)

### Common Pitfalls

**DO NOT**:
- Use unidirectional relationships for accepted friendships (breaks queries)
- Allow blocked users to interact (check block status in all social features)
- Forget to broadcast WebSocket events (users won't see real-time updates)
- Return sensitive user data (email, password_hash) in friend lists

**DO**:
- Create reciprocal rows for accepted friendships
- Check for existing relationships before creating new ones
- Filter blocked users in all social queries (messages, voice, profiles)
- Use transactions for multi-row operations (accept request = 2 inserts)
- Rate limit friend requests to prevent spam

### Future Enhancements

**User Profiles**:
```sql
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN banner_url TEXT;
ALTER TABLE users ADD COLUMN custom_status TEXT;
```

**Endpoints**:
- `GET /api/users/:id/profile` — Public profile (username, display name, avatar, bio)
- `PATCH /api/users/@me/profile` — Update own profile

**Friend Suggestions**:
- Mutual friends algorithm (friends of friends)
- Based on shared guilds
- Based on recent DM interactions

**Friend Notes**:
```sql
CREATE TABLE friend_notes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_id)
);
```
Private notes visible only to note creator (like Discord's friend notes).

**Friend Categories/Groups** (future):
- "Gaming Friends", "Work", "Family" custom labels
- Client-side organization (stored in user preferences)
