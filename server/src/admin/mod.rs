//! System Admin Module

pub mod middleware;
pub mod types;

use axum::{routing::get, Router};

use crate::api::AppState;

pub use middleware::{require_elevated, require_system_admin};
pub use types::{AdminError, ElevatedAdmin, SystemAdminUser};

/// Create the admin router (placeholder for now).
pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(|| async { "admin ok" }))
}
