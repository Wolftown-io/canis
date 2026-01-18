# Crypto Module

**Parent:** [Tauri Source](../AGENTS.md)

**Purpose:** End-to-end encryption (E2EE) for text messages using vodozemac (Olm/Megolm protocol). **Currently a placeholder module** — E2EE implementation is future work.

## Architecture (Planned)

```
Text Message (plaintext)
    ↓ vodozemac::Account::encrypt()
Encrypted Message (Olm/Megolm)
    ↓ Server (stores encrypted, cannot read)
Recipient Client
    ↓ vodozemac::Account::decrypt()
Text Message (plaintext)
```

## Current State

**File:** `mod.rs` — Empty placeholder (`//! Client-side Cryptography`)

**Status:** Not implemented. Voice uses DTLS-SRTP (server-trusted), not E2EE.

## Planned Implementation

### Phase 1: Key Management
- **Identity Keys**: Ed25519 for signing, Curve25519 for encryption
- **One-time Keys**: Pre-generated keys for initial Olm sessions
- **Storage**: Encrypted local DB (sqlx + SQLCipher or sled)

### Phase 2: Olm (1-to-1 E2EE)
- **Session Establishment**: Double Ratchet between two users
- **Message Encryption**: `vodozemac::Account::encrypt(message)`
- **Message Decryption**: `vodozemac::Account::decrypt(ciphertext)`

### Phase 3: Megolm (Group E2EE)
- **Outbound Session**: One sender encrypts for many recipients
- **Inbound Session**: Each recipient decrypts with shared group key
- **Key Rotation**: Periodic ratchet to maintain forward secrecy

### Phase 4: Voice E2EE ("Paranoid Mode")
- **MLS Protocol**: Multi-party E2EE for voice (replaces DTLS-SRTP)
- **Server Role**: Blind relay (no decryption keys)
- **Trade-off**: Higher latency (~10-20ms overhead), more complex

## Key Library: vodozemac

**Why vodozemac?**
- **License:** Apache 2.0 (compatible with our MIT/Apache dual license)
- **Alternative:** libsignal (AGPL-3.0) — incompatible with our license
- **Protocol:** Implements Signal's Olm/Megolm, battle-tested crypto

**Crate:** `vodozemac = "0.5"`

## Security Considerations

### Threat Model
- **Server compromise**: Attacker gains access to server DB
  - **Mitigation:** E2EE ensures server only sees ciphertext
- **Client compromise**: Attacker gains access to client device
  - **No mitigation:** E2EE cannot protect against local access
- **Network eavesdropping**: Attacker intercepts traffic
  - **Mitigation:** TLS + E2EE (defense in depth)

### Key Storage
- **Identity Keys**: Long-lived, encrypted at rest with device key
- **Session Keys**: Ephemeral, rotated per session
- **One-time Keys**: Pre-generated, deleted after use

**Platform-specific:**
- **macOS/iOS:** Keychain
- **Windows:** DPAPI
- **Linux:** Secret Service API (gnome-keyring, KWallet)
- **Fallback:** Encrypted file with user password

### Forward Secrecy
- **Olm/Megolm:** Built-in via ratcheting
- **Voice DTLS-SRTP (current):** No forward secrecy (server holds keys)
- **Voice MLS (future):** Forward secrecy

## Implementation Roadmap

### Step 1: Device Identity (Week 1-2)
- Generate Ed25519 + Curve25519 keypair on first run
- Store in OS keyring
- Upload public keys to server `/crypto/keys` endpoint

### Step 2: Olm Sessions (Week 3-4)
- Pre-generate one-time keys, upload to server
- Implement Olm session establishment
- Encrypt/decrypt 1-to-1 messages
- Add `/crypto/sessions` endpoints to server

### Step 3: Megolm Sessions (Week 5-6)
- Create outbound Megolm session for group channels
- Distribute session keys via Olm (encrypted)
- Encrypt/decrypt group messages
- Handle key rotation

### Step 4: UI Integration (Week 7-8)
- Display "Encrypted" badge on messages
- Key verification UX (QR codes, emoji verification)
- Key backup/restore flow
- Device management UI

### Step 5: Voice MLS (Future, 3-6 months)
- Integrate MLS library (openmls crate)
- SFU modifications for encrypted RTP
- Performance testing (<50ms latency)

## Testing Strategy

### Unit Tests
```rust
#[cfg(test)]
mod tests {
    use vodozemac::{Account, Curve25519PublicKey, IdentityKeys};

    #[test]
    fn test_key_generation() {
        let account = Account::new();
        let identity_keys = account.identity_keys();
        assert!(identity_keys.ed25519.verify_signature().is_ok());
    }

    #[test]
    fn test_olm_session() {
        let alice = Account::new();
        let bob = Account::new();

        // Establish session
        let session = alice.create_outbound_session(&bob.identity_keys().curve25519);

        // Encrypt/decrypt
        let plaintext = "Hello, Bob!";
        let ciphertext = session.encrypt(plaintext).unwrap();
        let decrypted = bob.decrypt(&ciphertext).unwrap();
        assert_eq!(decrypted, plaintext);
    }
}
```

### Integration Tests
- **Two-client test**: Spin up two Tauri instances, send encrypted messages
- **Server blind test**: Verify server cannot decrypt messages
- **Key rotation test**: Ensure old keys cannot decrypt new messages

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Key generation | <100ms | One-time on first run |
| Olm session setup | <50ms | Per new 1-to-1 conversation |
| Encrypt (Olm) | <5ms | Per message |
| Decrypt (Olm) | <5ms | Per message |
| Encrypt (Megolm) | <2ms | Per message (amortized) |
| Decrypt (Megolm) | <2ms | Per message |

## Compliance

### Licenses
- **vodozemac:** Apache-2.0 ✅
- **ed25519-dalek:** BSD-3-Clause ✅
- **x25519-dalek:** BSD-3-Clause ✅

### Export Regulations
- **U.S. Export Administration Regulations (EAR):** Cryptography is restricted
- **Exemption:** Open-source + notification to BIS (Bureau of Industry and Security)
- **Action Required:** File notification if distributing outside U.S. (not yet applicable)

## Common Pitfalls

### Don't Roll Your Own Crypto
- **Bad:** Implementing custom encryption protocol
- **Good:** Using vodozemac (peer-reviewed, audited)

### Key Management is Hard
- **Bad:** Storing keys in plaintext
- **Good:** OS keyring with device-locked encryption

### Fallback to Plaintext
- **Bad:** Disabling E2EE if keys fail to load
- **Good:** Block message send, require key recovery

## Related Documentation

- [ARCHITECTURE.md](../../../../ARCHITECTURE.md) — E2EE architecture overview
- [STANDARDS.md](../../../../STANDARDS.md) — Olm/Megolm protocol specs
- [Server Crypto](../../../../server/src/crypto/AGENTS.md) — Server-side key management
