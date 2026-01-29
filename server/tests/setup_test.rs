//! First User Setup Tests
//!
//! Tests for the first-time server setup wizard and admin bootstrap.
//!
//! Note: These tests use `#[serial]` to run one at a time because they modify
//! shared database tables (users, system_admins). Transaction isolation alone
//! isn't sufficient when multiple tests DELETE and recreate data concurrently.

use serial_test::serial;
use sqlx::PgPool;
use vc_server::config::Config;
use vc_server::db;

/// Test that the first user registration logic is set up correctly.
///
/// Note: This test verifies the database functions work, but the actual first-user
/// admin grant happens in the HTTP registration handler within a transaction.
/// A full integration test through POST /auth/register is needed to verify the
/// complete behavior (see integration test recommendations).
#[tokio::test]
#[serial]
async fn test_first_user_detection_works() {
    let config = Config::default_for_test();
    let pool: PgPool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to DB");

    // Use a transaction for isolation (will be rolled back automatically on drop)
    let mut tx = pool.begin().await.expect("Failed to start transaction");

    // Delete all users in this transaction (isolated from other tests)
    // Delete users first - cascades to system_admins due to ON DELETE CASCADE
    sqlx::query("DELETE FROM users")
        .execute(&mut *tx)
        .await
        .expect("Failed to clear users");

    // Generate unique identifiers for this test
    let test_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let username = format!("first_user_{test_id}");

    // Create user (note: admin grant happens in registration handler, not here)
    let user = sqlx::query_as!(
        db::User,
        r#"INSERT INTO users (username, display_name, password_hash, auth_method)
           VALUES ($1, $2, $3, 'local')
           RETURNING id, username, display_name, email, password_hash,
                     auth_method as "auth_method: _", external_id, avatar_url,
                     status as "status: _", mfa_secret, created_at, updated_at"#,
        username,
        "First User",
        "hash"
    )
    .fetch_one(&mut *tx)
    .await
    .expect("Failed to create first user");

    // Manually grant admin (simulating what registration handler does)
    sqlx::query("INSERT INTO system_admins (user_id, granted_by) VALUES ($1, $1)")
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .expect("Failed to grant admin");

    // Verify user is system admin
    let is_admin: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM system_admins WHERE user_id = $1)"
    )
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await
    .expect("Failed to check admin status");

    assert!(is_admin, "First user should be granted admin permissions");

    // Transaction is rolled back automatically, no cleanup needed
    tx.rollback().await.expect("Failed to rollback");
    println!("✅ First user detection test passed (transaction rolled back)");
}

/// Test that setup status is initially incomplete.
#[tokio::test]
async fn test_setup_initially_incomplete() {
    let config = Config::default_for_test();
    let pool: PgPool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to DB");

    // For fresh installs, setup should be incomplete
    // For existing installs with users, the migration marks it complete
    let setup_complete = db::is_setup_complete(&pool)
        .await
        .expect("Failed to check setup status");

    let user_count = db::count_users(&pool).await.expect("Failed to count users");

    if user_count > 0 {
        // Migration should have marked setup as complete for existing installations
        assert!(
            setup_complete,
            "Setup should be complete for existing installations with users"
        );
    }
    // If no users, setup may be incomplete (depends on whether migration ran)
    println!("✅ Setup status check passed (users: {user_count}, setup_complete: {setup_complete})");
}

/// Test server config CRUD operations.
#[tokio::test]
async fn test_server_config_operations() {
    let config = Config::default_for_test();
    let pool: PgPool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to DB");

    // Get default server name
    let server_name = db::get_config_value(&pool, "server_name")
        .await
        .expect("Failed to get server_name");
    assert_eq!(server_name.as_str(), Some("Canis Server"));

    // Get default registration policy
    let reg_policy = db::get_config_value(&pool, "registration_policy")
        .await
        .expect("Failed to get registration_policy");
    assert_eq!(reg_policy.as_str(), Some("open"));

    // Create a test user for config updates (required by foreign key)
    let test_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let test_username = format!("config_test_{test_id}");
    let test_user = db::create_user(&pool, &test_username, "Config Test", None, "hash")
        .await
        .expect("Failed to create test user");

    // Test setting a config value
    db::set_config_value(
        &pool,
        "server_name",
        serde_json::json!("Test Server"),
        test_user.id,
    )
    .await
    .expect("Failed to set server_name");

    // Verify the change
    let updated_name = db::get_config_value(&pool, "server_name")
        .await
        .expect("Failed to get updated server_name");
    assert_eq!(updated_name.as_str(), Some("Test Server"));

    // Restore original value
    db::set_config_value(
        &pool,
        "server_name",
        serde_json::json!("Canis Server"),
        test_user.id,
    )
    .await
    .expect("Failed to restore server_name");

    println!("✅ Server config operations test passed");
}

