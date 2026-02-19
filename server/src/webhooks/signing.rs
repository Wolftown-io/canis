//! HMAC-SHA256 Webhook Signing
//!
//! Signs and verifies webhook payloads for authenticity.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Sign a payload with HMAC-SHA256 and return the hex-encoded signature.
pub fn sign_payload(secret: &str, payload: &[u8]) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(payload);
    hex::encode(mac.finalize().into_bytes())
}

/// Verify an HMAC-SHA256 signature against a payload.
pub fn verify_signature(secret: &str, payload: &[u8], signature: &str) -> bool {
    let expected = sign_payload(secret, payload);
    // Constant-time comparison
    expected.len() == signature.len()
        && expected
            .as_bytes()
            .iter()
            .zip(signature.as_bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

/// Generate a random 32-byte hex signing secret.
pub fn generate_signing_secret() -> String {
    use rand::Rng;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_and_verify() {
        let secret = "test_secret_12345";
        let payload = b"hello world";
        let sig = sign_payload(secret, payload);
        assert!(verify_signature(secret, payload, &sig));
        assert!(!verify_signature("wrong_secret", payload, &sig));
        assert!(!verify_signature(secret, b"wrong payload", &sig));
    }

    #[test]
    fn generate_secret_length() {
        let secret = generate_signing_secret();
        assert_eq!(secret.len(), 64); // 32 bytes = 64 hex chars
    }
}
