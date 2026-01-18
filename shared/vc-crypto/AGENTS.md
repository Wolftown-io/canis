# vc-crypto — E2EE Cryptography

**Parent:** [../AGENTS.md](../AGENTS.md)

## Purpose

End-to-end encryption primitives using vodozemac (Olm/Megolm protocol). Provides high-level wrappers for secure messaging without exposing raw cryptographic operations.

**Key responsibilities:**
- Olm (Double Ratchet) for 1:1 DM encryption
- Megolm for efficient group/channel encryption
- Key management with zeroization
- Type-safe crypto error handling

**NOT in scope:**
- DTLS-SRTP voice encryption (handled by WebRTC stack)
- Transport-layer security (TLS is separate)
- Key distribution protocol (server handles via Olm sessions)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib.rs` | Public API, re-exports vodozemac types |
| `src/error.rs` | CryptoError enum with thiserror |
| `src/olm.rs` | Olm account and session wrappers (1:1 encryption) |
| `src/megolm.rs` | Megolm inbound/outbound sessions (group encryption) |

## For AI Agents

### When to modify this crate

**DO modify when:**
- Adding key rotation logic
- Implementing backup/restore for keys
- Adding crypto helpers (AEAD wrappers, key derivation)
- Exposing new vodozemac features needed by client/server

**DON'T modify when:**
- Implementing protocol-level key exchange (that's server logic)
- Adding UI for key verification (that's client logic)
- Changing underlying crypto primitives (we're locked to vodozemac)

### Critical constraints

**Security:**
- NEVER log private keys or decrypted content
- Use `zeroize` for sensitive data in memory
- All key material must be `#[derive(Zeroize, ZeroizeOnDrop)]`
- No custom crypto — only vodozemac primitives

**Licensing:**
- vodozemac is Apache-2.0 (compatible with our dual MIT/Apache-2.0)
- libsignal is AGPL (we CANNOT use it)
- Verify new crypto dependencies with `cargo deny check licenses`

**Dependencies:**
- vodozemac (Olm/Megolm implementation)
- serde for serialization (encrypted messages, key bundles)
- zeroize for memory safety
- NO async runtime (crypto is CPU-bound, use blocking)

**Testing:**
- NEVER mock crypto operations in tests
- Test against real vodozemac instances
- Verify encrypt-decrypt round-trips
- Test key rotation scenarios

### Common patterns

**Olm session (1:1 encryption):**
```rust
use vc_crypto::olm::{OlmAccount, OlmSession};

// Alice creates account
let alice = OlmAccount::new();
let alice_keys = alice.identity_keys();

// Bob creates session with Alice's keys
let bob = OlmAccount::new();
let mut bob_session = bob.create_outbound_session(alice_keys.curve25519)?;

// Bob encrypts to Alice
let ciphertext = bob_session.encrypt("Hello Alice")?;

// Alice creates inbound session and decrypts
let mut alice_session = alice.create_inbound_session(&ciphertext)?;
let plaintext = alice_session.decrypt(&ciphertext)?;
```

**Megolm group session:**
```rust
use vc_crypto::megolm::{OutboundGroupSession, InboundGroupSession};

// Sender creates outbound session
let mut outbound = OutboundGroupSession::new();
let session_key = outbound.session_key();

// Sender encrypts message
let ciphertext = outbound.encrypt("Hello group")?;

// Receiver gets session key (via Olm) and creates inbound session
let mut inbound = InboundGroupSession::new(&session_key)?;
let plaintext = inbound.decrypt(&ciphertext)?;
```

### Architecture notes

**Why vodozemac?**
- Apache-2.0 license (libsignal is AGPL, incompatible with our license)
- Matrix protocol proven in production
- Rust-native, no C bindings
- Olm for 1:1, Megolm for groups

**Future: MLS for voice E2EE**
- Current: DTLS-SRTP (server-trusted, standard WebRTC)
- Future: MLS (Message Layer Security) for true E2EE voice
- vodozemac stays for text chat (no breaking changes)
- See `docs/roadmap/Phase5-E2EE-Voice.md` for MLS plan

**Key distribution strategy:**
- Olm sessions established via server relay (key bundles in database)
- Megolm session keys distributed via Olm (sender encrypts key for each participant)
- Server cannot decrypt but can observe metadata (who talks to whom)
- "Paranoid Mode" (future) adds MLS for metadata protection

### Error handling

```rust
use vc_crypto::{CryptoError, Result};

fn decrypt_message(ciphertext: &str) -> Result<String> {
    // CryptoError variants:
    // - VodozemacError (wraps underlying library errors)
    // - InvalidMessage (malformed input)
    // - SessionError (session not established)
    session.decrypt(ciphertext)
        .map_err(|e| CryptoError::VodozemacError(e))
}
```

### Common gotchas

**Session state:**
- Olm/Megolm sessions are stateful (ratchet advances on encrypt/decrypt)
- Must persist session state to database after operations
- Lost state = lost messages (no backwards decryption)

**Key IDs:**
- vodozemac uses `KeyId` for tracking (not UUIDs)
- Map KeyId to user UUIDs at application layer

**Serialization:**
- Use vodozemac's serialization methods for session export
- NEVER serialize unencrypted sessions to JSON (security risk)
- Encrypt serialized sessions with user-derived key before storage

### Testing checklist

- [ ] Encrypt-decrypt round-trip works
- [ ] Multiple messages decrypt in order
- [ ] Session state persists across serialization
- [ ] Invalid ciphertext returns error (not panic)
- [ ] Keys are zeroized on drop (use valgrind/miri)
- [ ] No sensitive data in error messages
