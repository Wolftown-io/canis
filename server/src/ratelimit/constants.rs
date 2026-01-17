//! Rate limiting constants.

/// Redis key pre-allocation size
pub const REDIS_KEY_CAPACITY: usize = 64;

/// IPv6 prefix segments for rate limiting (uses /64)
pub const IPV6_PREFIX_SEGMENTS: usize = 4;

/// Log sampling configuration
pub const LOG_SAMPLE_RATE: u32 = 10;
pub const LOG_SAMPLE_OFFSET: u32 = 1;

/// Lua script return codes
pub const SCRIPT_ALLOWED: i64 = 1;
pub const SCRIPT_DENIED: i64 = 0;

/// Redis TTL sentinel values
pub const TTL_NO_EXPIRY: i64 = -1;
pub const TTL_KEY_NOT_FOUND: i64 = -2;
