//! Screen Share integration tests.
//!
//! Tests for screen sharing REST endpoints and WebSocket broadcast events.
//!
//! Run with: `cargo test --test integration screenshare`
//! Run ignored (integration) tests: `cargo test --test integration screenshare -- --ignored`

use uuid::Uuid;
// ============================================================================
// Unit Tests (no database/Redis required)
// ============================================================================
use vc_server::voice::{
    Quality, ScreenShareCheckResponse, ScreenShareError, ScreenShareInfo, ScreenShareStartRequest,
};

#[test]
fn test_screen_share_check_response_allowed_serialization() {
    let resp = ScreenShareCheckResponse::allowed(Quality::High);
    let json = serde_json::to_string(&resp).unwrap();

    assert!(json.contains("\"allowed\":true"));
    assert!(json.contains("\"granted_quality\""));
    assert!(!json.contains("\"error\""));
}

#[test]
fn test_screen_share_check_response_denied_serialization() {
    let resp = ScreenShareCheckResponse::denied(ScreenShareError::NoPermission);
    let json = serde_json::to_string(&resp).unwrap();

    assert!(json.contains("\"allowed\":false"));
    assert!(json.contains("\"error\":\"no_permission\""));
}

#[test]
fn test_screen_share_error_into_response_status_codes() {
    // Verify that each error variant maps to the expected status concept
    let test_cases = [
        (ScreenShareError::NoPermission, "no_permission"),
        (ScreenShareError::LimitReached, "limit_reached"),
        (ScreenShareError::NotInChannel, "not_in_channel"),
        (ScreenShareError::QualityNotAllowed, "quality_not_allowed"),
        (
            ScreenShareError::RenegotiationFailed,
            "renegotiation_failed",
        ),
        (ScreenShareError::InternalError, "internal_error"),
        (ScreenShareError::InvalidSourceLabel, "invalid_source_label"),
        (ScreenShareError::AlreadySharing, "already_sharing"),
    ];

    for (error, expected_str) in test_cases {
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, format!("\"{expected_str}\""));
    }
}

#[test]
fn test_screen_share_start_request_deserialization() {
    let json = r#"{"quality":"high","has_audio":true,"source_label":"Display 1"}"#;
    let req: ScreenShareStartRequest = serde_json::from_str(json).unwrap();

    assert_eq!(req.quality, Quality::High);
    assert!(req.has_audio);
    assert_eq!(req.source_label, "Display 1");
}

#[test]
fn test_screen_share_info_roundtrip() {
    let user_id = Uuid::new_v4();
    let info = ScreenShareInfo::new(
        Uuid::new_v4(),
        user_id,
        "testuser".to_string(),
        "Display 1".to_string(),
        true,
        Quality::High,
    );

    let json = serde_json::to_string(&info).unwrap();
    let deserialized: ScreenShareInfo = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.user_id, user_id);
    assert_eq!(deserialized.username, "testuser");
    assert_eq!(deserialized.source_label, "Display 1");
    assert!(deserialized.has_audio);
    assert_eq!(deserialized.quality, Quality::High);
}

// ============================================================================
// ServerEvent serialization tests (screen share events)
// ============================================================================

#[test]
fn test_server_event_screen_share_started_serialization() {
    use vc_server::ws::ServerEvent;

    let channel_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    let stream_id = Uuid::new_v4();

    let event = ServerEvent::ScreenShareStarted {
        channel_id,
        user_id,
        stream_id,
        username: "alice".to_string(),
        source_label: "Display 1".to_string(),
        has_audio: true,
        quality: Quality::High,
        started_at: "2026-01-01T00:00:00+00:00".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"screen_share_started\""));
    assert!(json.contains(&format!("\"channel_id\":\"{channel_id}\"")));
    assert!(json.contains(&format!("\"user_id\":\"{user_id}\"")));
    assert!(json.contains(&format!("\"stream_id\":\"{stream_id}\"")));
    assert!(json.contains("\"username\":\"alice\""));
    assert!(json.contains("\"source_label\":\"Display 1\""));
    assert!(json.contains("\"has_audio\":true"));
    assert!(json.contains("\"started_at\":\"2026-01-01T00:00:00+00:00\""));
}

