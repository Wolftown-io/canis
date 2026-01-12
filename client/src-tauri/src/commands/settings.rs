//! Settings Commands

use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct Settings {
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub input_volume: f32,
    pub output_volume: f32,
    pub noise_suppression: bool,
    pub push_to_talk: bool,
    pub push_to_talk_key: Option<String>,
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            input_device: None,
            output_device: None,
            input_volume: 1.0,
            output_volume: 1.0,
            noise_suppression: true,
            push_to_talk: false,
            push_to_talk_key: None,
            theme: "dark".into(),
        }
    }
}

#[command]
pub async fn get_settings() -> Result<Settings, String> {
    // TODO: Load from storage
    Ok(Settings::default())
}

#[command]
pub async fn update_settings(_settings: Settings) -> Result<(), String> {
    // TODO: Save to storage
    Ok(())
}
