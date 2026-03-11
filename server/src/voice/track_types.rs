//! Track Type Definitions for Multi-Track Support
//!
//! Provides enums and structs to identify and categorize different track types
//! (microphone audio, screen video, screen audio, webcam video) for the SFU
//! to route appropriately.

use std::fmt;

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
///
/// `ScreenVideo` and `ScreenAudio` carry a `stream_id` (`Uuid`) to support
/// multiple concurrent screen shares per user (up to 3).
#[derive(Debug, Clone, Copy)]
pub enum TrackSource {
    /// Microphone audio from the user.
    Microphone,
    /// Video from screen sharing, identified by `stream_id`.
    ScreenVideo(Uuid),
    /// Audio from screen sharing (system audio), identified by `stream_id`.
    ScreenAudio(Uuid),
    /// Video from webcam.
    Webcam,
}

impl TrackSource {
    /// Returns the kind of media for this track source.
    #[must_use]
    pub const fn kind(&self) -> TrackKind {
        match self {
            Self::Microphone | Self::ScreenAudio(_) => TrackKind::Audio,
            Self::ScreenVideo(_) | Self::Webcam => TrackKind::Video,
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

    /// Returns the `stream_id` if this is a screen share source.
    #[must_use]
    pub const fn stream_id(&self) -> Option<Uuid> {
        match self {
            Self::ScreenVideo(id) | Self::ScreenAudio(id) => Some(*id),
            Self::Microphone | Self::Webcam => None,
        }
    }

    /// Returns true if this is a screen share source (video or audio).
    #[must_use]
    pub const fn is_screen_share(&self) -> bool {
        matches!(self, Self::ScreenVideo(_) | Self::ScreenAudio(_))
    }
}

// Manual PartialEq: compare variant discriminant + stream_id for screen sources.
impl PartialEq for TrackSource {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Microphone, Self::Microphone) | (Self::Webcam, Self::Webcam) => true,
            (Self::ScreenVideo(a), Self::ScreenVideo(b))
            | (Self::ScreenAudio(a), Self::ScreenAudio(b)) => a == b,
            _ => false,
        }
    }
}

impl Eq for TrackSource {}

// Manual Hash: must be consistent with PartialEq.
impl std::hash::Hash for TrackSource {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        match self {
            Self::ScreenVideo(id) | Self::ScreenAudio(id) => id.hash(state),
            Self::Microphone | Self::Webcam => {}
        }
    }
}

// Display: `microphone`, `screen_video:{uuid}`, `screen_audio:{uuid}`, `webcam`
impl fmt::Display for TrackSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Microphone => write!(f, "microphone"),
            Self::ScreenVideo(id) => write!(f, "screen_video:{id}"),
            Self::ScreenAudio(id) => write!(f, "screen_audio:{id}"),
            Self::Webcam => write!(f, "webcam"),
        }
    }
}

// Custom Serialize: `"microphone"`, `"screen_video:{uuid}"`, `"screen_audio:{uuid}"`, `"webcam"`
impl Serialize for TrackSource {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

// Custom Deserialize: inverse of Serialize.
impl<'de> Deserialize<'de> for TrackSource {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "microphone" => Ok(Self::Microphone),
            "webcam" => Ok(Self::Webcam),
            other => {
                if let Some(uuid_str) = other.strip_prefix("screen_video:") {
                    let id = Uuid::parse_str(uuid_str).map_err(serde::de::Error::custom)?;
                    Ok(Self::ScreenVideo(id))
                } else if let Some(uuid_str) = other.strip_prefix("screen_audio:") {
                    let id = Uuid::parse_str(uuid_str).map_err(serde::de::Error::custom)?;
                    Ok(Self::ScreenAudio(id))
                } else {
                    Err(serde::de::Error::custom(format!(
                        "unknown TrackSource: {other}"
                    )))
                }
            }
        }
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
    pub fn screen_video(
        track_id: Uuid,
        user_id: Uuid,
        stream_id: Uuid,
        codec: impl Into<String>,
    ) -> Self {
        Self::new(
            track_id,
            user_id,
            TrackSource::ScreenVideo(stream_id),
            codec,
            None,
        )
    }

