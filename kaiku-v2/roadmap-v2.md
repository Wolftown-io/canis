# Kaiku v2 — Roadmap

## Approach

Clean rewrite. No code carried over from v1, but patterns, architectural decisions, and learnings inform every choice. DMs first, guilds second.

## Phase 1 — Federated Personal Messaging (MVP)

The foundation: Matrix-based personal communication that works across servers.

### 1.1 — Infrastructure & Auth
- Tuwunel deployment and configuration
- LiveKit SFU deployment
- OIDC authentication flow
- User registration and login
- `podman compose` for the full stack

### 1.2 — Direct Messages
- matrix-rust-sdk integration in Tauri backend
- DM conversations (1:1)
- Group DMs
- E2EE (Olm/Megolm via vodozemac, enabled by default)
- Message history and sync (sliding sync)
- Typing indicators
- Read receipts

### 1.3 — Friend List & Profiles
- Add/remove friends (Matrix contacts)
- User profiles with display names and avatars
- Online/offline presence
- Friend requests

### 1.4 — Federated 1:1 Calls
- Voice calls via MatrixRTC + LiveKit
- Video calls via MatrixRTC + LiveKit
- Call UI (ring, accept, decline, hang up)

### 1.5 — Federation Verification
- DMs with users on other Matrix homeservers
- Calls with federated users
- Device verification for E2EE

**Milestone:** A user on Kaiku can message and call anyone on any Matrix server. WhatsApp replacement achieved.

---

## Phase 2 — Guild System

The differentiator: gaming-optimized community features.

### 2.1 — Kaiku Server Foundation
- Kaiku Server with axum/tokio/sqlx
- Guild CRUD (create, join, leave, delete)
- Text channels within guilds
- Channel messages (send, edit, delete, reactions)
- WebSocket for real-time guild events
- Auth integration (trust Tuwunel's tokens)

### 2.2 — Voice Channels
- Custom SFU for guild voice
- Persistent voice channels (always-on, join/leave)
- Opus codec, DTLS-SRTP
- Voice activity detection
- <50ms latency target

### 2.3 — Permissions & Roles
- Guild-wide RBAC (not per-channel power levels)
- Role creation and assignment
- Permission types: manage channels, kick, ban, manage roles, etc.
- Channel-level permission overrides

### 2.4 — Screen Sharing
- Screen sharing in voice channels
- Multiple simultaneous screen shares
- Audio sharing with screen share

**Milestone:** A gaming community can set up a guild with text/voice channels, roles, and screen sharing.

---

## Phase 3 — Community Features

### 3.1 — Presence & Custom Status
- Custom status text
- Game activity detection and display
- Presence synced to Tuwunel for federated visibility

### 3.2 — Moderation
- Guild-wide ban/kick
- Message deletion (moderator)
- Content filtering
- Audit logs

### 3.3 — Guild Discovery
- Server-local guild directory
- Guild invites (links)
- Onboarding flow for new guild members

---

## Phase 4 — Ecosystem

### 4.1 — Bots & Webhooks
- Bot application registration
- Slash commands
- Webhook endpoints for external integrations

### 4.2 — Media & Files
- File uploads in guild channels
- Image/video previews
- Avatar management

### 4.3 — Threads
- Threaded conversations in guild text channels

---

## Future Considerations (Not Scoped)

- Matrix bridges (Discord, Slack, IRC) — available via existing Matrix ecosystem
- Mobile client (Tauri mobile or separate native app)
- Push notifications
- Multiple SFU instances for scaling voice
- Admin dashboard
