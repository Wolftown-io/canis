//! Screen sharing data types and state.

use fred::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::Quality;

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
        Err(_) => return Err(ScreenShareError::InternalError),
    }

    Ok(())
}

/// Try to start screen sharing, incrementing the limit counter.
pub async fn try_start_screen_share(
    redis: &RedisClient,
    channel_id: Uuid,
    max_shares: u32,
) -> Result<(), ScreenShareError> {
    let key = format!("screenshare:limit:{channel_id}");
    
    // Use INCR
    let count: i64 = redis.incr(&key).await.map_err(|_| ScreenShareError::InternalError)?;
    
    // Convert to u32
    if count as u32 > max_shares {
        // Decrement back since we exceeded limit
        let _: () = redis.decr(&key).await.unwrap_or(());
        return Err(ScreenShareError::LimitReached);
    }
    
    // Set expiration (1 hour to prevent stale keys if server crashes)
    let _: () = redis.expire(&key, 3600).await.unwrap_or(());
    
    Ok(())
}

/// Stop screen sharing, decrementing the limit counter.
pub async fn stop_screen_share(
    redis: &RedisClient,
    channel_id: Uuid,
) {
    let key = format!("screenshare:limit:{channel_id}");
    
    // DECR counter
    // Ignore errors as we can't do much about them during cleanup
    // We rely on the 1-hour expiration to clean up any desyncs eventually
    let _: () = redis.decr(&key).await.unwrap_or(());
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