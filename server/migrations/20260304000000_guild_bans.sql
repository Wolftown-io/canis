-- Guild-scoped bans (complements global_bans with per-guild enforcement)
CREATE TABLE guild_bans (
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, user_id)
);

-- Partial index for efficient expiry checks (only rows with a set expiry)
CREATE INDEX idx_guild_bans_expires ON guild_bans(expires_at) WHERE expires_at IS NOT NULL;
