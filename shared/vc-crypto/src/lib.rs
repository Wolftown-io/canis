//! `VoiceChat` E2EE Cryptography
//!
//! End-to-end encryption using vodozemac (Olm/Megolm).
//!
//! - **Olm**: Double Ratchet for 1:1 encrypted sessions (DMs)
//! - **Megolm**: Efficient group encryption for channels

pub mod error;
pub mod megolm;
pub mod olm;

pub use error::{CryptoError, Result};

/// Re-export vodozemac types that are commonly needed.
pub mod types {
    pub use vodozemac::Curve25519PublicKey;
    pub use vodozemac::Ed25519PublicKey;
    pub use vodozemac::Ed25519Signature;
    pub use vodozemac::KeyId;
}
