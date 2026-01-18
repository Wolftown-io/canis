# VoiceChat Platform — Claude Code Projektkontext

## Projektübersicht

Self-hosted Voice- und Text-Chat-Plattform für Gaming-Communities. Optimiert für niedrige Latenz (<50ms), hohe Sprachqualität und maximale Sicherheit.

**Lizenz:** MIT OR Apache-2.0 (Dual License)
**Stack:** Rust (Server + Tauri Client), Solid.js (Frontend), PostgreSQL, Redis

## Architektur-Kurzreferenz

```
Client (Tauri 2.0)          Server
├── WebView (Solid.js)      ├── Auth Service (JWT, OIDC, MFA)
└── Rust Core               ├── Chat Service (WebSocket, E2EE)
    ├── WebRTC (webrtc-rs)  ├── Voice Service (SFU, DTLS-SRTP)
    ├── Audio (cpal, opus)  └── Data Layer
    └── Crypto (vodozemac)      ├── PostgreSQL
                                ├── Redis
                                └── S3 Storage
```

## Kernentscheidungen

| Bereich | Entscheidung | Begründung |
|---------|--------------|------------|
| Text E2EE | vodozemac (Olm/Megolm) | Apache 2.0 (libsignal ist AGPL) |
| Voice MVP | DTLS-SRTP | Standard WebRTC, Server-trusted |
| Voice E2EE | MLS (später) | "Paranoid Mode" für echte E2EE |
| Client | Tauri 2.0 + Solid.js | <100MB RAM vs Discord ~400MB |
| IDs | UUIDv7 | Zeitlich sortierbar, dezentral |

## Wichtige Constraints

### Lizenz-Compliance (KRITISCH)
```bash
# Vor jeder neuen Dependency prüfen:
cargo deny check licenses

# VERBOTEN: GPL, AGPL, LGPL (static linking)
# ERLAUBT: MIT, Apache-2.0, BSD-2/3, ISC, Zlib, MPL-2.0
```

### Performance-Ziele
- Voice-Latenz: <50ms Ende-zu-Ende
- Client RAM (Idle): <80MB
- Client CPU (Idle): <1%
- Startup: <3s

### Security-Basics
- TLS 1.3 für alle Verbindungen
- Passwörter: Argon2id
- JWT: 15min Gültigkeit, EdDSA oder RS256
- Input-Validierung: Immer server-side

## Code-Stil

### Rust
```rust
// Error Handling: thiserror für Library, anyhow für Application
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ChannelError {
    #[error("Channel nicht gefunden: {0}")]
    NotFound(Uuid),
    #[error("Keine Berechtigung")]
    Forbidden,
}

// Async: tokio mit tracing
#[tracing::instrument(skip(pool))]
async fn get_channel(pool: &PgPool, id: Uuid) -> Result<Channel, ChannelError> {
    // ...
}
```

### TypeScript/Solid.js
```typescript
// Signals für reaktiven State
const [messages, setMessages] = createSignal<Message[]>([]);

// Tauri Commands typsicher aufrufen
import { invoke } from '@tauri-apps/api/core';
const channel = await invoke<Channel>('get_channel', { id });
```

## Projekt-Dokumentation

- `PROJECT_SPEC.md` — Anforderungen und Entscheidungslog
- `ARCHITECTURE.md` — Technische Architektur und Diagramme
- `STANDARDS.md` — Verwendete Protokolle und Libraries
- `LICENSE_COMPLIANCE.md` — Lizenzprüfung aller Dependencies
- `CHANGELOG.md` — Änderungsprotokoll (keepachangelog.com Format)

---

# Code Review System

Code Reviews verwenden 8 Concern Areas mit strukturiertem Output. Für tiefere Exploration stehen 5 Characters zur Verfügung.

**Standards-Hierarchie:** Industrie-Standards → Rust-Ecosystem → Projekt-spezifisch

## Review Output Format

Jedes Review produziert einen strukturierten Report:

```markdown
# Code Review: [scope/PR title]

## 🔒 Security
- 🔴 **CRITICAL:** [issue] — file:line
- 🟡 **WARNING:** [issue] — file:line
- 🟢 **NOTE:** [issue] — file:line

## 🏗️ Architecture
...

## 📡 API Design
...

## ⚡ Performance
...

## 🛡️ Reliability
...

## 📝 Code Quality
...

## 🧪 Testing
...

## 📜 Compliance
...

---

## Summary

| Concern | Status | Issues |
|---------|--------|--------|
| Security | 🔴/🟡/🟢/✅ | count |
| ... | ... | ... |

**Verdict:** [Blocker benennen oder "Ready to merge"]
```

