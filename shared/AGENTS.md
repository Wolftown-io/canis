<!-- Parent: ../AGENTS.md -->
# Shared

## Purpose
Shared Rust libraries used by both server and client. Contains common types, protocols, and cryptographic primitives.

## Subdirectories
- `vc-common/` - Common types and protocols - see vc-common/AGENTS.md
- `vc-crypto/` - Cryptographic primitives - see vc-crypto/AGENTS.md

## For AI Agents

### Crate Purposes
| Crate | Usage | Description |
|-------|-------|-------------|
| `vc-common` | Server + Client | Message types, user/guild/channel models, WebSocket protocol |
| `vc-crypto` | Server + Client | E2EE key management, AEAD wrappers, key derivation |

### Adding to Shared
When adding code here, consider:
1. Is it truly shared between server and client?
2. Does it need to be in sync across both?
3. Is it platform-independent (no server-only or client-only dependencies)?

### Critical: License Compliance
Any new dependencies in shared crates affect both server and client:
```bash
cargo deny check licenses
```

### Build and Test
```bash
# Test all shared crates
cargo test -p vc-common -p vc-crypto

# Check compilation
cargo check -p vc-common -p vc-crypto
```

## Dependencies
- serde (serialization)
- uuid (UUIDv7 identifiers)
- thiserror (error types)
- chrono (timestamps)
