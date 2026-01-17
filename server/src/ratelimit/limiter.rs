//! Core rate limiter service using Redis.

use fred::prelude::*;
use std::sync::Arc;
use tracing::{debug, warn};

use crate::ratelimit::{
    LimitConfig, RateLimitCategory, RateLimitConfig, RateLimitError, RateLimitResult,
};

/// Embedded Lua script for atomic rate limit check and increment.
const RATE_LIMIT_SCRIPT: &str = include_str!("rate_limit.lua");

/// Core rate limiter service backed by Redis.
///
/// Provides atomic rate limit checks using Lua scripts for correctness,
/// IP blocking for failed authentication, and allowlist bypassing.
#[derive(Clone)]
pub struct RateLimiter {
    redis: RedisClient,
    config: Arc<RateLimitConfig>,
    script_sha: String,
}

impl RateLimiter {
    /// Creates a new rate limiter instance.
    ///
    /// Call `init()` after creation to load the Lua script into Redis.
    pub fn new(redis: RedisClient, config: RateLimitConfig) -> Self {
        Self {
            redis,
            config: Arc::new(config),
            script_sha: String::new(),
        }
    }

    /// Initializes the rate limiter by loading the Lua script into Redis.
    ///
    /// Must be called before using `check()`.
    pub async fn init(&mut self) -> Result<(), RedisError> {
        let sha: String = self.redis.script_load(RATE_LIMIT_SCRIPT).await?;
        debug!(script_sha = %sha, "Rate limit Lua script loaded");
        self.script_sha = sha;
        Ok(())
    }

    /// Checks and increments the rate limit for a given category and identifier.
    ///
    /// Returns `Ok(RateLimitResult)` with `allowed: true` if the request is permitted,
    /// or `allowed: false` with retry information if the limit is exceeded.
    ///
    /// # Arguments
    /// * `category` - The rate limit category (e.g., `AuthLogin`, `Read`, `Write`)
    /// * `identifier` - The client identifier (typically normalized IP address)
    ///
    /// # Errors
    /// Returns `RateLimitError::RedisUnavailable` if Redis is unreachable.
    #[tracing::instrument(skip(self), fields(category = %category.as_str()))]
    pub async fn check(
        &self,
        category: RateLimitCategory,
        identifier: &str,
    ) -> Result<RateLimitResult, RateLimitError> {
        // Skip rate limiting if disabled
        if !self.config.enabled {
            return Ok(RateLimitResult {
                allowed: true,
                limit: 0,
                remaining: 0,
                reset_at: 0,
                retry_after: 0,
            });
        }

        // Skip rate limiting for allowlisted IPs
        if self.is_allowed_by_config(identifier) {
            debug!(ip = %identifier, "IP in allowlist, bypassing rate limit");
            return Ok(RateLimitResult {
                allowed: true,
                limit: 0,
                remaining: 0,
                reset_at: 0,
                retry_after: 0,
            });
        }

        let limit_config = self.get_limit_config(category);
        let key = self.build_key(category.as_str(), identifier);

        // Execute Lua script atomically
        let result: Vec<i64> = self
            .redis
            .evalsha(
                &self.script_sha,
                vec![key.as_str()],
                vec![
                    limit_config.window_secs.to_string(),
                    limit_config.requests.to_string(),
                ],
            )
            .await
            .map_err(|e| {
                warn!(error = %e, "Redis rate limit check failed");
                RateLimitError::RedisUnavailable
            })?;

        let count = result[0] as u32;
        let allowed = result[1] == 1;
        let ttl = result[2].max(0) as u64;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Ok(RateLimitResult {
            allowed,
            limit: limit_config.requests,
            remaining: if allowed {
                limit_config.requests.saturating_sub(count)
            } else {
                0
            },
            reset_at: now + ttl,
            retry_after: if allowed { 0 } else { ttl },
        })
    }

    /// Checks if the identifier is in the allowlist configuration.
    pub fn is_allowed_by_config(&self, identifier: &str) -> bool {
        self.config.allowlist.contains(identifier)
    }

    /// Records a failed authentication attempt for the given IP.
    ///
    /// Increments the failure counter and blocks the IP if the threshold is exceeded.
    ///
    /// # Returns
    /// * `Ok(true)` if the IP is now blocked after this failure
    /// * `Ok(false)` if the IP is not yet blocked
    ///
    /// # Errors
    /// Returns `RateLimitError::RedisUnavailable` if Redis is unreachable.
    #[tracing::instrument(skip(self))]
    pub async fn record_failed_auth(&self, ip: &str) -> Result<bool, RateLimitError> {
        if !self.config.enabled {
            return Ok(false);
        }

        if self.is_allowed_by_config(ip) {
            return Ok(false);
        }

        let key = self.build_key("failed_auth", ip);
        let config = &self.config.limits.failed_auth;

        // Increment failure counter
        let count: i64 = self.redis.incr(&key).await.map_err(|e| {
            warn!(error = %e, "Failed to increment auth failure counter");
            RateLimitError::RedisUnavailable
        })?;

        // Set expiry on first failure
        if count == 1 {
            if let Err(e) = self.redis.expire::<(), _>(&key, config.window_secs as i64).await {
                warn!(error = %e, "Failed to set expiry on failure counter");
            }
        }

        // Check if threshold exceeded
        if count >= i64::from(config.max_failures) {
            let block_key = self.build_key("blocked", ip);

            // Block the IP
            if let Err(e) = self
                .redis
                .set::<(), _, _>(
                    &block_key,
                    "1",
                    Some(Expiration::EX(config.block_duration_secs as i64)),
                    None,
                    false,
                )
                .await
            {
                warn!(error = %e, "Failed to set IP block");
            }

            warn!(
                ip = %ip,
                failures = count,
                block_duration = config.block_duration_secs,
                "IP blocked due to repeated auth failures"
            );
            return Ok(true);
        }

        debug!(
            ip = %ip,
            failures = count,
            max_failures = config.max_failures,
            "Auth failure recorded"
        );
        Ok(false)
    }

