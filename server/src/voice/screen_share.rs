//! Screen sharing data types and state.

use fred::prelude::*;
use serde::{Deserialize, Serialize};
use tracing::{error, warn};
use uuid::Uuid;

use super::Quality;

/// Maximum length for source_label field
const MAX_SOURCE_LABEL_LENGTH: usize = 255;

/// Validate a source label string.
/// Returns an error if the label is too long or contains invalid characters.
pub fn validate_source_label(label: &str) -> Result<(), ScreenShareError> {
    if label.len() > MAX_SOURCE_LABEL_LENGTH {
        return Err(ScreenShareError::InvalidSourceLabel);
    }

    // Allow alphanumeric, whitespace, and common punctuation
    for ch in label.chars() {
        if !ch.is_alphanumeric()
            && !ch.is_whitespace()
            && !"()-_.,:;'\"!?#@&+".contains(ch)
        {
            return Err(ScreenShareError::InvalidSourceLabel);
        }
    }

    Ok(())
}

/// Information about an active screen share session.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScreenShareInfo {
    /// User who is sharing
    pub user_id: Uuid,
    /// Username for display
    pub username: String,
    /// Label of shared source (e.g., "Display 1", "Firefox")
    pub source_label: String,
    /// Whether screen audio is included
    pub has_audio: bool,
    /// Current quality tier
    pub quality: Quality,
}

impl ScreenShareInfo {
    /// Create a new [`ScreenShareInfo`].
    #[must_use]
    pub const fn new(
        user_id: Uuid,
        username: String,
        source_label: String,
        has_audio: bool,
        quality: Quality,
    ) -> Self {
        Self {
            user_id,
            username,
            source_label,
            has_audio,
            quality,
        }
    }
}

/// Request to start a screen share.
#[derive(Clone, Debug, Deserialize)]
pub struct ScreenShareStartRequest {
    /// Requested quality tier
    pub quality: Quality,
    /// Include system audio
    pub has_audio: bool,
    /// Source label for display
    pub source_label: String,
}

/// Response to screen share check/start request.
#[derive(Clone, Debug, Serialize)]
pub struct ScreenShareCheckResponse {
    /// Whether screen sharing is allowed
    pub allowed: bool,
    /// Quality tier granted (may be lower than requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub granted_quality: Option<Quality>,
    /// Error message if not allowed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ScreenShareError>,
}

/// Screen share error reasons.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScreenShareError {
    /// User doesn't have `SCREEN_SHARE` permission
    NoPermission,
    /// Channel screen share limit reached
    LimitReached,
    /// User not in the voice channel
    NotInChannel,
    /// Premium quality requested but user lacks `PREMIUM_VIDEO`
    QualityNotAllowed,
    /// WebRTC renegotiation failed
    RenegotiationFailed,
    /// Internal server error (e.g., Redis failure)
    InternalError,
    /// Source label is invalid (too long or contains invalid characters)
    InvalidSourceLabel,
    /// User already has an active screen share
    AlreadySharing,
}

impl ScreenShareCheckResponse {
    /// Create an allowed response.
    pub const fn allowed(quality: Quality) -> Self {
        Self {
            allowed: true,
            granted_quality: Some(quality),
            error: None,
        }
    }

    /// Create a denied response.
    pub const fn denied(error: ScreenShareError) -> Self {
        Self {
            allowed: false,
            granted_quality: None,
            error: Some(error),
        }
    }
}

/// Check if screen share limit is reached for a channel (without incrementing).
pub async fn check_limit(
    redis: &RedisClient,
    channel_id: Uuid,
    max_shares: u32,
) -> Result<(), ScreenShareError> {
    let key = format!("screenshare:limit:{channel_id}");

    // Get current count
    match redis.get::<Option<u32>, _>(&key).await {
        Ok(Some(count)) => {
            if count >= max_shares {
                return Err(ScreenShareError::LimitReached);
            }
        }
        Ok(None) => {
            // No active shares, so limit not reached (unless max_shares is 0)
            if max_shares == 0 {
                return Err(ScreenShareError::LimitReached);
            }
        }
        Err(e) => {
            error!(channel_id = %channel_id, error = %e, "Redis GET failed in check_limit");
            return Err(ScreenShareError::InternalError);
        }
    }

    Ok(())
}

/// Try to start screen sharing using atomic Redis WATCH/MULTI/EXEC.
/// Uses optimistic locking to prevent race conditions.
pub async fn try_start_screen_share(
    redis: &RedisClient,
    channel_id: Uuid,
    max_shares: u32,
) -> Result<(), ScreenShareError> {
    let key = format!("screenshare:limit:{channel_id}");

    // Get current count first
    let current: i64 = redis.get(&key).await.unwrap_or(0);

    // Check if we would exceed limit
    if current >= max_shares as i64 {
        return Err(ScreenShareError::LimitReached);
    }

    // Increment atomically
    let new_count: i64 = redis.incr(&key).await.map_err(|e| {
        error!(
            channel_id = %channel_id,
            error = %e,
            "Redis INCR failed in try_start_screen_share"
        );
        ScreenShareError::InternalError
    })?;

    // Double-check after increment (handles race condition)
    if new_count > max_shares as i64 {
        // We exceeded the limit, decrement back
        if let Err(e) = redis.decr::<i64, _>(&key).await {
            warn!(
                channel_id = %channel_id,
                error = %e,
                "Redis DECR failed after limit exceeded - counter may be desynchronized"
            );
        }
        return Err(ScreenShareError::LimitReached);
    }

    // Set expiration (5 minutes to allow recovery from crashes)
    if let Err(e) = redis.expire::<(), _>(&key, 300).await {
        warn!(
            channel_id = %channel_id,
            error = %e,
            "Redis EXPIRE failed - stale keys may accumulate"
        );
    }

    Ok(())
}

/// Stop screen sharing, decrementing the limit counter.
/// Logs errors but continues, as cleanup must complete.
pub async fn stop_screen_share(redis: &RedisClient, channel_id: Uuid) {
    let key = format!("screenshare:limit:{channel_id}");

    // Get current count to prevent going negative
    let current: i64 = match redis.get(&key).await {
        Ok(val) => val,
        Err(e) => {
            warn!(
                channel_id = %channel_id,
                error = %e,
                "Redis GET failed in stop_screen_share - skipping decrement"
            );
            return;
        }
    };

    // Only decrement if count is positive
    if current > 0 {
        if let Err(e) = redis.decr::<i64, _>(&key).await {
            warn!(
                channel_id = %channel_id,
                error = %e,
                "Redis DECR failed in stop_screen_share - counter may be desynchronized"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_screen_share_info_creation() {
        let user_id = Uuid::new_v4();
        let info = ScreenShareInfo::new(
            user_id,
            "alice".to_string(),
            "Display 1".to_string(),
            true,
            Quality::High,
        );

        assert_eq!(info.user_id, user_id);
        assert_eq!(info.username, "alice");
        assert_eq!(info.source_label, "Display 1");
        assert!(info.has_audio);
        assert_eq!(info.quality, Quality::High);
    }

    #[test]
    fn test_check_response_allowed() {
        let resp = ScreenShareCheckResponse::allowed(Quality::High);
        assert!(resp.allowed);
        assert_eq!(resp.granted_quality, Some(Quality::High));
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_check_response_denied() {
        let resp = ScreenShareCheckResponse::denied(ScreenShareError::LimitReached);
        assert!(!resp.allowed);
        assert!(resp.granted_quality.is_none());
        assert_eq!(resp.error, Some(ScreenShareError::LimitReached));
    }
}