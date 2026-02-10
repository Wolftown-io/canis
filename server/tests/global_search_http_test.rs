//! HTTP Integration Tests for Global Search Endpoint (`GET /api/search`)
//!
//! Tests the global search endpoint which searches across all guilds and DMs
//! the authenticated user has access to.
//!
//! Run with: `cargo test --test global_search_http_test -- --test-threads=1`

mod helpers;

use axum::body::Body;
use axum::http::Method;
use helpers::{
    body_to_json, create_dm_channel, create_test_user, delete_user, generate_access_token, TestApp,
};
use serial_test::serial;
use uuid::Uuid;

// ============================================================================
// Local test helpers (mirrored from search_http_test.rs)
// ============================================================================

/// Create a guild with the given owner and return its ID.
async fn create_guild(pool: &sqlx::PgPool, owner_id: Uuid) -> Uuid {
    let guild_id = Uuid::now_v7();
    let name = format!("GlobalSearchGuild_{}", &guild_id.to_string()[..8]);

    sqlx::query("INSERT INTO guilds (id, name, owner_id) VALUES ($1, $2, $3)")
        .bind(guild_id)
        .bind(&name)
        .bind(owner_id)
        .execute(pool)
        .await
        .expect("Failed to create guild");

    sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2)")
        .bind(guild_id)
        .bind(owner_id)
        .execute(pool)
        .await
        .expect("Failed to add guild member");

    guild_id
}

/// Create a text channel in a guild and return its ID.
async fn create_channel(pool: &sqlx::PgPool, guild_id: Uuid, name: &str) -> Uuid {
    let channel_id = Uuid::now_v7();

    sqlx::query(
        "INSERT INTO channels (id, guild_id, name, channel_type) VALUES ($1, $2, $3, 'text')",
    )
    .bind(channel_id)
    .bind(guild_id)
    .bind(name)
    .execute(pool)
    .await
    .expect("Failed to create channel");

    channel_id
}

/// Insert a message and return its ID.
async fn insert_message(
    pool: &sqlx::PgPool,
    channel_id: Uuid,
    user_id: Uuid,
    content: &str,
) -> Uuid {
    let msg_id = Uuid::now_v7();

    sqlx::query("INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, $4)")
        .bind(msg_id)
        .bind(channel_id)
        .bind(user_id)
        .bind(content)
        .execute(pool)
        .await
        .expect("Failed to insert message");

    msg_id
}

