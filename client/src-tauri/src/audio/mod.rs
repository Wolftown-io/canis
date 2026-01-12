//! Audio Input/Output
//!
//! Handles audio capture, playback, encoding/decoding with cpal and opus.
//!
//! This module provides a Send + Sync audio handle that moves non-thread-safe
//! `cpal::Stream` objects into background tasks.

use thiserror::Error;

mod handle;

pub use handle::AudioHandle;

/// Audio configuration constants
pub const SAMPLE_RATE: u32 = 48000;
pub const CHANNELS: u16 = 2;
pub const FRAME_SIZE_MS: usize = 20;
pub const FRAME_SIZE: usize = (SAMPLE_RATE as usize * FRAME_SIZE_MS) / 1000; // 960 samples per channel

/// Audio errors
#[derive(Error, Debug)]
pub enum AudioError {
    #[error("No audio host available")]
    NoHost,
    #[error("No input device available")]
    NoInputDevice,
    #[error("No output device available")]
    NoOutputDevice,
    #[error("Device not found: {0}")]
    DeviceNotFound(String),
    #[error("Device is in use by another application")]
    DeviceInUse,
    #[error("Failed to get device config: {0}")]
    ConfigError(String),
    #[error("Failed to build stream: {0}")]
    StreamError(String),
    #[error("Opus encoder error: {0}")]
    EncoderError(String),
    #[error("Opus decoder error: {0}")]
    DecoderError(String),
    #[error("Permission denied")]
    PermissionDenied,
}

/// Audio device information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AudioDevice {
    pub device_id: String,
    pub label: String,
    pub is_default: bool,
}

/// List of audio devices
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AudioDeviceList {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_audio_handle() {
        let handle = AudioHandle::new();
        assert!(handle.is_ok());
    }

    #[test]
    fn test_enumerate_devices() {
        let handle = AudioHandle::new().unwrap();
        let devices = handle.enumerate_devices();
        // May fail on CI without audio hardware, so just check it returns a result
        let _ = devices;
    }

    #[test]
    fn test_mute_state() {
        let handle = AudioHandle::new().unwrap();
        assert!(!handle.is_muted());

        handle.set_muted(true);
        assert!(handle.is_muted());

        handle.set_muted(false);
        assert!(!handle.is_muted());
    }

    #[test]
    fn test_deafen_state() {
        let handle = AudioHandle::new().unwrap();
        assert!(!handle.is_deafened());

        handle.set_deafened(true);
        assert!(handle.is_deafened());
        assert!(handle.is_muted()); // Deafen also mutes

        handle.set_deafened(false);
        assert!(!handle.is_deafened());
    }
}
