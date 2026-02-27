//! Megolm Session Management
//!
//! Efficient group encryption for channel messages.
//!
//! This module is only compiled when the `megolm` feature is enabled.

use crate::{CryptoError, Result};
use serde::{Deserialize, Serialize};

/// Outbound Megolm session for encrypting messages to a group.
#[cfg(feature = "megolm")]
#[derive(Serialize, Deserialize)]
pub struct MegolmOutboundSession {
    /// The underlying vodozemac `GroupSession`.
    #[serde(with = "vodozemac_group_session_serde")]
    session: vodozemac::megolm::GroupSession,
}

#[cfg(feature = "megolm")]
impl MegolmOutboundSession {
    /// Create a new outbound session.
    #[must_use]
    pub fn new() -> Self {
        Self {
            session: vodozemac::megolm::GroupSession::new(
                vodozemac::megolm::SessionConfig::version_1(),
            ),
        }
    }

    /// Get the session key (to share with group members via Olm).
    /// Returns a base64 encoded string representing the exportable key.
    #[must_use]
    pub fn session_key(&self) -> String {
        let exportable_key = self.session.session_key();
        exportable_key.to_base64()
    }

    /// Get the unique session ID.
    #[must_use]
    pub fn session_id(&self) -> String {
        self.session.session_id()
    }

    /// Get the current message index for ratcheting.
    #[must_use]
    pub const fn message_index(&self) -> u32 {
        self.session.message_index()
    }

    /// Encrypt a message payload.
    /// Returns the ciphertext as a base64 string.
    pub fn encrypt(&mut self, plaintext: &str) -> String {
        let ciphertext = self.session.encrypt(plaintext);
        ciphertext.to_base64()
    }
}

#[cfg(feature = "megolm")]
impl Default for MegolmOutboundSession {
    fn default() -> Self {
        Self::new()
    }
}

/// Inbound Megolm session for decrypting messages from a group member.
#[cfg(feature = "megolm")]
#[derive(Serialize, Deserialize)]
pub struct MegolmInboundSession {
    /// The underlying vodozemac `InboundGroupSession`.
    #[serde(with = "vodozemac_inbound_group_session_serde")]
    session: vodozemac::megolm::InboundGroupSession,
}

#[cfg(feature = "megolm")]
impl MegolmInboundSession {
    /// Create an inbound session from a base64 encoded session key.
    pub fn new(session_key_b64: &str) -> Result<Self> {
        let session_key = vodozemac::megolm::SessionKey::from_base64(session_key_b64)
            .map_err(|e| CryptoError::InvalidKey(format!("Invalid megolm session key: {e}")))?;

        let session = vodozemac::megolm::InboundGroupSession::new(
            &session_key,
            vodozemac::megolm::SessionConfig::version_1(),
        );
        Ok(Self { session })
    }

    /// Get the unique session ID.
    #[must_use]
    pub fn session_id(&self) -> String {
        self.session.session_id()
    }

    /// Get the first known message index for this inbound session.
    #[must_use]
    pub const fn first_known_index(&self) -> u32 {
        self.session.first_known_index()
    }

    /// Decrypt a base64-encoded ciphertext message.
    pub fn decrypt(&mut self, ciphertext_b64: &str) -> Result<String> {
        let message = vodozemac::megolm::MegolmMessage::from_base64(ciphertext_b64)
            .map_err(|e| CryptoError::DecryptionFailed(format!("Malformed Megolm message: {e}")))?;

        let decrypt_result = self
            .session
            .decrypt(&message)
            .map_err(|e| CryptoError::DecryptionFailed(format!("Megolm decryption failed: {e}")))?;

        String::from_utf8(decrypt_result.plaintext).map_err(|e| {
            CryptoError::DecryptionFailed(format!("Decrypted payload is not valid UTF-8: {e}"))
        })
    }
}

// -----------------------------------------------------------------------------
// Serde Modules for vodozemac structs
//
// Vodozemac's GroupSessions implement Pickle rather than direct Serde Serialize
// to ensure internal invariants. We must serialize via base64 encoded pickles.
// -----------------------------------------------------------------------------