/// Delete a guild (cascades channels, messages, members).
async fn delete_guild(pool: &sqlx::PgPool, guild_id: Uuid) {
    sqlx::query("DELETE FROM channels WHERE guild_id = $1")
        .bind(guild_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM guild_members WHERE guild_id = $1")
        .bind(guild_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM guilds WHERE id = $1")
        .bind(guild_id)
        .execute(pool)
        .await
        .ok();
}

/// Helper: global search GET request.
fn global_search_request(query_string: &str, token: &str) -> axum::http::Request<Body> {
    TestApp::request(Method::GET, &format!("/api/search?{query_string}"))
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

// ============================================================================
// Global Search — Auth
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_requires_auth() {
    let app = TestApp::new().await;

    let req = TestApp::request(Method::GET, "/api/search?q=test")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 401);
}

// ============================================================================
// Global Search — Basic
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_basic() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let guild_id = create_guild(&app.pool, user_id).await;
    let channel_id = create_channel(&app.pool, guild_id, "general").await;
    let token = generate_access_token(&app.config, user_id);

    insert_message(
        &app.pool,
        channel_id,
        user_id,
        "Hello world testing global search",
    )
    .await;
    insert_message(&app.pool, channel_id, user_id, "Unrelated content").await;

    let req = global_search_request("q=global+search", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 1);

    let results = json["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);

    let result = &results[0];
    // Verify response shape
    assert!(result["id"].is_string(), "id should be present");
    assert!(result["channel_id"].is_string(), "channel_id should be present");
    assert!(result["channel_name"].is_string(), "channel_name should be present");
    assert!(result["author"].is_object(), "author should be present");
    assert!(result["content"].is_string(), "content should be present");
    assert!(result["created_at"].is_string(), "created_at should be present");
    assert!(result["headline"].is_string(), "headline should be present");
    assert!(result["rank"].is_f64(), "rank should be a float");
    assert!(result["source"].is_object(), "source should be present");

    // Verify headline contains mark tags
    let headline = result["headline"].as_str().unwrap();
    assert!(
        headline.contains("<mark>"),
        "headline should contain <mark> tags, got: {headline}"
    );

    // Verify rank is positive
    let rank = result["rank"].as_f64().unwrap();
    assert!(rank > 0.0, "rank should be positive, got: {rank}");

    delete_guild(&app.pool, guild_id).await;
    delete_user(&app.pool, user_id).await;
}

// ============================================================================
// Global Search — Multi Guild
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_multi_guild() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let token = generate_access_token(&app.config, user_id);

    // Create two guilds
    let guild_a = create_guild(&app.pool, user_id).await;
    let ch_a = create_channel(&app.pool, guild_a, "chat-a").await;
    insert_message(&app.pool, ch_a, user_id, "Pineapple discussion in guild A").await;

    let guild_b = create_guild(&app.pool, user_id).await;
    let ch_b = create_channel(&app.pool, guild_b, "chat-b").await;
    insert_message(&app.pool, ch_b, user_id, "Pineapple discussion in guild B").await;

    let req = global_search_request("q=pineapple", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 2, "Should find results from both guilds");

    let results = json["results"].as_array().unwrap();
    let guild_ids: Vec<&str> = results
        .iter()
        .filter_map(|r| r["source"]["guild_id"].as_str())
        .collect();
    assert!(
        guild_ids.contains(&guild_a.to_string().as_str()),
        "Should include result from guild A"
    );
    assert!(
        guild_ids.contains(&guild_b.to_string().as_str()),
        "Should include result from guild B"
    );

    delete_guild(&app.pool, guild_a).await;
    delete_guild(&app.pool, guild_b).await;
    delete_user(&app.pool, user_id).await;
}

// ============================================================================
// Global Search — Includes DMs
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_includes_dms() {
    let app = TestApp::new().await;
    let (user_a, _) = create_test_user(&app.pool).await;
    let (user_b, _) = create_test_user(&app.pool).await;
    let token = generate_access_token(&app.config, user_a);

    // Guild message
    let guild_id = create_guild(&app.pool, user_a).await;
    let ch = create_channel(&app.pool, guild_id, "general").await;
    insert_message(&app.pool, ch, user_a, "Mango smoothie in guild").await;

    // DM message
    let dm_id = create_dm_channel(&app.pool, user_a, user_b).await;
    insert_message(&app.pool, dm_id, user_a, "Mango smoothie in DM").await;

    let req = global_search_request("q=mango+smoothie", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(
        json["total"], 2,
        "Should include both guild and DM results"
    );

    let results = json["results"].as_array().unwrap();
    let source_types: Vec<&str> = results
        .iter()
        .filter_map(|r| r["source"]["type"].as_str())
        .collect();
    assert!(
        source_types.contains(&"guild"),
        "Should have a guild source"
    );
    assert!(source_types.contains(&"dm"), "Should have a dm source");

    // Cleanup
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(dm_id)
        .execute(&app.pool)
        .await
        .ok();
    delete_guild(&app.pool, guild_id).await;
    delete_user(&app.pool, user_a).await;
    delete_user(&app.pool, user_b).await;
}

// ============================================================================
// Global Search — Source Guild
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_source_guild() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let guild_id = create_guild(&app.pool, user_id).await;
    let channel_id = create_channel(&app.pool, guild_id, "general").await;
    let token = generate_access_token(&app.config, user_id);

    insert_message(
        &app.pool,
        channel_id,
        user_id,
        "Kumquat source verification",
    )
    .await;

    let req = global_search_request("q=kumquat", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 1);

    let source = &json["results"][0]["source"];
    assert_eq!(source["type"], "guild");
    assert_eq!(source["guild_id"], guild_id.to_string());
    assert!(
        source["guild_name"].is_string(),
        "guild_name should be present for guild source"
    );

    delete_guild(&app.pool, guild_id).await;
    delete_user(&app.pool, user_id).await;
}

// ============================================================================
// Global Search — Source DM
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_source_dm() {
    let app = TestApp::new().await;
    let (user_a, _) = create_test_user(&app.pool).await;
    let (user_b, _) = create_test_user(&app.pool).await;
    let token = generate_access_token(&app.config, user_a);

    let dm_id = create_dm_channel(&app.pool, user_a, user_b).await;
    insert_message(&app.pool, dm_id, user_a, "Dragonfruit private chat").await;

    let req = global_search_request("q=dragonfruit", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 1);

    let source = &json["results"][0]["source"];
    assert_eq!(source["type"], "dm");
    assert!(
        source["guild_id"].is_null(),
        "guild_id should be null for DM source"
    );
    assert!(
        source["guild_name"].is_null(),
        "guild_name should be null for DM source"
    );

    // Cleanup
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(dm_id)
        .execute(&app.pool)
        .await
        .ok();
    delete_user(&app.pool, user_a).await;
    delete_user(&app.pool, user_b).await;
}

// ============================================================================
// Global Search — Excludes Inaccessible
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_excludes_inaccessible() {
    let app = TestApp::new().await;
    let (user_a, _) = create_test_user(&app.pool).await;
    let (user_b, _) = create_test_user(&app.pool).await;

    // Guild owned by user_a — user_b is NOT a member
    let guild_a = create_guild(&app.pool, user_a).await;
    let ch_a = create_channel(&app.pool, guild_a, "secret").await;
    insert_message(&app.pool, ch_a, user_a, "Starfruit secret message").await;

    // Guild owned by user_b
    let guild_b = create_guild(&app.pool, user_b).await;
    let ch_b = create_channel(&app.pool, guild_b, "public").await;
    insert_message(&app.pool, ch_b, user_b, "Starfruit public message").await;

    // user_b searches — should only see their own guild's messages
    let token_b = generate_access_token(&app.config, user_b);
    let req = global_search_request("q=starfruit", &token_b);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(
        json["total"], 1,
        "user_b should only see messages from their own guild"
    );
    assert_eq!(
        json["results"][0]["source"]["guild_id"],
        guild_b.to_string()
    );

    delete_guild(&app.pool, guild_a).await;
    delete_guild(&app.pool, guild_b).await;
    delete_user(&app.pool, user_a).await;
    delete_user(&app.pool, user_b).await;
}

// ============================================================================
// Global Search — Validation
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_validation() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let token = generate_access_token(&app.config, user_id);

    // Empty query
    let req = global_search_request("q=", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 400, "Empty q should return 400");

    // Single-char query (too short)
    let req = global_search_request("q=a", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 400, "Single-char q should return 400");

    // Invalid sort value
    let req = global_search_request("q=test&sort=invalid", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 400, "Invalid sort should return 400");

    // Invalid has value
    let req = global_search_request("q=test&has=invalid", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 400, "Invalid has should return 400");

    delete_user(&app.pool, user_id).await;
}

