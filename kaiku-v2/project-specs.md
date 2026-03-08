# Kaiku v2 — Technical Specifications

## Technology Stack

### Client
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop shell | Tauri 2 | Rust backend, small binary, low memory, native WebView |
| Frontend framework | Solid.js | Fine-grained reactivity, top-tier performance, proven in v1 |
| Language | TypeScript | Type safety for frontend |
| Styling | UnoCSS | Utility-first, performant, proven in v1 |
| Icons | lucide-solid | Consistent icon set |
| Package manager | Bun | Fast, modern |
| Matrix SDK | matrix-rust-sdk | Official Rust SDK, runs in Tauri backend |
| Voice (guild) | cpal + opus | System audio capture + encoding |
| WebRTC | webrtc crate | Peer connections for guild SFU |
| Crypto | vodozemac | Olm/Megolm E2EE (used by both Matrix and Kaiku) |

### Server — Tuwunel (Matrix Homeserver)
| Concern | Detail |
|---------|--------|
| Language | Rust |
| Role | Matrix homeserver for DMs, group DMs, federation |
| Database | Embedded (RocksDB or SQLite) |
| Federation | Full Matrix Server-Server API |
| E2EE | Olm/Megolm via vodozemac |
| Auth | OIDC support |
| Voice signaling | MatrixRTC |

### Server — Kaiku
| Concern | Detail |
|---------|--------|
| Language | Rust |
| Web framework | axum |
| Async runtime | tokio |
| Database | sqlx (PostgreSQL) |
| Cache/pub-sub | fred (Valkey) |
| Voice | Custom SFU (WebRTC, Opus, DTLS-SRTP) |
| API docs | utoipa (OpenAPI) |

### Infrastructure
| Service | Role |
|---------|------|
| Tuwunel | Matrix homeserver |
| LiveKit | SFU for MatrixRTC (federated 1:1 calls) |
| Kaiku Server | Guild features, custom voice SFU |
| PostgreSQL | Kaiku guild data |
| Valkey | Presence, sessions, real-time pub/sub |

## Protocol Specifications

### Matrix (DMs, Group DMs, 1:1 Calls)
- Matrix Client-Server API (latest stable spec)
- Matrix Server-Server API (federation)
- MatrixRTC for voice/video calls
- Olm (1:1 E2EE) and Megolm (group E2EE) via vodozemac
- Sliding sync for fast client startup

### Kaiku (Guilds, Voice Channels, Screen Sharing)
- Custom REST API (OpenAPI 3.1 documented)
- Custom WebSocket protocol for real-time events
- WebRTC for guild voice channels and screen sharing
- Opus codec: 64 kbit/s default for voice
- DTLS-SRTP for media encryption

## Security Requirements

### Transport
- TLS 1.3 for all HTTP and WebSocket connections

### Authentication
- OIDC for user authentication (Tuwunel-managed)
- Kaiku Server trusts Tuwunel's auth tokens
- Single identity across both systems

### Encryption
| Layer | Method |
|-------|--------|
| Transport | TLS 1.3 |
| DM messages | Olm/Megolm E2EE (Matrix, enabled by default) |
| Guild voice | DTLS-SRTP (WebRTC) |
| 1:1 calls | MatrixRTC E2EE |

### Passwords
- Argon2id (handled by Tuwunel for Matrix accounts)

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Voice latency (guild) | <50ms e2e | Custom SFU, same as v1 |
| Client RAM (idle) | <80MB | Tauri advantage over Electron |
| Client CPU (idle) | <1% | Fine-grained reactivity helps |
| Startup time | <3s | Sliding sync for Matrix, lazy-load guilds |
| Client binary size | <50MB | Tauri target |

## Identity Model

- Canonical user ID: `@username:instance.example.com` (Matrix format)
- Display name: user-configurable, synced to Tuwunel Matrix profile
- Avatar: user-configurable, stored via Tuwunel media
- Guild-specific nicknames: optional, per-guild override

## Presence Model

- **Source of truth:** Kaiku Server
- **Features:** online/offline/idle/DND, custom status text, game activity
- **Sync:** Kaiku pushes presence state to Tuwunel for federated visibility
- **Implementation:** Valkey pub/sub for real-time updates within Kaiku

## Data Ownership

| Data | Stored in | Federated? |
|------|-----------|------------|
| User account | Tuwunel | Yes (Matrix) |
| DM messages | Tuwunel | Yes (E2EE) |
| Friend list | Tuwunel | Yes (Matrix contacts) |
| Guild data | Kaiku PostgreSQL | No |
| Guild messages | Kaiku PostgreSQL | No |
| Voice state | Kaiku Valkey | No |
| Presence | Kaiku Valkey → Tuwunel | Partially |

## Naming Conventions

- **Rust:** snake_case (standard)
- **TypeScript:** camelCase for local variables, snake_case for serialized/wire format (matching Rust serde defaults)
- **API endpoints:** snake_case paths
- **Database:** snake_case columns and tables

## License

MIT OR Apache-2.0 (Dual License)

### Allowed Dependencies
MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, CC0-1.0, Unlicense, MPL-2.0, Unicode-DFS-2016

### Forbidden Dependencies
GPL-2.0, GPL-3.0, AGPL-3.0, LGPL-2.0, LGPL-2.1, LGPL-3.0, SSPL, Proprietary

## Commit Convention

Same as v1:
- **Format:** `type(scope): subject`
- **Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`
- **Rules:** Max 72 chars, imperative mood