    /// Create track info for a screen audio track.
    #[must_use]
    pub fn screen_audio(
        track_id: Uuid,
        user_id: Uuid,
        stream_id: Uuid,
        codec: impl Into<String>,
    ) -> Self {
        Self::new(
            track_id,
            user_id,
            TrackSource::ScreenAudio(stream_id),
            codec,
            None,
        )
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

/// Simulcast layer identifier, matching the RID sent by the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    High,
    Medium,
    Low,
}

impl Layer {
    /// RID string used in RTP headers.
    #[must_use]
    pub const fn rid(self) -> &'static str {
        match self {
            Self::High => "h",
            Self::Medium => "m",
            Self::Low => "l",
        }
    }

    /// Parse from RID string.
    #[must_use]
    pub fn from_rid(rid: &str) -> Option<Self> {
        match rid {
            "h" => Some(Self::High),
            "m" => Some(Self::Medium),
            "l" => Some(Self::Low),
            _ => None,
        }
    }

    /// Target bitrate for this layer (bps).
    #[must_use]
    pub const fn target_bitrate(self) -> u64 {
        match self {
            Self::High => 4_000_000,
            Self::Medium => 800_000,
            Self::Low => 200_000,
        }
    }
}

/// Viewer's layer preference for a specific track.
///
/// Flat enum matching the wire format (`"auto"`, `"high"`, `"medium"`, `"low"`).
/// When not `Auto`, acts as a ceiling: the server may select a lower layer
/// if bandwidth cannot sustain the requested one.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerPreference {
    /// Server selects layer based on REMB bandwidth estimate.
    #[default]
    Auto,
    High,
    Medium,
    Low,
}