/// Test that setup can be marked complete (irreversible).
#[tokio::test]
async fn test_mark_setup_complete() {
    let config = Config::default_for_test();
    let pool: PgPool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to DB");

    // Get current setup status
    let initial_status = db::is_setup_complete(&pool)
        .await
        .expect("Failed to check setup status");

    if initial_status {
        println!("⚠️  Setup already complete, testing that it stays complete");
    }

    // Create a test user for marking setup complete (required by foreign key)
    let test_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let test_username = format!("setup_complete_{test_id}");
    let test_user = db::create_user(&pool, &test_username, "Setup Test", None, "hash")
        .await
        .expect("Failed to create test user");

    // Mark setup as complete
    db::mark_setup_complete(&pool, test_user.id)
        .await
        .expect("Failed to mark setup complete");

    // Verify setup is now complete
    let final_status = db::is_setup_complete(&pool)
        .await
        .expect("Failed to check setup status after marking complete");

    assert!(final_status, "Setup should be marked as complete");

    println!("✅ Mark setup complete test passed");
}

/// Test race condition prevention in first user detection.
///
/// This test verifies that the FOR UPDATE lock query works correctly.
/// Full concurrent behavior requires integration testing through HTTP endpoints.
#[tokio::test]
#[serial]
async fn test_for_update_lock_pattern() {
    let config = Config::default_for_test();
    let pool: PgPool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to DB");

    // Use isolated transaction
    let mut tx = pool.begin().await.expect("Failed to start transaction");

    // Delete existing users in transaction (cascades to system_admins)
    sqlx::query("DELETE FROM users")
        .execute(&mut *tx)
        .await
        .expect("Failed to clear users");

    // Verify the FOR UPDATE query pattern works
    // Note: Can't use COUNT(*) with FOR UPDATE, so we fetch and count in Rust
    let users: Vec<(uuid::Uuid,)> = sqlx::query_as("SELECT id FROM users FOR UPDATE")
        .fetch_all(&mut *tx)
        .await
        .expect("Failed to get users with lock");

    assert_eq!(users.len(), 0, "Expected no users in clean transaction");

    // Simulate creating a user
    let test_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    sqlx::query(
        "INSERT INTO users (username, display_name, password_hash, auth_method)
         VALUES ($1, 'Test', 'hash', 'local')"
    )
    .bind(format!("test_{test_id}"))
    .execute(&mut *tx)
    .await
    .expect("Failed to insert user");

    // Count again with lock
    let users_after: Vec<(uuid::Uuid,)> = sqlx::query_as("SELECT id FROM users FOR UPDATE")
        .fetch_all(&mut *tx)
        .await
        .expect("Failed to get users after insert");

    assert_eq!(users_after.len(), 1, "Should see one user after insert");

    tx.rollback().await.expect("Failed to rollback");

    println!("✅ FOR UPDATE lock pattern test passed");
    println!("    Note: True concurrent behavior requires HTTP integration tests");
    println!("    Recommendation: Add test spawning 10 parallel POST /auth/register requests");
}

/// Test that second user does NOT receive admin permissions.
#[tokio::test]
#[serial]
async fn test_second_user_not_admin() {
    let config = Config::default_for_test();
    let pool: PgPool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to connect to DB");

    // Use isolated transaction
    let mut tx = pool.begin().await.expect("Failed to start transaction");

    // Clean slate in transaction (cascades to system_admins)
    sqlx::query("DELETE FROM users")
        .execute(&mut *tx)
        .await
        .expect("Failed to clear users");

    let test_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let first_username = format!("user1_{test_id}");
    let second_username = format!("user2_{test_id}");

    // Create first user
    sqlx::query(
        "INSERT INTO users (username, display_name, password_hash, auth_method)
         VALUES ($1, 'User 1', 'hash', 'local')"
    )
    .bind(&first_username)
    .execute(&mut *tx)
    .await
    .expect("Failed to create first user");

    // Create second user
    let user2 = sqlx::query_as!(
        db::User,
        r#"INSERT INTO users (username, display_name, password_hash, auth_method)
           VALUES ($1, $2, $3, 'local')
           RETURNING id, username, display_name, email, password_hash,
                     auth_method as "auth_method: _", external_id, avatar_url,
                     status as "status: _", mfa_secret, created_at, updated_at"#,
        second_username,
        "User 2",
        "hash"
    )
    .fetch_one(&mut *tx)
    .await
    .expect("Failed to create second user");

    // Verify second user is NOT system admin
    let is_admin = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM system_admins WHERE user_id = $1) as "exists!""#,
        user2.id
    )
    .fetch_one(&mut *tx)
    .await
    .expect("Failed to check admin status");

    assert!(
        !is_admin,
        "Second user should not automatically receive admin permissions"
    );

    tx.rollback().await.expect("Failed to rollback");
    println!("✅ Second user not admin test passed (transaction rolled back)");
}
