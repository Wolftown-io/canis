//! Bot Gateway WebSocket
//!
//! Dedicated WebSocket endpoint for bot applications with separate event handling
//! and rate limiting from the user gateway.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::Response,
    Extension,
};
use fred::{interfaces::PubsubInterface, types::RedisValue};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, instrument, warn};
use uuid::Uuid;

use crate::api::AppState;

/// Events that bots can send to the server.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BotClientEvent {
    /// Send a message to a channel.
    MessageCreate {
        /// Channel ID to send to.
        channel_id: Uuid,
        /// Message content.
        content: String,
    },
    /// Respond to a slash command invocation.
    CommandResponse {
        /// Interaction ID (from CommandInvoked event).
        interaction_id: Uuid,
        /// Response content.
        content: String,
        /// Whether the response is ephemeral (only visible to invoker).
        ephemeral: bool,
    },
}

/// Events that the server sends to bots.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BotServerEvent {
    /// A slash command was invoked.
    CommandInvoked {
        /// Unique interaction ID for this invocation.
        interaction_id: Uuid,
        /// Command name.
        command_name: String,
        /// Guild where command was invoked (null for DM commands).
        guild_id: Option<Uuid>,
        /// Channel where command was invoked.
        channel_id: Uuid,
        /// User who invoked the command.
        user_id: Uuid,
        /// Command options/arguments.
        options: serde_json::Value,
    },
    /// A message was created in a channel the bot has access to.
    MessageCreated {
        /// Message ID.
        message_id: Uuid,
        /// Channel ID.
        channel_id: Uuid,
        /// Guild ID (null for DMs).
        guild_id: Option<Uuid>,
        /// Author user ID.
        user_id: Uuid,
        /// Message content.
        content: String,
    },
    /// Bot was added to a guild.
    GuildJoined {
        /// Guild ID.
        guild_id: Uuid,
        /// Guild name.
        guild_name: String,
    },
    /// Bot was removed from a guild.
    GuildLeft {
        /// Guild ID.
        guild_id: Uuid,
    },
    /// Error occurred.
    Error {
        /// Error code.
        code: String,
        /// Error message.
        message: String,
    },
}

/// Bot WebSocket connection state.
struct BotConnection {
    /// Bot user ID.
    bot_user_id: Uuid,
    /// Application ID.
    application_id: Uuid,
    /// Redis subscriber handle.
    _subscriber_handle: tokio::task::JoinHandle<()>,
}

/// Authenticate bot token and return bot user ID and application ID.
async fn authenticate_bot_token(
    pool: &PgPool,
    token: &str,
) -> Result<(Uuid, Uuid), (StatusCode, String)> {
    // Query for bot application with matching token
    let app = sqlx::query!(
        r#"
        SELECT id, bot_user_id, token_hash
        FROM bot_applications
        WHERE bot_user_id IS NOT NULL AND token_hash IS NOT NULL
        "#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        error!("Database error during bot auth: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server error".to_string(),
        )
    })?;

    // Check each token hash (this is inefficient but secure)
    // In production, you'd want to optimize this with indexed lookups
    for record in app {
        if let Some(hash) = record.token_hash {
            if argon2::verify_encoded(&hash, token.as_bytes()).unwrap_or(false) {
                if let Some(bot_user_id) = record.bot_user_id {
                    return Ok((bot_user_id, record.id));
                }
            }
        }
    }

    Err((StatusCode::UNAUTHORIZED, "Invalid bot token".to_string()))
}

/// Extract bot token from WebSocket upgrade request.
fn extract_bot_token(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bot "))
        .map(|s| s.to_string())
}