#[test]
fn test_server_event_screen_share_stopped_serialization() {
    use vc_server::ws::ServerEvent;

    let channel_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    let stream_id = Uuid::new_v4();

    let event = ServerEvent::ScreenShareStopped {
        channel_id,
        user_id,
        stream_id,
        reason: "user_stopped".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"screen_share_stopped\""));
    assert!(json.contains(&format!("\"stream_id\":\"{stream_id}\"")));
    assert!(json.contains("\"reason\":\"user_stopped\""));
}

#[test]
fn test_server_event_screen_share_quality_changed_serialization() {
    use vc_server::ws::ServerEvent;

    let channel_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    let event = ServerEvent::ScreenShareQualityChanged {
        channel_id,
        user_id,
        new_quality: Quality::Medium,
        reason: "bandwidth_adaptation".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"screen_share_quality_changed\""));
    assert!(json.contains("\"reason\":\"bandwidth_adaptation\""));
}

// ============================================================================
// Integration Tests (require database + Redis)
// ============================================================================

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;

use super::helpers::{
    create_guild_with_default_role, create_test_user, create_voice_channel,
    generate_access_token, TestApp,
};
use vc_server::permissions::GuildPermissions;

/// Screen share check endpoint requires authentication.
#[tokio::test]
async fn test_screen_share_check_requires_auth() {
    let app = TestApp::new().await;
    let channel_id = Uuid::now_v7();

    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/channels/{channel_id}/screenshare/check"))
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// Screen share check endpoint requires `SCREEN_SHARE` permission.
#[tokio::test]
async fn test_screen_share_check_requires_permission() {
    let app = TestApp::new().await;
    let (user_id, _username) = create_test_user(&app.pool).await;

    // Guild with VIEW_CHANNEL + VOICE_CONNECT but NOT SCREEN_SHARE
    let perms = GuildPermissions::VIEW_CHANNEL | GuildPermissions::VOICE_CONNECT;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;

    let token = generate_access_token(&app.config, user_id);
    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/channels/{channel_id}/screenshare/check"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["allowed"], false);
    assert_eq!(json["error"], "no_permission");
}

/// Screen share check allows permitted users.
#[tokio::test]
async fn test_screen_share_check_allowed() {
    let app = TestApp::new().await;
    let (user_id, _username) = create_test_user(&app.pool).await;

    let perms = GuildPermissions::VIEW_CHANNEL
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;

    let token = generate_access_token(&app.config, user_id);
    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/channels/{channel_id}/screenshare/check"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["allowed"], true);
    assert!(json.get("granted_quality").is_some());
}

/// Screen share start requires voice room membership.
#[tokio::test]
async fn test_screen_share_start_requires_room_membership() {
    let app = TestApp::new().await;
    let (user_id, _username) = create_test_user(&app.pool).await;

    let perms = GuildPermissions::VIEW_CHANNEL
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;

    let token = generate_access_token(&app.config, user_id);
    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/channels/{channel_id}/screenshare/start"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

/// Screen share stop is a no-op when not sharing.
#[tokio::test]
async fn test_screen_share_stop_noop() {
    let app = TestApp::new().await;
    let (user_id, _username) = create_test_user(&app.pool).await;

    let perms = GuildPermissions::VIEW_CHANNEL
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;

    let token = generate_access_token(&app.config, user_id);

    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/channels/{channel_id}/screenshare/stop"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

/// Screen share check rejects invalid source labels (XSS attempt).
#[tokio::test]
async fn test_screen_share_check_invalid_source_label() {
    let app = TestApp::new().await;
    let (user_id, _username) = create_test_user(&app.pool).await;

    let perms = GuildPermissions::VIEW_CHANNEL
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;

    let token = generate_access_token(&app.config, user_id);
    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "<script>alert(1)</script>"
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/channels/{channel_id}/screenshare/check"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
