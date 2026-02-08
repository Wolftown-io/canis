//! Webcam Capture Module
//!
//! Camera capture using `nokhwa`. Runs on a blocking thread since
//! `nokhwa::Camera` is `!Send`. Produces I420 frames via `mpsc::Sender`.

use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};
use tracing::{debug, error, info, warn};

use super::convert::RgbToI420Converter;
use super::I420Frame;

/// A webcam device available for capture.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebcamDevice {
    /// Device index (used for opening).
    pub index: u32,
    /// Human-readable device name.
    pub name: String,
    /// Device description (driver info).
    pub description: String,
}

/// Enumerate available webcam devices.
pub fn enumerate_webcam_devices() -> Result<Vec<WebcamDevice>, String> {
    let backend =
        nokhwa::native_api_backend().ok_or_else(|| "No camera backend available".to_string())?;

    let cameras = nokhwa::query(backend).map_err(|e| format!("Failed to query cameras: {e}"))?;

    Ok(cameras
        .into_iter()
        .map(|info| {
            let index = match info.index() {
                CameraIndex::Index(i) => *i,
                CameraIndex::String(_) => 0,
            };
            WebcamDevice {
                index,
                name: info.human_name(),
                description: info.description().to_string(),
            }
        })
        .collect())
}

/// Webcam capturer that produces I420 frames from a camera device.
pub struct WebcamCapturer {
    device_index: u32,
    fps: u32,
    width: u32,
    height: u32,
}

impl WebcamCapturer {
    /// Create a new webcam capturer.
    ///
    /// `device_index` selects the camera (0 = first camera).
    /// `width`/`height`/`fps` are requested; the camera may use the closest supported format.
    pub const fn new(device_index: u32, fps: u32, width: u32, height: u32) -> Self {
        Self {
            device_index,
            fps,
            width,
            height,
        }
    }

    /// Start capturing frames, sending them to the provided channel.
    ///
    /// Runs on `spawn_blocking` since `nokhwa::Camera` is `!Send`.
    /// Returns when `shutdown_rx` receives `true` or the camera disconnects.
    pub fn start(
        self,
        frame_tx: mpsc::Sender<I420Frame>,
        shutdown_rx: watch::Receiver<bool>,
    ) -> Result<tokio::task::JoinHandle<()>, String> {
        let device_index = self.device_index;
        let fps = self.fps;
        let width = self.width;
        let height = self.height;

        let handle = tokio::task::spawn_blocking(move || {
            let index = CameraIndex::Index(device_index);
            let requested =
                RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);

            let mut camera = match Camera::new(index, requested) {
                Ok(c) => c,
                Err(e) => {
                    error!(device = device_index, error = %e, "Failed to open webcam");
                    return;
                }
            };

            if let Err(e) = camera.open_stream() {
                error!(device = device_index, error = %e, "Failed to open webcam stream");
                return;
            }

            // Get actual resolution from camera (may differ from requested)
            let actual_format = camera.camera_format();
            let actual_width = actual_format.resolution().width_x;
            let actual_height = actual_format.resolution().height_y;

            info!(
                device = device_index,
                requested_w = width,
                requested_h = height,
                actual_w = actual_width,
                actual_h = actual_height,
                fps,
                "Webcam capture started"
            );

            let mut converter = RgbToI420Converter::new(actual_width, actual_height);

            // Calculate frame interval for target FPS
            let frame_interval = std::time::Duration::from_millis(1000 / u64::from(fps));

            loop {
                if *shutdown_rx.borrow() {
                    info!(device = device_index, "Webcam capture shutdown requested");
                    break;
                }

                let frame_start = std::time::Instant::now();

                match camera.frame() {
                    Ok(frame) => match frame.decode_image::<RgbFormat>() {
                        Ok(decoded) => {
                            let rgb_data = decoded.into_raw();
                            let i420 = converter.convert_owned(&rgb_data);

                            if frame_tx.try_send(i420).is_err() {
                                debug!("Webcam frame dropped (receiver behind)");
                            }
                        }
                        Err(e) => {
                            warn!(error = %e, "Failed to decode webcam frame");
                        }
                    },
                    Err(e) => {
                        warn!(error = %e, "Failed to capture webcam frame");
                        // Brief sleep before retrying on error
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        continue;
                    }
                }

                // Pace to target FPS
                let elapsed = frame_start.elapsed();
                if let Some(remaining) = frame_interval.checked_sub(elapsed) {
                    std::thread::sleep(remaining);
                }
            }

            if let Err(e) = camera.stop_stream() {
                warn!(error = %e, "Error stopping webcam stream");
            }
            info!(device = device_index, "Webcam capture stopped");
        });

        Ok(handle)
    }
}
