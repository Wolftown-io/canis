# Tech Debt Inventory

**Last audited:** 2026-02-18
**Branch:** `chore/tech-debt`

This document catalogs all known tech debt across the Canis codebase, sourced from:
- In-code markers (TODO, FIXME, HACK)
- Roadmap unchecked items and documented known limitations
- Code quality scan (unwrap/expect in production, lint suppressions, type safety gaps)
- Open GitHub issues referenced in docs

---

## Priority: High

### TD-01: Megolm E2EE stubs (unimplemented!)

**Files:** `shared/vc-crypto/src/megolm.rs:9,39`

Both `GroupSession` and `InboundGroupSession` structs contain placeholder fields and `todo!()` macro calls. These will **panic at runtime** if ever invoked.

```rust
// Line 9:  TODO: vodozemac::megolm::GroupSession
// Line 39: TODO: vodozemac::megolm::InboundGroupSession
```

**Risk:** Runtime panic if group E2EE is exercised.
**Fix:** Implement with real vodozemac megolm sessions or gate behind a feature flag.

---

### TD-02: Search — channel-level permission filtering missing

**File:** `docs/project/roadmap.md:519`

All guild members currently see search results from **all channels**, including channels they shouldn't have access to. This is a data leak when private/restricted channels are implemented.

**Risk:** Information disclosure.
**Fix:** Add channel permission checks to search query filtering.

---

### TD-03: Security advisory workaround (RUSTSEC-2026-0002)

**File:** `deny.toml:20`

```toml
# TODO(2026-Q2): Re-check if aws-sdk-s3 has updated lru to >= 0.16.3
```

Transitive dependency vulnerability from `aws-sdk-s3 → lru`. Scheduled review Q2 2026.

**Risk:** Known CVE in dependency tree.
**Fix:** Check upstream and bump when available.

---

### TD-04: E2EE key store not wired up

**Files:** `client/src/components/E2EESetupPrompt.tsx:128`, `client/src/components/settings/SettingsModal.tsx:79`

```typescript
// TODO: Include real identity keys and prekeys once E2EE key store exists
```

Backup data structure is stubbed — actual encryption keys are not included in backups.

**Risk:** E2EE backups don't actually back up keys.
**Fix:** Wire up once LocalKeyStore is complete.

---

### TD-05: WebSocket response builders use `.expect()`

**File:** `server/src/ws/mod.rs:945,956,966`

```rust
.expect("static response builder");
```

Three HTTP response constructors in WebSocket upgrade path panic on failure instead of returning errors.

**Risk:** Server crash on unexpected conditions during WS upgrade.
**Fix:** Replace with `?` operator or proper error responses.

---

## Priority: Medium

### TD-06: MFA backup codes not implemented

**File:** `server/src/auth/AGENTS.md:83`

> **Backup Codes**: Not yet implemented. TODO: Generate 10 single-use backup codes on MFA setup.

Users with MFA enabled have no recovery path if they lose their authenticator.

---

### TD-07: Test infrastructure improvements (Issues #137-#140)

**Source:** `docs/project/roadmap.md:308-309`

- Issue #137: Test cleanup guards (prevent leaked state between tests)
- Issue #138: Shared DB pool (reduce test setup overhead)
- Issue #139: Stateful middleware testing
- Issue #140: HTTP-level concurrent setup completion test

---

### TD-08: Search edge case and security tests missing

**Source:** `docs/project/roadmap.md:521-529`

Missing tests for:
- Special characters (`@#$%^&*()`), very long queries (>1000 chars)
- Large result sets (10k+ messages), complex AND/OR operators
- SQL injection via search query
- XSS via malicious search result content
- Channel permission bypass attempts

---

### TD-09: Console.log flood in production client code

**Key files:**
- `client/src/lib/webrtc/browser.ts` — 43+ `console.log` statements
- `client/src/lib/webrtc/tauri.ts` — 26+ statements
- `client/src/lib/tauri.ts` — 16+ statements
- `client/src/lib/sound/ring.ts` — 3 statements
- `client/src/components/SetupWizard.tsx` — 1 statement

