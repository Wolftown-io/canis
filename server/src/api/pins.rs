//! User Pins API
//!
//! CRUD operations for user's global pins (notes, links, pinned messages).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::api::AppState;
use crate::auth::AuthUser;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PinType {
    Note,
    Link,
    Message,
}

impl PinType {
    fn as_str(&self) -> &'static str {
        match self {
            PinType::Note => "note",
            PinType::Link => "link",
            PinType::Message => "message",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "note" => Some(PinType::Note),
            "link" => Some(PinType::Link),
            "message" => Some(PinType::Message),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, FromRow)]
pub struct PinRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub pin_type: String,
    pub content: String,
    pub title: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub position: i32,
}

#[derive(Debug, Serialize)]
pub struct Pin {
    pub id: Uuid,
    pub pin_type: PinType,
    pub content: String,
    pub title: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub position: i32,
}

impl From<PinRow> for Pin {
    fn from(row: PinRow) -> Self {
        Pin {
            id: row.id,
            pin_type: PinType::from_str(&row.pin_type).unwrap_or(PinType::Note),
            content: row.content,
            title: row.title,
            metadata: row.metadata,
            created_at: row.created_at,
            position: row.position,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreatePinRequest {
    pub pin_type: PinType,
    pub content: String,
    pub title: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePinRequest {
    pub content: Option<String>,
    pub title: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderPinsRequest {
    pub pin_ids: Vec<Uuid>,
}

// ============================================================================
// Constants
// ============================================================================

const MAX_PINS_PER_USER: i64 = 50;
const MAX_CONTENT_LENGTH: usize = 2000;
const MAX_TITLE_LENGTH: usize = 255;

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug, thiserror::Error)]
pub enum PinsError {
    #[error("Pin not found")]
    NotFound,
    #[error("Maximum pins limit reached (50)")]
    LimitExceeded,
    #[error("Content exceeds maximum length")]
    ContentTooLong,
    #[error("Title exceeds maximum length")]
    TitleTooLong,
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for PinsError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            PinsError::NotFound => (StatusCode::NOT_FOUND, "Pin not found"),
            PinsError::LimitExceeded => (StatusCode::BAD_REQUEST, "Maximum pins limit reached (50)"),
            PinsError::ContentTooLong => (StatusCode::BAD_REQUEST, "Content exceeds maximum length"),
            PinsError::TitleTooLong => (StatusCode::BAD_REQUEST, "Title exceeds maximum length"),
            PinsError::Database(err) => {
                tracing::error!("Database error: {}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