    /// Checks if the given IP address is currently blocked.
    ///
    /// # Returns
    /// * `Ok(true)` if the IP is blocked
    /// * `Ok(false)` if the IP is not blocked
    ///
    /// # Errors
    /// Returns `RateLimitError::RedisUnavailable` if Redis is unreachable.
    #[tracing::instrument(skip(self))]
    pub async fn is_blocked(&self, ip: &str) -> Result<bool, RateLimitError> {
        if !self.config.enabled {
            return Ok(false);
        }

        if self.is_allowed_by_config(ip) {
            return Ok(false);
        }

        let key = self.build_key("blocked", ip);
        let exists: bool = self.redis.exists(&key).await.map_err(|e| {
            warn!(error = %e, "Failed to check IP block status");
            RateLimitError::RedisUnavailable
        })?;

        if exists {
            debug!(ip = %ip, "IP is blocked");
        }

        Ok(exists)
    }

    /// Returns the remaining block time in seconds for a blocked IP.
    ///
    /// Returns `None` if the IP is not blocked or Redis is unavailable.
    #[tracing::instrument(skip(self))]
    pub async fn get_block_ttl(&self, ip: &str) -> Option<u64> {
        if !self.config.enabled {
            return None;
        }

        let key = self.build_key("blocked", ip);
        let ttl: i64 = self.redis.ttl(&key).await.ok()?;

        if ttl > 0 {
            Some(ttl as u64)
        } else {
            None
        }
    }

    /// Clears the failed auth counter and block for an IP.
    ///
    /// Useful when a user successfully authenticates to reset their failure count.
    #[tracing::instrument(skip(self))]
    pub async fn clear_failed_auth(&self, ip: &str) -> Result<(), RateLimitError> {
        let failed_key = self.build_key("failed_auth", ip);
        let block_key = self.build_key("blocked", ip);

        // Delete both keys (ignoring errors for individual deletes)
        let _ = self.redis.del::<(), _>(&failed_key).await;
        let _ = self.redis.del::<(), _>(&block_key).await;

        debug!(ip = %ip, "Cleared failed auth state");
        Ok(())
    }

    /// Returns the configuration for this rate limiter.
    pub fn config(&self) -> &RateLimitConfig {
        &self.config
    }

    /// Builds a Redis key with the configured prefix.
    fn build_key(&self, category: &str, identifier: &str) -> String {
        format!("{}:{}:{}", self.config.redis_key_prefix, category, identifier)
    }

    /// Returns the limit configuration for a given category.
    fn get_limit_config(&self, category: RateLimitCategory) -> &LimitConfig {
        match category {
            RateLimitCategory::AuthLogin => &self.config.limits.auth_login,
            RateLimitCategory::AuthRegister => &self.config.limits.auth_register,
            RateLimitCategory::AuthPasswordReset => &self.config.limits.auth_password_reset,
            RateLimitCategory::AuthOther => &self.config.limits.auth_other,
            RateLimitCategory::Write => &self.config.limits.write,
            RateLimitCategory::Social => &self.config.limits.social,
            RateLimitCategory::Read => &self.config.limits.read,
            RateLimitCategory::WsConnect => &self.config.limits.ws_connect,
            RateLimitCategory::WsMessage => &self.config.limits.ws_message,
            RateLimitCategory::FailedAuth => {
                // Return a pseudo-config for FailedAuth using the window_secs
                // This category is handled specially by record_failed_auth
                static FAILED_AUTH_LIMIT: LimitConfig = LimitConfig {
                    requests: 10,
                    window_secs: 300,
                };
                &FAILED_AUTH_LIMIT
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn mock_config() -> RateLimitConfig {
        RateLimitConfig {
            enabled: true,
            redis_key_prefix: "test:rl".to_string(),
            fail_open: true,
            trust_proxy: false,
            allowlist: HashSet::from(["127.0.0.1".to_string()]),
            ..Default::default()
        }
    }

    #[test]
    fn test_build_key() {
        let config = mock_config();
        // Create a mock limiter without Redis for key building tests
        let limiter = RateLimiter {
            redis: create_mock_client(),
            config: Arc::new(config),
            script_sha: String::new(),
        };

        let key = limiter.build_key("auth_login", "192.168.1.1");
        assert_eq!(key, "test:rl:auth_login:192.168.1.1");
    }

    #[test]
    fn test_is_allowed_by_config() {
        let config = mock_config();
        let limiter = RateLimiter {
            redis: create_mock_client(),
            config: Arc::new(config),
            script_sha: String::new(),
        };

        assert!(limiter.is_allowed_by_config("127.0.0.1"));
        assert!(!limiter.is_allowed_by_config("192.168.1.1"));
    }

    #[test]
    fn test_get_limit_config() {
        let config = mock_config();
        let limiter = RateLimiter {
            redis: create_mock_client(),
            config: Arc::new(config),
            script_sha: String::new(),
        };

        let auth_login = limiter.get_limit_config(RateLimitCategory::AuthLogin);
        assert_eq!(auth_login.requests, 3);
        assert_eq!(auth_login.window_secs, 60);

        let read = limiter.get_limit_config(RateLimitCategory::Read);
        assert_eq!(read.requests, 200);
    }

    /// Helper to create a mock Redis client for tests that don't need actual Redis.
    fn create_mock_client() -> RedisClient {
        let config = RedisConfig::from_url("redis://localhost:6379").unwrap();
        RedisClient::new(config, None, None, None)
    }
}