// ============================================================================
// Global Search — Pagination
// ============================================================================

#[tokio::test]
#[serial]
async fn test_global_search_pagination() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let guild_id = create_guild(&app.pool, user_id).await;
    let channel_id = create_channel(&app.pool, guild_id, "general").await;
    let token = generate_access_token(&app.config, user_id);

    // Insert 5 messages matching the query
    for i in 1..=5 {
        insert_message(
            &app.pool,
            channel_id,
            user_id,
            &format!("Lychee pagination message number {i}"),
        )
        .await;
    }

    // Request with limit=2, offset=0
    let req = global_search_request("q=lychee&limit=2&offset=0", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 5, "total should reflect all matching results");
    assert_eq!(json["limit"], 2);
    assert_eq!(json["offset"], 0);
    assert_eq!(
        json["results"].as_array().unwrap().len(),
        2,
        "Should return only 2 results"
    );

    // Request with limit=2, offset=3
    let req = global_search_request("q=lychee&limit=2&offset=3", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 5);
    assert_eq!(json["offset"], 3);
    assert_eq!(
        json["results"].as_array().unwrap().len(),
        2,
        "Should return 2 results at offset 3"
    );

    // Request with offset beyond total
    let req = global_search_request("q=lychee&limit=2&offset=10", &token);
    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), 200);

    let json = body_to_json(resp).await;
    assert_eq!(json["total"], 5);
    assert_eq!(
        json["results"].as_array().unwrap().len(),
        0,
        "Should return empty results when offset exceeds total"
    );

    delete_guild(&app.pool, guild_id).await;
    delete_user(&app.pool, user_id).await;
}
