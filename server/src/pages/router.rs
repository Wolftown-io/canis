//! Router configuration for information pages.

use axum::routing::{delete, get, patch, post};
use axum::Router;

use super::handlers;
use crate::api::AppState;

/// Router for platform pages (mounted at /api/pages).
pub fn platform_pages_router() -> Router<AppState> {
    Router::new()
        .route("/", get(handlers::list_platform_pages))
        .route("/", post(handlers::create_platform_page))
        .route("/pending-acceptance", get(handlers::get_pending_acceptance))
        .route("/reorder", post(handlers::reorder_platform_pages))
        .route("/by-slug/{slug}", get(handlers::get_platform_page))
        .route("/{id}", patch(handlers::update_platform_page))
        .route("/{id}", delete(handlers::delete_platform_page))
        .route("/{id}/accept", post(handlers::accept_page))
        .route(
            "/{page_id}/revisions",
            get(handlers::list_platform_page_revisions),
        )
        .route(
            "/{page_id}/revisions/{n}",
            get(handlers::get_platform_page_revision),
        )
        .route(
            "/{page_id}/revisions/{n}/restore",
            post(handlers::restore_platform_page_revision),
        )
}

/// Router for guild pages (mounted at `/api/guilds/{guild_id}/pages`).
pub fn guild_pages_router() -> Router<AppState> {
    Router::new()
        .route("/", get(handlers::list_guild_pages))
        .route("/", post(handlers::create_guild_page))
        .route("/reorder", post(handlers::reorder_guild_pages))
        .route("/by-slug/{slug}", get(handlers::get_guild_page))
        .route("/{id}", patch(handlers::update_guild_page))
        .route("/{id}", delete(handlers::delete_guild_page))
        .route("/{id}/accept", post(handlers::accept_guild_page))
        .route(
            "/{page_id}/revisions",
            get(handlers::list_guild_page_revisions),
        )
        .route(
            "/{page_id}/revisions/{n}",
            get(handlers::get_guild_page_revision),
        )
        .route(
            "/{page_id}/revisions/{n}/restore",
            post(handlers::restore_guild_page_revision),
        )
}

/// Router for guild page categories (mounted at `/api/guilds/{guild_id}/page-categories`).
pub fn guild_page_categories_router() -> Router<AppState> {
    Router::new()
        .route("/", get(handlers::list_guild_categories))
        .route("/", post(handlers::create_guild_category))
        .route("/reorder", post(handlers::reorder_guild_categories))
        .route("/{cat_id}", patch(handlers::update_guild_category))
        .route("/{cat_id}", delete(handlers::delete_guild_category))
}
