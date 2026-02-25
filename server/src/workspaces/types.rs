//! Workspace Request/Response Types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ============================================================================
// Database Row Types
// ============================================================================

#[derive(Debug, FromRow)]
pub struct WorkspaceRow {
    pub id: Uuid,
    pub owner_user_id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct WorkspaceListRow {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub entry_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct WorkspaceEntryRow {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub guild_id: Uuid,
    pub channel_id: Uuid,
    pub position: i32,
    pub guild_name: String,
    pub guild_icon: Option<String>,
    pub channel_name: String,
    pub channel_type: String,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// API Response Types
// ============================================================================

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WorkspaceResponse {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<WorkspaceRow> for WorkspaceResponse {
    fn from(row: WorkspaceRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            icon: row.icon,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WorkspaceListItem {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub entry_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<WorkspaceListRow> for WorkspaceListItem {
    fn from(row: WorkspaceListRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            icon: row.icon,
            sort_order: row.sort_order,
            entry_count: row.entry_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WorkspaceEntryResponse {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub channel_id: Uuid,
    pub position: i32,
    pub guild_name: String,
    pub guild_icon: Option<String>,
    pub channel_name: String,
    pub channel_type: String,
    pub created_at: DateTime<Utc>,
}

impl From<WorkspaceEntryRow> for WorkspaceEntryResponse {
    fn from(row: WorkspaceEntryRow) -> Self {
        Self {
            id: row.id,
            guild_id: row.guild_id,
            channel_id: row.channel_id,
            position: row.position,
            guild_name: row.guild_name,
            guild_icon: row.guild_icon,
            channel_name: row.channel_name,
            channel_type: row.channel_type,
            created_at: row.created_at,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WorkspaceDetailResponse {
    #[serde(flatten)]
    pub workspace: WorkspaceResponse,
    pub entries: Vec<WorkspaceEntryResponse>,
}

// ============================================================================
// API Request Types
// ============================================================================

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateWorkspaceRequest {
    pub name: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AddEntryRequest {
    pub guild_id: Uuid,
    pub channel_id: Uuid,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ReorderEntriesRequest {
    pub entry_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ReorderWorkspacesRequest {
    pub workspace_ids: Vec<Uuid>,
}
