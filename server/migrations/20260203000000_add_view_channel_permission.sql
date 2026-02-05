-- Add VIEW_CHANNEL permission to existing roles (backward compatibility)
--
-- This migration adds the VIEW_CHANNEL permission (bit 24) to all existing guild roles.
-- This ensures backward compatibility - existing guilds continue to function as before,
-- with all roles able to see all channels. Guild admins can then opt-in to restricting
-- channel visibility by removing VIEW_CHANNEL from specific roles or using channel overrides.
--
-- The VIEW_CHANNEL permission controls whether a user can:
-- - See a channel in the channel list
-- - Read message history
-- - Send messages (in combination with SEND_MESSAGES permission)
-- - Perform any other channel operations
--
-- Security Note: This migration is idempotent (uses bitwise OR) and can be run multiple times safely.

-- Add VIEW_CHANNEL (bit 24 = 1 << 24 = 16777216) to all guild roles
UPDATE guild_roles
SET permissions = permissions | (1::bigint << 24);

-- Note: All guild_roles receive VIEW_CHANNEL for backward compatibility
-- Guild admins can then opt-in to restricting channel visibility by:
-- 1. Removing VIEW_CHANNEL from specific roles
-- 2. Using channel-specific permission overrides

-- Migration Notes:
-- - Updates guild_roles table (not the system-level roles table)
-- - To rollback: UPDATE guild_roles SET permissions = permissions & ~(1::bigint << 24)
-- - Expected execution time: <1 second for 1000 guilds
-- - No data loss occurs if this migration is rolled back
