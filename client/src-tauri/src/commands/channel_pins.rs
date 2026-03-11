//! Channel Pins Tauri Commands
//!
//! Pin/unpin messages within a channel.

use tauri::{command, State};
use tracing::{debug, error};

use crate::AppState;

/// List all pinned messages in a channel.
#[command]
pub async fn list_channel_pins(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<serde_json::Value, String> {
    let (server_url, token) = {
        let auth = state.auth.read().await;
        (auth.server_url.clone(), auth.access_token.clone())
    };

    let server_url = server_url.ok_or("Not authenticated")?;
    let token = token.ok_or("Not authenticated")?;

    debug!("Listing channel pins: channel_id={}", channel_id);

    let response = state
        .http
        .get(format!("{server_url}/api/channels/{channel_id}/pins"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| {
            error!("Failed to list channel pins: {}", e);
            format!("Connection failed: {e}")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        error!("Failed to list channel pins: {}", status);
        return Err(format!("Failed to list channel pins: {status}"));
    }

    let pins: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    debug!("Listed channel pins for channel {}", channel_id);
    Ok(pins)
}

/// Pin a message to a channel.
#[command]
pub async fn pin_message(
    state: State<'_, AppState>,
    channel_id: String,
    message_id: String,
) -> Result<(), String> {
    let (server_url, token) = {
        let auth = state.auth.read().await;
        (auth.server_url.clone(), auth.access_token.clone())
    };

    let server_url = server_url.ok_or("Not authenticated")?;
    let token = token.ok_or("Not authenticated")?;

    debug!("Pinning message: channel_id={}, message_id={}", channel_id, message_id);

    let response = state
        .http
        .put(format!("{server_url}/api/channels/{channel_id}/messages/{message_id}/pin"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| {
            error!("Failed to pin message: {}", e);
            format!("Connection failed: {e}")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("Failed to pin message: {} - {}", status, body);
        return Err(format!("Failed to pin message: {status}"));
    }

    debug!("Message pinned: {}", message_id);
    Ok(())
}

/// Unpin a message from a channel.
#[command]
pub async fn unpin_message(
    state: State<'_, AppState>,
    channel_id: String,
    message_id: String,
) -> Result<(), String> {
    let (server_url, token) = {
        let auth = state.auth.read().await;
        (auth.server_url.clone(), auth.access_token.clone())
    };

    let server_url = server_url.ok_or("Not authenticated")?;
    let token = token.ok_or("Not authenticated")?;

    debug!("Unpinning message: channel_id={}, message_id={}", channel_id, message_id);

    let response = state
        .http
        .delete(format!("{server_url}/api/channels/{channel_id}/messages/{message_id}/pin"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| {
            error!("Failed to unpin message: {}", e);
            format!("Connection failed: {e}")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        error!("Failed to unpin message: {}", status);
        return Err(format!("Failed to unpin message: {status}"));
    }

    debug!("Message unpinned: {}", message_id);
    Ok(())
}
