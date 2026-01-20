//! User-level feature flags for premium features.
//!
//! These flags are stored in the `users.feature_flags` column and control
//! access to premium functionality like enhanced video quality.

use bitflags::bitflags;

bitflags! {
    /// User-level feature flags for premium features.
    ///
    /// Stored as BIGINT in PostgreSQL for efficient database operations.
    /// Use `from_db` and `to_db` for database conversion.
    ///
    /// # Why `i64` instead of `u64`?
    ///
    /// PostgreSQL BIGINT is a signed 64-bit integer (`i64`), and sqlx returns `i64`
    /// when reading from the database. Using `i64` here avoids unnecessary casting
    /// at the database boundary. We only use bits 0-62 for flags (avoiding the sign
    /// bit), which gives us 63 feature flags - more than sufficient for our needs.
    /// This matches the database type directly for zero-cost conversion.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize)]
    #[serde(transparent)]
    pub struct UserFeatures: i64 {
        /// Premium video quality (1080p60) for screen sharing.
        ///
        /// Users without this flag are limited to 720p30 screen sharing.
        const PREMIUM_VIDEO = 1 << 0;
    }
}

impl UserFeatures {
    // === Database Conversion ===

    /// Create features from a database BIGINT value.
    ///
    /// Invalid bits are silently ignored to maintain forward compatibility.
    #[must_use]
    pub const fn from_db(value: i64) -> Self {
        Self::from_bits_truncate(value)
    }

    /// Convert features to a database BIGINT value.
    #[must_use]
    pub const fn to_db(self) -> i64 {
        self.bits()
    }

    // === Feature Checking ===

    /// Check if user has premium video feature (1080p60 screen sharing).
    #[must_use]
    pub const fn has_premium_video(&self) -> bool {
        self.contains(Self::PREMIUM_VIDEO)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_premium_video_bit() {
        assert_eq!(UserFeatures::PREMIUM_VIDEO.bits(), 1);
    }

    #[test]
    fn test_default_is_empty() {
        assert_eq!(UserFeatures::default(), UserFeatures::empty());
        assert!(!UserFeatures::default().has_premium_video());
    }

    #[test]
    fn test_from_db_and_to_db_roundtrip() {
        let original = UserFeatures::PREMIUM_VIDEO;
        let db_value = original.to_db();
        let restored = UserFeatures::from_db(db_value);
        assert_eq!(original, restored);
    }

    #[test]
    fn test_from_db_with_zero() {
        let features = UserFeatures::from_db(0);
        assert!(features.is_empty());
        assert!(!features.has_premium_video());
    }

    #[test]
    fn test_from_db_truncates_unknown_bits() {
        // Set a bit beyond our defined features (bit 63)
        let db_value: i64 = (1_i64 << 0) | (1_i64 << 62);
        let features = UserFeatures::from_db(db_value);

        // Should have PREMIUM_VIDEO but unknown bit should be truncated
        assert!(features.has_premium_video());
        assert_eq!(features.bits(), 1);
    }

    #[test]
    fn test_has_premium_video() {
        let with_premium = UserFeatures::PREMIUM_VIDEO;
        let without_premium = UserFeatures::empty();

        assert!(with_premium.has_premium_video());
        assert!(!without_premium.has_premium_video());
    }

    #[test]
    fn test_serde_roundtrip() {
        let original = UserFeatures::PREMIUM_VIDEO;
        let json = serde_json::to_string(&original).unwrap();
        let restored: UserFeatures = serde_json::from_str(&json).unwrap();
        assert_eq!(original, restored);
    }
}