impl LayerPreference {
    /// Convert to the equivalent [`Layer`], returning `None` for `Auto`.
    #[must_use]
    pub const fn layer(self) -> Option<Layer> {
        match self {
            Self::Auto => None,
            Self::High => Some(Layer::High),
            Self::Medium => Some(Layer::Medium),
            Self::Low => Some(Layer::Low),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_source_kind_returns_correct_kind() {
        let stream_id = Uuid::nil();
        assert_eq!(TrackSource::Microphone.kind(), TrackKind::Audio);
        assert_eq!(TrackSource::ScreenAudio(stream_id).kind(), TrackKind::Audio);
        assert_eq!(TrackSource::ScreenVideo(stream_id).kind(), TrackKind::Video);
        assert_eq!(TrackSource::Webcam.kind(), TrackKind::Video);
    }

    #[test]
    fn track_source_is_video_and_is_audio_helpers() {
        let stream_id = Uuid::nil();

        // Audio sources
        assert!(TrackSource::Microphone.is_audio());
        assert!(!TrackSource::Microphone.is_video());
        assert!(TrackSource::ScreenAudio(stream_id).is_audio());
        assert!(!TrackSource::ScreenAudio(stream_id).is_video());

        // Video sources
        assert!(TrackSource::ScreenVideo(stream_id).is_video());
        assert!(!TrackSource::ScreenVideo(stream_id).is_audio());
        assert!(TrackSource::Webcam.is_video());
        assert!(!TrackSource::Webcam.is_audio());
    }

    #[test]
    fn track_source_stream_id() {
        let stream_id = Uuid::new_v4();
        assert_eq!(TrackSource::Microphone.stream_id(), None);
        assert_eq!(TrackSource::Webcam.stream_id(), None);
        assert_eq!(
            TrackSource::ScreenVideo(stream_id).stream_id(),
            Some(stream_id)
        );
        assert_eq!(
            TrackSource::ScreenAudio(stream_id).stream_id(),
            Some(stream_id)
        );
    }

    #[test]
    fn track_source_is_screen_share() {
        let stream_id = Uuid::nil();
        assert!(!TrackSource::Microphone.is_screen_share());
        assert!(!TrackSource::Webcam.is_screen_share());
        assert!(TrackSource::ScreenVideo(stream_id).is_screen_share());
        assert!(TrackSource::ScreenAudio(stream_id).is_screen_share());
    }

    #[test]
    fn track_source_equality_considers_stream_id() {
        let id_a = Uuid::new_v4();
        let id_b = Uuid::new_v4();

        assert_eq!(
            TrackSource::ScreenVideo(id_a),
            TrackSource::ScreenVideo(id_a)
        );
        assert_ne!(
            TrackSource::ScreenVideo(id_a),
            TrackSource::ScreenVideo(id_b)
        );
        assert_ne!(
            TrackSource::ScreenVideo(id_a),
            TrackSource::ScreenAudio(id_a)
        );
    }

    #[test]
    fn track_source_display_and_serde_roundtrip() {
        let stream_id = Uuid::parse_str("01234567-89ab-cdef-0123-456789abcdef").unwrap();

        let cases = [
            (TrackSource::Microphone, "\"microphone\""),
            (TrackSource::Webcam, "\"webcam\""),
            (
                TrackSource::ScreenVideo(stream_id),
                "\"screen_video:01234567-89ab-cdef-0123-456789abcdef\"",
            ),
            (
                TrackSource::ScreenAudio(stream_id),
                "\"screen_audio:01234567-89ab-cdef-0123-456789abcdef\"",
            ),
        ];

        for (source, expected_json) in &cases {
            let json = serde_json::to_string(source).unwrap();
            assert_eq!(&json, expected_json, "serialize mismatch for {source:?}");

            let deserialized: TrackSource = serde_json::from_str(&json).unwrap();
            assert_eq!(&deserialized, source, "deserialize mismatch for {source:?}");
        }
    }

    #[test]
    fn track_info_factory_methods() {
        let track_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let stream_id = Uuid::new_v4();

        // Microphone
        let mic = TrackInfo::microphone(track_id, user_id, "opus");
        assert_eq!(mic.track_id, track_id);
        assert_eq!(mic.user_id, user_id);
        assert_eq!(mic.kind, TrackKind::Audio);
        assert_eq!(mic.source, TrackSource::Microphone);
        assert_eq!(mic.codec, "opus");
        assert!(mic.label.is_none());

        // Screen video
        let screen_vid = TrackInfo::screen_video(track_id, user_id, stream_id, "vp8");
        assert_eq!(screen_vid.kind, TrackKind::Video);
        assert_eq!(screen_vid.source, TrackSource::ScreenVideo(stream_id));
        assert_eq!(screen_vid.codec, "vp8");

        // Screen audio
        let screen_aud = TrackInfo::screen_audio(track_id, user_id, stream_id, "opus");
        assert_eq!(screen_aud.kind, TrackKind::Audio);
        assert_eq!(screen_aud.source, TrackSource::ScreenAudio(stream_id));

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

    #[test]
    fn track_info_screen_video_serialization_includes_stream_id() {
        let track_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let stream_id = Uuid::parse_str("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();

        let track = TrackInfo::screen_video(track_id, user_id, stream_id, "vp8");
        let json = serde_json::to_string(&track).unwrap();

        assert!(json.contains("screen_video:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));

        let deserialized: TrackInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, track);
    }
}

#[cfg(test)]
mod layer_tests {
    use super::*;

    #[test]
    fn test_layer_rid_roundtrip() {
        assert_eq!(Layer::from_rid("h"), Some(Layer::High));
        assert_eq!(Layer::from_rid("m"), Some(Layer::Medium));
        assert_eq!(Layer::from_rid("l"), Some(Layer::Low));
        assert_eq!(Layer::from_rid("x"), None);
    }

    #[test]
    fn test_layer_rid_string() {
        assert_eq!(Layer::High.rid(), "h");
        assert_eq!(Layer::Medium.rid(), "m");
        assert_eq!(Layer::Low.rid(), "l");
    }

    #[test]
    fn test_layer_preference_default() {
        assert_eq!(LayerPreference::default(), LayerPreference::Auto);
    }

    #[test]
    fn layer_preference_serde_round_trip() {
        // Verify wire format matches what client sends
        assert_eq!(serde_json::to_string(&LayerPreference::Auto).unwrap(), "\"auto\"");
        assert_eq!(serde_json::to_string(&LayerPreference::High).unwrap(), "\"high\"");
        assert_eq!(serde_json::to_string(&LayerPreference::Medium).unwrap(), "\"medium\"");
        assert_eq!(serde_json::to_string(&LayerPreference::Low).unwrap(), "\"low\"");

        // Verify deserialization from client-sent strings
        assert_eq!(serde_json::from_str::<LayerPreference>("\"auto\"").unwrap(), LayerPreference::Auto);
        assert_eq!(serde_json::from_str::<LayerPreference>("\"high\"").unwrap(), LayerPreference::High);
        assert_eq!(serde_json::from_str::<LayerPreference>("\"medium\"").unwrap(), LayerPreference::Medium);
        assert_eq!(serde_json::from_str::<LayerPreference>("\"low\"").unwrap(), LayerPreference::Low);
    }
}
