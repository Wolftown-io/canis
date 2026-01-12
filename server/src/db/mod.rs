//! Database Layer
//!
//! `PostgreSQL` and Redis connections.

mod models;
mod queries;

#[cfg(test)]
mod tests;

use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

pub use models::*;
pub use queries::*;

/// Create `PostgreSQL` connection pool.
pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await?;

    info!("Connected to PostgreSQL");
    Ok(pool)
}

/// Run database migrations.
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    info!("Database migrations completed");
    Ok(())
}

/// Create Redis client.
pub async fn create_redis_client(redis_url: &str) -> Result<fred::clients::RedisClient> {
    use fred::prelude::*;

    let config = RedisConfig::from_url(redis_url)?;
    let client = RedisClient::new(config, None, None, None);
    client.connect();
    client.wait_for_connect().await?;

    info!("Connected to Redis");
    Ok(client)
}
