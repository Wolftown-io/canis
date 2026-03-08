# Kaiku v2 — Architecture

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Kaiku Client                          │
│                 (Tauri 2 + Solid.js)                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Solid.js UI (WebView)                  │  │
│  │     Unified conversation & channel interface        │  │
│  │     — abstracted from underlying protocol           │  │
│  ├────────────────────────────────────────────────────┤  │
│  │              Tauri Command API                      │  │
│  │   send_message() / get_messages() / join_voice()    │  │
│  │   set_status() / add_friend() / create_channel()    │  │
│  ├───────────────────┬────────────────────────────────┤  │
│  │  matrix-rust-sdk  │       Kaiku Rust Client         │  │
│  │                   │                                 │  │
│  │  • DMs (Olm E2EE) │  • Guild text channels          │  │
│  │  • Group DMs       │  • Voice channels (WebRTC SFU) │  │
│  │  • Friend list     │  • Screen sharing              │  │
│  │  • 1:1 calls       │  • Custom status & game        │  │
│  │    (MatrixRTC)     │    presence                    │  │
│  │  • User profiles   │  • Guild RBAC                  │  │
│  └───────────────────┴────────────────────────────────┘  │
└──────────┬───────────────────────────┬───────────────────┘
           │ Matrix Client-Server API  │ Kaiku Custom API
           │                           │
┌──────────▼──────────┐  ┌─────────────▼──────────────────┐
│      Tuwunel        │  │        Kaiku Server             │
│  (Rust, Matrix      │  │    (Rust, axum/tokio/sqlx)      │
│   homeserver)       │  │                                 │
│                     │  │  • Guild management              │
│  • Matrix rooms     │  │  • Channel management            │
│    (DMs, group DMs) │  │  • Voice SFU (WebRTC, Opus)     │
│  • Federation       │  │  • Screen sharing orchestration  │
│  • E2EE (vodozemac) │  │  • RBAC / permissions            │
│  • User accounts    │  │  • Moderation                    │
│  • OIDC auth        │  │  • Bots & webhooks               │
│                     │  │  • Presence (source of truth)    │
└──────────┬──────────┘  └────────┬───────────────────────┘
           │                      │
    ┌──────▼──────┐        ┌──────▼──────┐
    │   LiveKit   │        │   Postgres  │
    │  (MatrixRTC │        │  (Kaiku DB) │
    │   SFU for   │        ├─────────────┤
    │   1:1 calls)│        │   Valkey    │
    └─────────────┘        │ (presence,  │
                           │  sessions,  │
                           │  pub/sub)   │
                           └─────────────┘
```

## Deployment Stack

All services are bundled in a single `podman compose` configuration:

```yaml
services:
  tuwunel:        # Matrix homeserver (Rust)
  livekit:        # SFU for federated 1:1 voice/video calls
  kaiku-server:   # Guild features, voice channels, custom SFU
  postgres:       # Database (shared or separate per service)
  valkey:         # Presence, sessions, pub/sub
```

Target: self-hosters run `podman compose up` and have a fully functional instance.

## Client Architecture

### Technology Stack

- **Desktop shell:** Tauri 2 (Rust backend + WebView frontend)
- **Frontend framework:** Solid.js with TypeScript
- **Styling:** UnoCSS
- **Icons:** lucide-solid
- **Package manager:** Bun

### The Tauri Backend as Protocol Abstraction

The key architectural insight: the Tauri Rust backend abstracts both protocols behind a unified command API. The Solid.js frontend does not know or care whether a conversation is a Matrix DM or a Kaiku guild channel.

```
Frontend calls:       Tauri backend routes to:
─────────────         ──────────────────────────
send_message(room)  → matrix-rust-sdk (if DM/group DM)
                    → kaiku client (if guild channel)

join_voice(room)    → MatrixRTC/LiveKit (if 1:1 call)
                    → Kaiku SFU (if voice channel)

get_friends()       → matrix-rust-sdk (Matrix contacts)
get_guild_members() → kaiku client (guild membership)
```

### matrix-rust-sdk

Element's official Rust SDK for Matrix clients. Runs natively in the Tauri backend:

- Matrix Client-Server API (sync, rooms, DMs)
- E2EE via vodozemac (same crypto library as Kaiku v1)
- Sliding sync for fast startup
- Timeline and room state management

## Server Architecture

### Tuwunel (Matrix Homeserver)

Tuwunel is a Rust-based Matrix homeserver (successor to conduwuit), sponsored by the Swiss government and used in production. It handles:

- User accounts and authentication (OIDC)
- Matrix rooms for DMs and group DMs
- Federation with other Matrix homeservers
- E2EE key management (Olm/Megolm via vodozemac)
- MatrixRTC signaling for 1:1 calls

Why Tuwunel over Synapse:
- Same language (Rust) as the rest of the stack
- Much lower resource footprint
- Production-proven
- Potential to contribute extensions upstream

### Kaiku Server

The custom Kaiku server handles everything guild-related:

- Guild and channel CRUD
- Voice channel management with custom SFU
- Screen sharing orchestration
- Role-based access control (guild-wide RBAC, not per-room power levels)
- Moderation tools
- Bot platform and webhooks
- Presence and custom status (source of truth, synced to Tuwunel)

Built with: axum, tokio, sqlx (PostgreSQL), fred (Valkey)

### Voice Architecture — Two Stacks

| Use Case | Stack | Why |
|----------|-------|-----|
| 1:1 federated calls | MatrixRTC + LiveKit SFU | Federation requires Matrix protocol |
| Guild voice channels | Kaiku custom SFU | Full control, <50ms latency target, persistent channels |

Guild voice channels use the same architecture as v1: WebRTC with Opus codec, DTLS-SRTP encryption, custom SFU for selective forwarding.

## Identity & Auth

- Canonical user ID: `@username:instance.example.com` (Matrix format)
- Tuwunel handles Matrix authentication (OIDC support)
- Kaiku Server trusts Tuwunel's auth — single sign-on across both systems
- Display names managed by Kaiku, synced to Tuwunel's Matrix profile
- One account, one identity, two systems

## Presence & Status

- Kaiku Server is the source of truth for presence
- Custom status text and game activity are Kaiku features
- Presence is synced to Tuwunel so federated contacts can see online/offline status
- Implementation details (push vs pull, frequency) to be decided later

## Data Storage

- **Tuwunel:** own embedded database (RocksDB/SQLite depending on config)
- **Kaiku Server:** PostgreSQL for guild data, channels, messages, permissions
- **Valkey:** presence state, sessions, pub/sub for real-time events
- **LiveKit:** stateless SFU, no persistent storage needed

## Performance Targets

Carried forward from v1:

| Metric | Target |
|--------|--------|
| Voice latency (guild channels) | <50ms end-to-end |
| Client RAM (idle) | <80MB |
| Client CPU (idle) | <1% |
| Startup time | <3s |