/// Bot gateway WebSocket handler.
#[instrument(skip(state, ws))]
pub async fn bot_gateway_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<Response, (StatusCode, String)> {
    // Extract token from headers
    let token = extract_bot_token(ws.headers()).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Missing or invalid Authorization header (expected: Bot <token>)".to_string(),
        )
    })?;

    // Authenticate bot
    let (bot_user_id, application_id) = authenticate_bot_token(&state.db, &token).await?;

    info!(
        bot_user_id = %bot_user_id,
        application_id = %application_id,
        "Bot authenticated for gateway"
    );

    // Upgrade to WebSocket
    Ok(ws.on_upgrade(move |socket| handle_bot_socket(socket, state, bot_user_id, application_id)))
}

/// Handle bot WebSocket connection.
async fn handle_bot_socket(
    socket: WebSocket,
    state: AppState,
    bot_user_id: Uuid,
    application_id: Uuid,
) {
    let (mut sender, mut receiver) = socket.split();

    // Create Redis subscriber for bot events
    let redis_client = state.redis.clone();
    let bot_channel = format!("bot:{}", bot_user_id);

    // Spawn subscriber task
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<BotServerEvent>();
    let subscriber_handle = tokio::spawn(async move {
        // Subscribe to bot's Redis channel
        let mut pubsub = match redis_client.pubsub_subscriber() {
            Ok(sub) => sub,
            Err(e) => {
                error!("Failed to create Redis pubsub subscriber: {}", e);
                return;
            }
        };

        if let Err(e) = pubsub.subscribe(&bot_channel).await {
            error!("Failed to subscribe to bot channel: {}", e);
            return;
        }

        info!("Bot subscribed to Redis channel: {}", bot_channel);

        // Listen for messages
        let mut message_stream = pubsub.on_message();
        while let Ok(msg) = message_stream.recv().await {
            if let RedisValue::String(data) = msg.value {
                match serde_json::from_str::<BotServerEvent>(&data) {
                    Ok(event) => {
                        if tx.send(event).is_err() {
                            break; // Receiver dropped, connection closed
                        }
                    }
                    Err(e) => {
                        warn!("Failed to deserialize bot event: {}", e);
                    }
                }
            }
        }
    });

    let _connection = Arc::new(RwLock::new(BotConnection {
        bot_user_id,
        application_id,
        _subscriber_handle: subscriber_handle,
    }));

    // Handle incoming messages from bot
    let state_clone = state.clone();
    let bot_receiver = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                match serde_json::from_str::<BotClientEvent>(&text) {
                    Ok(event) => {
                        if let Err(e) =
                            handle_bot_event(event, &state_clone, bot_user_id, application_id).await
                        {
                            error!("Error handling bot event: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse bot message: {}", e);
                    }
                }
            }
        }
    });

    // Forward events to bot
    while let Some(event) = rx.recv().await {
        match serde_json::to_string(&event) {
            Ok(json) => {
                if sender.send(Message::Text(json)).await.is_err() {
                    break; // Connection closed
                }
            }
            Err(e) => {
                error!("Failed to serialize bot event: {}", e);
            }
        }
    }

    // Cleanup
    bot_receiver.abort();
    info!(bot_user_id = %bot_user_id, "Bot disconnected from gateway");
}

/// Handle events from bot.
async fn handle_bot_event(
    event: BotClientEvent,
    state: &AppState,
    bot_user_id: Uuid,
    _application_id: Uuid,
) -> Result<(), String> {
    match event {
        BotClientEvent::MessageCreate {
            channel_id,
            content,
        } => {
            // TODO: Create message in channel as bot user
            // This would integrate with existing message creation logic
            info!(
                bot_user_id = %bot_user_id,
                channel_id = %channel_id,
                "Bot sending message"
            );

            // For now, just log - full implementation would create the message
            // via the chat::messages module
            Ok(())
        }
        BotClientEvent::CommandResponse {
            interaction_id,
            content,
            ephemeral,
        } => {
            // TODO: Send command response back to user
            info!(
                interaction_id = %interaction_id,
                ephemeral = ephemeral,
                "Bot responding to command"
            );

            // For now, just log - full implementation would send response
            // to the user who invoked the command
            Ok(())
        }
    }
}