**Severity:**
- 🔴 **CRITICAL** — Muss vor Merge gefixt werden
- 🟡 **WARNING** — Sollte vor Merge adressiert werden
- 🟢 **NOTE** — Verbesserungsvorschlag für später
- ✅ — Keine Issues

Leere Sections zeigen "(no issues)" oder werden weggelassen.

---

## Concern Areas

### 🔒 Security

**Scope:** Authentication, Authorization, Cryptography, Input-Validierung, Secrets, Rate-Limiting, Threat Vectors

**Severity-Kriterien:**
- 🔴 CRITICAL: Exploitable Vulnerability (Injection, Auth-Bypass, Key-Exposure, fehlendes Rate-Limit auf kritischem Endpoint)
- 🟡 WARNING: Schwaches Pattern das exploitable werden könnte (fehlende Validierung, hardcoded Config)
- 🟢 NOTE: Defense-in-Depth Vorschlag

**Standards:** OWASP Top 10, CWE, E2EE-Constraints (vodozemac, DTLS-SRTP), Argon2id, JWT 15min Expiry, Rate-Limits (Login, WebSocket, API)

---

### 🏗️ Architecture

**Scope:** Service-Grenzen, Modul-Dependencies, Interface-Design, Erweiterbarkeit, Patterns

**Severity-Kriterien:**
- 🔴 CRITICAL: Bricht bestehende Contracts, erzeugt unrecoverable Tech-Debt
- 🟡 WARNING: Coupling das zukünftige Änderungen erschwert, unklare Grenzen
- 🟢 NOTE: Alternatives Pattern zur Überlegung

**Standards:** ARCHITECTURE.md, Clean Architecture, Rust-Modul-Conventions, "MLS-Drop-in-Test" (können wir MLS später einfach einbauen?)

---

### 📡 API Design

**Scope:** REST/WebSocket-Contracts, Error-Responses, Versioning, Backwards-Compatibility, Dokumentation

**Severity-Kriterien:**
- 🔴 CRITICAL: Breaking Change ohne Version-Bump
- 🟡 WARNING: Inkonsistentes Naming, fehlende Error-Codes, unklarer Contract
- 🟢 NOTE: Ergonomie-Verbesserung

**Standards:** OpenAPI-Conventions, konsistentes Error-Envelope, WebSocket-Protokoll-Spec

---

### ⚡ Performance

**Scope:** Latenz, Allocations, Lock-Contention, Memory-Leaks, Hot-Paths

**Severity-Kriterien:**
- 🔴 CRITICAL: Verletzt <50ms Voice-Latenz-Target, unbeschränktes Wachstum
- 🟡 WARNING: Allocation in Hot-Path, potenzielle Contention
- 🟢 NOTE: Optimierungs-Möglichkeit

**Standards:** Latenz-Ziele (10ms Ziel, 20ms akzeptabel, 50ms Maximum), Rust Zero-Copy Patterns, Tokio Best Practices

---

### 🛡️ Reliability

**Scope:** Error-Handling, Error-Propagation, Recovery-Strategien, Observability (Logs/Metrics/Traces), Health-Checks, Graceful Degradation

**Severity-Kriterien:**
- 🔴 CRITICAL: Silent Failure, unbehandelter Error-Path, keine Recovery möglich
- 🟡 WARNING: Fehlender Error-Context, kein strukturiertes Logging, unklarer Failure-Mode
- 🟢 NOTE: Bessere Observability Vorschlag

**Standards:** 12-Factor App (Logs as Streams), `thiserror` für Libraries / `anyhow` für Apps, `tracing` mit strukturierten Fields, Health-Endpoints

---

### 📝 Code Quality

**Scope:** Lesbarkeit, Idiomatisches Rust, Wartbarkeit, Naming, Dokumentation wo non-obvious

**Severity-Kriterien:**
- 🔴 CRITICAL: Fundamental falsches Pattern (z.B. Blocking in Async-Context)
- 🟡 WARNING: In 6 Monaten schwer verständlich, non-idiomatisch, unklare Intent
- 🟢 NOTE: Minor Style-Improvement, DRY-Opportunity

**Standards:** Rust API Guidelines, Clippy Lints, Code-Stil in CLAUDE.md, "6-Monate-Test" (verstehe ich das noch?)

---

### 🧪 Testing

**Scope:** Coverage, Edge-Cases, Failure-Szenarien, Test-Struktur, Mocking-Strategie

