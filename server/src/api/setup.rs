//! Server Setup API Handlers
//!
//! Endpoints for the first-time setup wizard that configures the server.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    api::AppState,
    auth::AuthUser,
    db,
};

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum SetupError {
    SetupAlreadyComplete,
    Unauthorized,
    Validation(String),
    Database(sqlx::Error),
}

impl IntoResponse for SetupError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            Self::SetupAlreadyComplete => (
                StatusCode::FORBIDDEN,
                "SETUP_ALREADY_COMPLETE",
                "Server setup has already been completed".to_string(),
            ),
            Self::Unauthorized => (
                StatusCode::FORBIDDEN,
                "UNAUTHORIZED",
                "Only system administrators can complete setup".to_string(),
            ),
            Self::Validation(msg) => (
                StatusCode::BAD_REQUEST,
                "VALIDATION_ERROR",
                msg.clone(),
            ),
            Self::Database(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "Database error".to_string(),
            ),
        };
        (
            status,
            Json(serde_json::json!({ "error": code, "message": message })),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for SetupError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database(err)
    }
}

// ============================================================================
// Request/Response Types
// ============================================================================

/// Response for GET /api/setup/status
#[derive(Debug, Serialize)]
pub struct SetupStatusResponse {
    pub setup_complete: bool,
}

/// Response for GET /api/setup/config
#[derive(Debug, Serialize)]
pub struct SetupConfigResponse {
    pub server_name: String,
    pub registration_policy: String,
    pub terms_url: Option<String>,
    pub privacy_url: Option<String>,
}

/// Request body for POST /api/setup/complete
#[derive(Debug, Deserialize, Validate)]
pub struct CompleteSetupRequest {
    #[validate(length(min = 1, max = 64, message = "Server name must be 1-64 characters"))]
    pub server_name: String,
    #[validate(custom(function = "validate_registration_policy"))]
    pub registration_policy: String,
    #[validate(url(message = "Terms URL must be a valid URL"))]
    pub terms_url: Option<String>,
    #[validate(url(message = "Privacy URL must be a valid URL"))]
    pub privacy_url: Option<String>,
}

fn validate_registration_policy(policy: &str) -> Result<(), validator::ValidationError> {
    if matches!(policy, "open" | "invite_only" | "closed") {
        Ok(())
    } else {
        Err(validator::ValidationError::new("invalid_policy"))
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Check if server setup is complete.
/// GET /api/setup/status
#[tracing::instrument(skip(state))]
pub async fn status(
    State(state): State<AppState>,
) -> Result<Json<SetupStatusResponse>, SetupError> {
    let setup_complete = db::is_setup_complete(&state.db).await?;

    Ok(Json(SetupStatusResponse { setup_complete }))
}

/// Get current server configuration (only if setup is incomplete).
/// GET /api/setup/config
#[tracing::instrument(skip(state))]
pub async fn get_config(
    State(state): State<AppState>,
) -> Result<Json<SetupConfigResponse>, SetupError> {
    // Only allow fetching config if setup is incomplete
    if db::is_setup_complete(&state.db).await? {
        return Err(SetupError::SetupAlreadyComplete);
    }

    let server_name = db::get_config_value(&state.db, "server_name")
        .await?
        .as_str()
        .unwrap_or("Canis Server")
        .to_string();

    let registration_policy = db::get_config_value(&state.db, "registration_policy")
        .await?
        .as_str()
        .unwrap_or("open")
        .to_string();

    let terms_url = db::get_config_value(&state.db, "terms_url")
        .await?
        .as_str()
        .map(|s| s.to_string());

    let privacy_url = db::get_config_value(&state.db, "privacy_url")
        .await?
        .as_str()
        .map(|s| s.to_string());

    Ok(Json(SetupConfigResponse {
        server_name,
        registration_policy,
        terms_url,
        privacy_url,
    }))
}

/// Complete server setup (only if admin and setup is incomplete).
/// POST /api/setup/complete
#[tracing::instrument(skip(state))]
pub async fn complete(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CompleteSetupRequest>,
) -> Result<StatusCode, SetupError> {
    // Validate input
    body.validate()
        .map_err(|e| SetupError::Validation(e.to_string()))?;

    // Only allow completing setup if it's not already complete
    if db::is_setup_complete(&state.db).await? {
        return Err(SetupError::SetupAlreadyComplete);
    }

    // Verify user is a system admin
    let is_admin = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM system_admins WHERE user_id = $1) as "exists!""#,
        auth.id
    )
    .fetch_one(&state.db)
    .await?;

    if !is_admin {
        return Err(SetupError::Unauthorized);
    }

    // Update server configuration
    db::set_config_value(
        &state.db,
        "server_name",
        serde_json::json!(body.server_name),
        auth.id,
    )
    .await?;

    db::set_config_value(
        &state.db,
        "registration_policy",
        serde_json::json!(body.registration_policy),
        auth.id,
    )
    .await?;

    db::set_config_value(
        &state.db,
        "terms_url",
        body.terms_url
            .as_ref()
            .map(|s| serde_json::json!(s))
            .unwrap_or(serde_json::Value::Null),
        auth.id,
    )
    .await?;

    db::set_config_value(
        &state.db,
        "privacy_url",
        body.privacy_url
            .as_ref()
            .map(|s| serde_json::json!(s))
            .unwrap_or(serde_json::Value::Null),
        auth.id,
    )
    .await?;

    // Mark setup as complete (irreversible)
    db::mark_setup_complete(&state.db, auth.id).await?;

    tracing::info!(
        admin_id = %auth.id,
        server_name = %body.server_name,
        "Server setup completed"
    );

    Ok(StatusCode::NO_CONTENT)
}