All are prefixed with `[ClassName]` tags (intentional diagnostic logging), but should be filtered in production builds.

**Fix:** Introduce a log-level utility or strip in Vite production builds.

---

### TD-10: `clippy::too_many_arguments` suppressions (11 functions)

**Files:**
- `server/src/ws/mod.rs:1159,1365`
- `server/src/voice/ws_handler.rs:534`
- `server/src/db/queries.rs:414,858,1752,1801`
- `server/src/pages/queries.rs:226,260`
- `server/src/api/mod.rs:68`

Functions with too many parameters — consider parameter structs or builder patterns.

---

### TD-11: `#[allow(dead_code)]` suppressions (11 instances)

**Files:**
- `server/src/ws/mod.rs:749,768` — Unused pub constants for future features
- `server/src/voice/signaling.rs:12,26` — Unused enum variants
- `server/src/voice/sfu.rs:220,737` — Unused methods (`broadcast_all`, `room_count`)
- `server/src/chat/messages.rs:26` — Unused `MessageError` variant
- `server/src/chat/channels.rs:21` — Unused `ChannelError` variant
- `server/src/admin/middleware.rs:13` — Unused struct field
- `server/src/admin/handlers.rs:237-244` — Unused session record fields

**Fix:** Remove truly dead code, or document why it's kept for planned features.

---

### TD-12: TypeScript type safety gaps

**Production code:**
- `client/src/components/home/DMConversation.tsx:134` — `@ts-ignore` on file input handler
- `client/src/stores/websocket.ts:886` — `as any` cast for voice stats event
- `client/src/lib/tauri.ts:161-163` — `as any` for response validation
- `client/src/lib/webrtc/browser.ts:601` — `as any` for audio sink setup
- `client/src/lib/sound/browser.ts:173` — `as any` for AudioContext detection
- `client/src/components/SetupWizard.tsx:319` — `as any` for select value
- `client/src/components/settings/NotificationSettings.tsx:51,54` — `as any` for sound selection

**Test code:** 10+ additional `as any` casts (acceptable for mocks).

---

### TD-13: Frontend/backend file size limit sync

**Source:** `docs/plans/2026-01-29-unified-file-size-limits.md:884`

Frontend has hardcoded upload limits that can drift from server config.

**Workaround:** Manually update frontend when changing server env vars.
**Fix:** Fetch limits from `/api/config` endpoint on app startup.

---

### TD-14: Guild invite test stubs (blocked on features)

**File:** `server/tests/guild_invite_test.rs:412,422,432`

Three `#[ignore]` tests waiting on:
- `max_uses` field on `GuildInvite`
- Bans table implementation
- Guild suspension implementation

---

### TD-15: Tauri native webcam capture not implemented

**Source:** `docs/project/roadmap.md:418`

Multi-stream works in browser but Tauri has no native webcam commands (`start_webcam`/`stop_webcam`).

---

### TD-16: Tauri WebRTC connection metrics stub

**File:** `client/src/lib/webrtc/tauri.ts:194`

```typescript
// TODO: Add Tauri command to fetch native WebRTC connection stats
```

`getConnectionMetrics()` returns null — connectivity monitor is broken in Tauri.

---

### TD-17: Admin elevation detection stub

**File:** `client/src-tauri/src/commands/admin.rs:160`

```rust
// TODO: Parse elevation status from response headers or separate endpoint
```

Currently returns `is_elevated: false` always.

---

## Priority: Low

### TD-18: Swagger UI not wired up

**File:** `server/src/api/mod.rs:334`

```rust
// TODO: Setup utoipa swagger-ui
```

API docs route function is a stub.

---

### TD-19: Screen share limit not configurable per channel

**File:** `server/src/voice/ws_handler.rs:583`

```rust
// TODO: Get max_screen_shares from channel settings
```

