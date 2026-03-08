# Kaiku v2 — Project Definition

## Vision

Kaiku v2 is a gaming-focused chat platform with a hybrid architecture: federated personal messaging via the Matrix protocol, custom guild features via Kaiku's own server. It combines the best of both worlds — open, federated communication for personal conversations (a WhatsApp replacement) with a purpose-built, high-performance guild system optimized for gaming communities.

## Motivation

Kaiku v1 was built as a fully custom stack — custom REST API, custom WebSocket protocol, custom SFU, custom guild/channel hierarchy. While this provided full control, v2 takes a different approach based on key learnings:

1. **Federation** — Kaiku instances should be able to talk to each other, and users should be able to message anyone on any Matrix-compatible server. Personal messaging should not be locked to a single server.
2. **Reduce maintenance burden** — auth, messaging, presence, E2EE for personal conversations are solved problems. Let a Matrix homeserver handle them so Kaiku can focus on what makes it unique: the gaming experience.
3. **Ecosystem leverage** — the Matrix ecosystem provides bots, bridges (Discord, Slack, IRC, Telegram), integrations, and client libraries that would take years to build from scratch.
4. **Community credibility** — building on an open standard (Matrix) rather than yet another proprietary protocol increases trust and adoption potential.

## What Kaiku v2 Is

- A **gaming-focused Matrix client** for personal messaging (DMs, group DMs, 1:1 calls)
- A **custom guild platform** for community features (text/voice channels, screen sharing, RBAC, bots)
- A **self-hosted all-in-one deployment** — one `podman compose up` for everything
- A **clean rewrite** — not a migration from v1, but built from scratch using v1's patterns and learnings

## What Kaiku v2 Is Not

- Not a general-purpose Matrix client (like Element)
- Not a federation-first platform for guilds — guilds are local, optimized, and purpose-built
- Not a fork of an existing client — Kaiku v2 is its own product with its own UX

## The Hybrid Split

| Personal (Matrix/Tuwunel) | Community (Kaiku) |
|---------------------------|-------------------|
| DMs (E2EE, federated) | Guild text channels |
| Group DMs | Voice channels (custom SFU) |
| 1:1 voice/video calls | Screen sharing |
| Friend list | Roles & permissions (RBAC) |
| User profiles | Bots, webhooks |
| Presence (synced from Kaiku) | Moderation |
|  | Guild discovery & onboarding |

## User Identity

- Canonical ID: `@username:kaiku.example.com` (Matrix format)
- Display names managed by Kaiku, synced to Tuwunel
- OIDC support for authentication
- Single identity across both systems — a user doesn't need two accounts

## License

MIT OR Apache-2.0 (Dual License) — same as v1.