**Severity-Kriterien:**
- 🔴 CRITICAL: Kein Test für kritischen Path, Test der Regressions nicht catchen kann
- 🟡 WARNING: Fehlender Edge-Case (Disconnect, Timeout, Race-Condition), Brittle Test
- 🟢 NOTE: Test-Organisation Verbesserung

**Standards:** Testing Pyramid (Unit > Integration > E2E), Property-Based Testing für Parser/Protokolle, kein Mocking von Crypto

---

### 📜 Compliance

**Scope:** Lizenz-Kompatibilität, Attribution, Transitive Dependencies

**Severity-Kriterien:**
- 🔴 CRITICAL: Verbotene Lizenz (GPL, AGPL, LGPL static)
- 🟡 WARNING: Fehlende Attribution, unklare Lizenz, neue Dependency nicht in LICENSE_COMPLIANCE.md
- 🟢 NOTE: Attribution-Formatierung

**Standards:** Erlaubte/Verbotene Lizenz-Listen, cargo-deny, THIRD_PARTY_NOTICES.md

---

## Review Invocation

### Standard Review (alle 8 Concerns)

```
Review this PR
Review the changes in src/auth/
Review my last commit
```

### Scoped Review (schneller, fokussiert)

```
Review src/api/channels.rs for API design and security only
Security review the auth module
Performance review the voice hot path
```

**Wann Scoped Reviews nutzen:**
- Kleine Änderungen (<50 LOC): Security + Code Quality
- Frontend-only: Code Quality + Testing (skip Compliance, Performance)
- Docs-only: Skip alle außer Code Quality
- Neue Dependency: Compliance + Security
- Hot-Path Änderung: Performance + Reliability

---

## Character Deep-Dives

Characters sind **nicht** Teil von Standard-Reviews. Sie sind für explorative Gespräche wenn du eine bestimmte Denkweise brauchst.

### Faramir — Skeptischer Angreifer

**Mindset:** "Alles kann gehackt werden. Wie würde ich das brechen?"

**Nutze für:** Threat Modeling, Auth-Flows, Crypto-Entscheidungen

**Beispiel-Prompts:**
- "Ask Faramir about the token refresh flow"
- "Faramir, wie würdest du diese WebSocket-Auth angreifen?"
- "Was hält Faramir von unserem Key-Rotation-Prozess?"

---

### Elrond — Langzeit-Denker

**Mindset:** "Funktioniert das noch in 2 Jahren? Können wir es dann noch ändern?"

**Nutze für:** Architektur-Entscheidungen, Interface-Design, Service-Grenzen

**Beispiel-Prompts:**
- "Ask Elrond about splitting this into two services"
- "Elrond, ist dieses Interface MLS-ready?"
- "Was denkt Elrond über diese Modul-Struktur?"

---

### Gandalf — Performance-Obsessiver

**Mindset:** "Was passiert auf CPU-Cycle-Ebene? Wo sind die Allocations?"

**Nutze für:** Profiling-Strategie, Latenz-Deep-Dives, Hot-Path-Analyse

**Beispiel-Prompts:**
- "Get Gandalf to look at this allocation pattern"
- "Gandalf, wie profilen wir den Voice-Path?"
- "Was sagt Gandalf zur Lock-Contention hier?"

---

### Éowyn — Pragmatische Warterin

**Mindset:** "Verstehe ich das in 6 Monaten noch? Geht das einfacher?"

**Nutze für:** Lesbarkeits-Debatten, "Ist das zu clever?", Refactoring-Entscheidungen

**Beispiel-Prompts:**
- "Ask Éowyn if this abstraction is worth it"
- "Éowyn, ist dieser Code zu clever?"
- "Was würde Éowyn hier vereinfachen?"

---

### Pippin — Nicht-technischer User

**Mindset:** "Verstehen meine Freunde das ohne IT-Studium?"

**Nutze für:** UX-Sanity-Check, Fehlermeldungen, Feature-Discoverability

**Beispiel-Prompts:**
- "Ask Pippin about this error message"
- "Pippin, wie viele Klicks braucht das?"
- "Würde Pippins Gaming-Community das verstehen?"

---

# Workflows

## Neue Dependency hinzufügen

1. Lizenz prüfen (Compliance-Concern)
2. `cargo deny check licenses` ausführen
3. Transitive Dependencies prüfen
4. In LICENSE_COMPLIANCE.md dokumentieren
5. THIRD_PARTY_NOTICES.md aktualisieren falls nötig
6. Security-Review für neue Dependency

## Code Review

```
Review this PR
```

Produziert strukturierten Report mit allen 8 Concerns. Für schnellere Reviews:

```
Review [files] for [concerns] only
```

Für Deep-Exploration:

```
Ask [Faramir|Elrond|Gandalf|Éowyn|Pippin] about [topic]
```

## Feature-Entwicklung

1. Design-Phase: `Ask Elrond` für Architektur
2. Security-Check: `Ask Faramir` für Threat-Model
3. Implementation mit Code-Quality Standards
4. Testing nach Testing-Concern Kriterien
5. Review: `Review this PR`
6. UX-Check: `Ask Pippin` bei User-facing Features
7. Performance: `Ask Gandalf` bei Hot-Paths
8. **Changelog:** Update `CHANGELOG.md` unter `[Unreleased]`

---

# Changelog

> Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)

## Changelog-Pflicht (WICHTIG)

**Jede benutzerrelevante Änderung MUSS in `CHANGELOG.md` dokumentiert werden.**

### Wann aktualisieren?

- **Neue Features:** Unter `### Added`
- **Geänderte Funktionalität:** Unter `### Changed`
- **Deprecations:** Unter `### Deprecated`
- **Entfernte Features:** Unter `### Removed`
- **Bugfixes:** Unter `### Fixed`
- **Sicherheits-Patches:** Unter `### Security`

### Wann NICHT aktualisieren?

- Reine Refactorings ohne Verhaltensänderung
- Interne Code-Reorganisation
- Dokumentations-Updates (außer API-Docs)
- Test-Änderungen ohne Feature-Bezug

### Format

```markdown
## [Unreleased]

### Added
- Permission system with role-based access control
- Admin panel for user and guild management

### Fixed
- File upload timeout on large files (#123)
```

### Workflow

1. **Während der Entwicklung:** Eintrag unter `[Unreleased]` hinzufügen
2. **Bei Release:** `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` umbenennen
3. **Neue `[Unreleased]` Section:** Leere Kategorien für nächsten Zyklus

### Gute Einträge

- **Nutzer-Perspektive:** Was ändert sich für den User?
- **Konkret:** "Fixed login timeout" statt "Fixed bug"
- **Issue-Referenz:** `(#123)` wenn vorhanden

---

# Git Workflow

> Full specification: `docs/plans/2026-01-18-git-workflow-design.md`

## Commit Convention

**Format:** `type(scope): subject`

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`

**Scopes:** `auth`, `voice`, `chat`, `db`, `api`, `ws`, `ratelimit`, `infra`, `client`, `crypto`

**Rules:**
- Max 72 chars subject line
- Imperative mood ("add" not "added")
- Breaking changes: `type(scope)!: message`

## Branch & Worktree Strategy

**Branch naming:** `feature/<name>`, `fix/<name>`, `refactor/<area>`, `docs/<topic>`

**Worktree workflow:**
```bash
# Create worktree for feature
git worktree add ../canis-feature-xyz -b feature/xyz

# Work in isolated directory
cd ../canis-feature-xyz

# Clean up after merge
git worktree remove ../canis-feature-xyz
```

**Rules:**
- Main worktree stays on `main`
- One worktree per feature
- Clean up after merge
- Never commit directly to `main` in feature worktrees

## Pre-Push Quality Gates

Before pushing:

1. **Tests pass:** `cargo test` (server), `bun test` (client)
2. **Lint clean:** `cargo fmt --check && cargo clippy -- -D warnings`
3. **Self-review:** No secrets, correct scope, proper error handling
4. **Code review:** For significant changes (new modules, auth/crypto, API changes)

## Transparency

- Commit bodies explain *why* for non-trivial changes
- Reference issues: `Closes #42`, `Relates to #42`
- Reference design docs for major features
- No force-push to `main`

---

# Quick Reference

## Erlaubte Lizenzen
MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, CC0-1.0, Unlicense, MPL-2.0, Unicode-DFS-2016

## Verbotene Lizenzen
GPL-2.0, GPL-3.0, AGPL-3.0, LGPL-2.0, LGPL-2.1, LGPL-3.0, SSPL, Proprietary

## Wichtige Crates
- Web: axum, tower, tokio
- WebRTC: webrtc-rs
- DB: sqlx (PostgreSQL)
- Redis: fred
- Auth: jsonwebtoken, argon2, openidconnect
- E2EE Text: vodozemac
- Crypto: rustls, x25519-dalek, ed25519-dalek

## Package Manager
- Bun (for package management and script running)
- Node.js (still required for Playwright tests)

## Wichtige Frontend Packages
- Framework: solid-js
- Build: vite, typescript
- Styling: unocss
- Icons: lucide-solid