Uses `DEFAULT_MAX_SCREEN_SHARES` constant instead of per-channel config.

---

### TD-20: Window focus check missing for notifications

**File:** `client/src/stores/websocket.ts:93`

```typescript
// TODO: Also check if window is focused
```

Notification logic only checks if channel is selected, not if browser window is focused. May cause redundant notifications.

---

### TD-21: Toast component rendering tests missing

**File:** `client/src/components/ui/__tests__/Toast.test.ts:5`

API tests exist (16 passing), but no `@solidjs/testing-library` component rendering tests.

---

### TD-22: Spoiler reveal state not persistent

**Source:** `docs/plans/2026-01-29-spoilers-mentions-implementation.md:798`

Revealed spoilers reset when scrolling away and back. Needs `revealedSpoilers: Set<string>` in store.

---

### TD-23: Home unread aggregator capped at 100 channels

**Source:** `docs/plans/2026-01-29-home-unread-aggregator-implementation.md:1024`

Users with >100 unread channels only see the first 100. No pagination or "Show More".

---

### TD-24: Plain text emails only (forgot password)

**Source:** `docs/plans/2026-01-29-forgot-password-implementation.md:1137`

Password reset emails are plain text. HTML alternative with `lettre::message::MultiPart` planned.

---

### TD-25: Windows Tauri build broken

**Source:** `docs/project/roadmap.md:397`

`libvpx` not available via choco. CI job marked `continue-on-error: true`.

---

### TD-26: Moderation filter patterns are placeholders

**Source:** `docs/plans/2026-01-29-moderation-safety-implementation-v2.md`

Multiple TODOs in moderation implementation doc:
- "Replace with real patterns before production" (3 occurrences)
- "Add more harassment patterns"
- "Consider fail-closed mode for critical filters"

Note: Content filter feature itself is not yet implemented (Phase 5 open item). These are documented requirements for when it ships.

---

### TD-27: Connectivity monitor known gaps

**Source:** `docs/plans/2026-01-19-user-connectivity-monitor-PR.md:139-144`

- No integration tests for REST API endpoints
- Session ID is client-generated, not validated server-side
- Pagination replaces list instead of appending
- No retry for session finalization on DB failure

---

### TD-28: Guild-level thread toggle missing

**Source:** `docs/project/roadmap.md:562`

Threads feature is complete but there's no guild-level setting to enable/disable it.

---

### TD-29: Simulcast not implemented

**Source:** `docs/project/roadmap.md:419`

No quality tier switching for bandwidth management in voice/video streams.

---

### TD-30: Search query analytics logging

**Source:** `docs/project/roadmap.md:528`

No analytics logging for search queries (useful for UX insights and performance monitoring at scale).

---

## Code Quality Summary

| Metric | Count | Notes |
|--------|-------|-------|
| `unwrap()` in server/ | 127 | Mostly test code; ~20 in production voice/auth/ratelimit |
| `expect()` in server/ | 290+ | Mostly test code; 3 critical in ws/mod.rs (TD-05) |
| `#[allow(dead_code)]` | 11 | See TD-11 |
| `#[allow(clippy::too_many_arguments)]` | 11 | See TD-10 |
| `unsafe` blocks | 0 | Excellent |
| `println!`/`eprintln!` in server | 0 | All logging uses tracing |
| `@ts-ignore` in client | 1 | See TD-12 |
| `as any` in production client | 7 | See TD-12 |
| `console.log` in client src/ | 89+ | See TD-09 |
| `eslint-disable` | 1 | Test setup only |

---

## Open GitHub Issues Referenced

| Issue | Description | Source |
|-------|-------------|--------|
| #132 | Tauri WebSocket Event Parity (11/22 done) | roadmap.md |
| #137 | Test cleanup guards | roadmap.md |
| #138 | Shared DB pool for tests | roadmap.md |
| #139 | Stateful middleware testing | roadmap.md |
| #140 | Concurrent setup completion test | roadmap.md |