#[cfg(feature = "megolm")]
mod vodozemac_group_session_serde {
    use serde::{Deserialize, Deserializer, Serializer};
    use vodozemac::megolm::GroupSession;

    // We use an empty secret key for pickling because the local key store handles encryption
    // at the storage layer. See `LocalKeyStore` in client/src-tauri/src/crypto/store.rs.
    // TODO: Consider passing the encryption key through for defense-in-depth.
    const PICKLE_KEY: [u8; 32] = [0u8; 32];

    pub fn serialize<S>(session: &GroupSession, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let pickle = session.pickle().encrypt(&PICKLE_KEY);
        serializer.serialize_str(&pickle)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<GroupSession, D::Error>
    where
        D: Deserializer<'de>,
    {
        let pickle_str = String::deserialize(deserializer)?;
        let pickle =
            vodozemac::megolm::GroupSessionPickle::from_encrypted(&pickle_str, &PICKLE_KEY)
                .map_err(serde::de::Error::custom)?;
        Ok(GroupSession::from(pickle))
    }
}

#[cfg(feature = "megolm")]
mod vodozemac_inbound_group_session_serde {
    use serde::{Deserialize, Deserializer, Serializer};
    use vodozemac::megolm::InboundGroupSession;

    // We use an empty secret key for pickling because the local key store handles encryption
    // at the storage layer. See `LocalKeyStore` in client/src-tauri/src/crypto/store.rs.
    // TODO: Consider passing the encryption key through for defense-in-depth.
    const PICKLE_KEY: [u8; 32] = [0u8; 32];

    pub fn serialize<S>(session: &InboundGroupSession, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let pickle = session.pickle().encrypt(&PICKLE_KEY);
        serializer.serialize_str(&pickle)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<InboundGroupSession, D::Error>
    where
        D: Deserializer<'de>,
    {
        let pickle_str = String::deserialize(deserializer)?;
        let pickle =
            vodozemac::megolm::InboundGroupSessionPickle::from_encrypted(&pickle_str, &PICKLE_KEY)
                .map_err(serde::de::Error::custom)?;
        Ok(InboundGroupSession::from(pickle))
    }
}

#[cfg(all(test, feature = "megolm"))]
mod tests {
    use super::*;

    #[test]
    fn test_megolm_encrypt_decrypt() {
        // 1. Sender creates an outbound session
        let mut outbound = MegolmOutboundSession::new();
        let session_id = outbound.session_id();
        let session_key = outbound.session_key();

        assert_eq!(outbound.message_index(), 0);

        // 2. Sender encrypts a message
        let plaintext = "Hello group chat!";
        let ciphertext = outbound.encrypt(plaintext);

        assert_eq!(outbound.message_index(), 1); // Ratchet advanced

        // 3. Receiver creates an inbound session using the session key
        let mut inbound =
            MegolmInboundSession::new(&session_key).expect("Failed to create inbound session");

        // Session IDs must match
        assert_eq!(inbound.session_id(), session_id);
        assert_eq!(inbound.first_known_index(), 0);

        // 4. Receiver decrypts the ciphertext
        let decrypted = inbound.decrypt(&ciphertext).expect("Failed to decrypt");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_megolm_serialization() {
        // Create an outbound session
        let outbound = MegolmOutboundSession::new();
        let session_key = outbound.session_key();

        // Serialize and Deserialize Outbound
        let serialized_outbound = serde_json::to_string(&outbound).unwrap();
        let deserialized_outbound: MegolmOutboundSession =
            serde_json::from_str(&serialized_outbound).unwrap();
        assert_eq!(deserialized_outbound.session_id(), outbound.session_id());

        // Create an inbound session
        let inbound = MegolmInboundSession::new(&session_key).unwrap();

        // Serialize and Deserialize Inbound
        let serialized_inbound = serde_json::to_string(&inbound).unwrap();
        let deserialized_inbound: MegolmInboundSession =
            serde_json::from_str(&serialized_inbound).unwrap();
        assert_eq!(deserialized_inbound.session_id(), inbound.session_id());
    }
}
