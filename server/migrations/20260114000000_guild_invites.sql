-- Guild Invites and Last Seen Migration
-- Adds invite system for guilds and last_seen tracking for users

-- ============================================================================
-- Guild Invites Table
-- ============================================================================

CREATE TABLE guild_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guild_invites_code ON guild_invites(code);
CREATE INDEX idx_guild_invites_guild ON guild_invites(guild_id);
CREATE INDEX idx_guild_invites_expires ON guild_invites(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- User Last Seen Tracking
-- ============================================================================

ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
CREATE INDEX idx_users_last_seen ON users(last_seen_at DESC NULLS LAST);
