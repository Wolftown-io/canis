//! Track Type Definitions for Multi-Track Support
//!
//! Provides enums and structs to identify and categorize different track types
//! (microphone audio, screen video, screen audio, webcam video) for the SFU
//! to route appropriately.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The kind of media track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    /// Audio track (e.g., microphone, screen audio).
    Audio,
    /// Video track (e.g., webcam, screen share).
    Video,
}

/// The source of a media track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackSource {
    /// Microphone audio from the user.
    Microphone,
    /// Video from screen sharing.
    ScreenVideo,
    /// Audio from screen sharing (system audio).
    ScreenAudio,
    /// Video from webcam.
    Webcam,
}

impl TrackSource {
    /// Returns the kind of media for this track source.
    #[must_use]
    pub const fn kind(&self) -> TrackKind {
        match self {
            Self::Microphone | Self::ScreenAudio => TrackKind::Audio,
            Self::ScreenVideo | Self::Webcam => TrackKind::Video,
        }
    }

    /// Returns true if this is a video track.
    #[must_use]
    pub const fn is_video(&self) -> bool {
        matches!(self.kind(), TrackKind::Video)
    }

    /// Returns true if this is an audio track.
    #[must_use]
    pub const fn is_audio(&self) -> bool {
        matches!(self.kind(), TrackKind::Audio)
    }
}

/// Information about a media track in the SFU.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackInfo {
    /// Unique identifier for this track.
    pub track_id: Uuid,
    /// User ID of the track owner.
    pub user_id: Uuid,
    /// The kind of media (audio or video).
    pub kind: TrackKind,
    /// The source of the track.
    pub source: TrackSource,
    /// Codec identifier (e.g., "opus", "vp8", "h264").
    pub codec: String,
    /// Optional human-readable label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl TrackInfo {
    /// Create a new track info.
    #[must_use]
    pub fn new(
        track_id: Uuid,
        user_id: Uuid,
        source: TrackSource,
        codec: impl Into<String>,
        label: Option<String>,
    ) -> Self {
        Self {
            track_id,
            user_id,
            kind: source.kind(),
            source,
            codec: codec.into(),
            label,
        }
    }

    /// Create track info for a microphone audio track.
    #[must_use]
    pub fn microphone(track_id: Uuid, user_id: Uuid, codec: impl Into<String>) -> Self {
        Self::new(track_id, user_id, TrackSource::Microphone, codec, None)
    }

    /// Create track info for a screen video track.
    #[must_use]
    pub fn screen_video(track_id: Uuid, user_id: Uuid, codec: impl Into<String>) -> Self {
        Self::new(track_id, user_id, TrackSource::ScreenVideo, codec, None)
    }

    /// Create track info for a screen audio track.
    #[must_use]
    pub fn screen_audio(track_id: Uuid, user_id: Uuid, codec: impl Into<String>) -> Self {
        Self::new(track_id, user_id, TrackSource::ScreenAudio, codec, None)
    }

    /// Create track info for a webcam video track.
    #[must_use]
    pub fn webcam(track_id: Uuid, user_id: Uuid, codec: impl Into<String>) -> Self {
        Self::new(track_id, user_id, TrackSource::Webcam, codec, None)
    }

    /// Set the label for this track.
    #[must_use]
    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_source_kind_returns_correct_kind() {
        assert_eq!(TrackSource::Microphone.kind(), TrackKind::Audio);
        assert_eq!(TrackSource::ScreenAudio.kind(), TrackKind::Audio);
        assert_eq!(TrackSource::ScreenVideo.kind(), TrackKind::Video);
        assert_eq!(TrackSource::Webcam.kind(), TrackKind::Video);
    }

    #[test]
    fn track_source_is_video_and_is_audio_helpers() {
        // Audio sources
        assert!(TrackSource::Microphone.is_audio());
        assert!(!TrackSource::Microphone.is_video());
        assert!(TrackSource::ScreenAudio.is_audio());
        assert!(!TrackSource::ScreenAudio.is_video());

        // Video sources
        assert!(TrackSource::ScreenVideo.is_video());
        assert!(!TrackSource::ScreenVideo.is_audio());
        assert!(TrackSource::Webcam.is_video());
        assert!(!TrackSource::Webcam.is_audio());
    }

    #[test]
    fn track_info_factory_methods() {
        let track_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        // Microphone
        let mic = TrackInfo::microphone(track_id, user_id, "opus");
        assert_eq!(mic.track_id, track_id);
        assert_eq!(mic.user_id, user_id);
        assert_eq!(mic.kind, TrackKind::Audio);
        assert_eq!(mic.source, TrackSource::Microphone);
        assert_eq!(mic.codec, "opus");
        assert!(mic.label.is_none());

        // Screen video
        let screen_vid = TrackInfo::screen_video(track_id, user_id, "vp8");
        assert_eq!(screen_vid.kind, TrackKind::Video);
        assert_eq!(screen_vid.source, TrackSource::ScreenVideo);
        assert_eq!(screen_vid.codec, "vp8");

        // Screen audio
        let screen_aud = TrackInfo::screen_audio(track_id, user_id, "opus");
        assert_eq!(screen_aud.kind, TrackKind::Audio);
        assert_eq!(screen_aud.source, TrackSource::ScreenAudio);

        // Webcam
        let webcam = TrackInfo::webcam(track_id, user_id, "h264");
        assert_eq!(webcam.kind, TrackKind::Video);
        assert_eq!(webcam.source, TrackSource::Webcam);
        assert_eq!(webcam.codec, "h264");
    }

    #[test]
    fn track_info_serialization() {
        let track_id = Uuid::parse_str("01234567-89ab-cdef-0123-456789abcdef").unwrap();
        let user_id = Uuid::parse_str("fedcba98-7654-3210-fedc-ba9876543210").unwrap();

        let track = TrackInfo::microphone(track_id, user_id, "opus").with_label("My Microphone");

        let json = serde_json::to_string(&track).unwrap();

        // Verify it can be deserialized back
        let deserialized: TrackInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, track);

        // Check field names are correct (snake_case for source, lowercase for kind)
        assert!(json.contains("\"kind\":\"audio\""));
        assert!(json.contains("\"source\":\"microphone\""));
        assert!(json.contains("\"label\":\"My Microphone\""));
    }
}
