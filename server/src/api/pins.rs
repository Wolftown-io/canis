//! User Pins API
//!
//! CRUD operations for user's global pins (notes, links, pinned messages).

use axum::{
    extract::State,
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

// ============================================================================
// Handlers
// ============================================================================

/// GET /api/me/pins - List user's pins
pub async fn list_pins(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Vec<Pin>>, PinsError> {
    let rows = sqlx::query_as::<_, PinRow>(
        r#"
        SELECT id, user_id, pin_type, content, title, metadata, created_at, position
        FROM user_pins
        WHERE user_id = $1
        ORDER BY position ASC, created_at DESC
        "#,
    )
    .bind(auth_user.id)
    .fetch_all(&state.db)
    .await?;

    let pins: Vec<Pin> = rows.into_iter().map(Pin::from).collect();
    Ok(Json(pins))
}

/// POST /api/me/pins - Create a new pin
pub async fn create_pin(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(request): Json<CreatePinRequest>,
) -> Result<Json<Pin>, PinsError> {
    // Validate content length
    if request.content.len() > MAX_CONTENT_LENGTH {
        return Err(PinsError::ContentTooLong);
    }

    // Validate title length
    if let Some(ref title) = request.title {
        if title.len() > MAX_TITLE_LENGTH {
            return Err(PinsError::TitleTooLong);
        }
    }

    // Check pin count limit
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM user_pins WHERE user_id = $1")
        .bind(auth_user.id)
        .fetch_one(&state.db)
        .await?;

    if count.0 >= MAX_PINS_PER_USER {
        return Err(PinsError::LimitExceeded);
    }

    // Get next position
    let max_pos: (Option<i32>,) =
        sqlx::query_as("SELECT MAX(position) FROM user_pins WHERE user_id = $1")
            .bind(auth_user.id)
            .fetch_one(&state.db)
            .await?;

    let next_position = max_pos.0.map(|v| v + 1).unwrap_or(0);

    // Insert pin
    let row = sqlx::query_as::<_, PinRow>(
        r#"
        INSERT INTO user_pins (user_id, pin_type, content, title, metadata, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, pin_type, content, title, metadata, created_at, position
        "#,
    )
    .bind(auth_user.id)
    .bind(request.pin_type.as_str())
    .bind(&request.content)
    .bind(&request.title)
    .bind(&request.metadata)
    .bind(next_position)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(Pin::from(row)))
}
