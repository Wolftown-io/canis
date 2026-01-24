-- Cross-server favorites: two normalized tables + cleanup trigger
-- Design doc: docs/plans/2026-01-24-cross-server-favorites-design.md

-- Guild ordering (one row per guild in favorites)
CREATE TABLE user_favorite_guilds (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX idx_user_fav_guilds ON user_favorite_guilds(user_id, position);

-- Channel favorites (position within guild)
CREATE TABLE user_favorite_channels (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    guild_id UUID NOT NULL,  -- Denormalized for query efficiency
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id),
    FOREIGN KEY (user_id, guild_id) REFERENCES user_favorite_guilds(user_id, guild_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_fav_channels ON user_favorite_channels(user_id, guild_id, position);

-- Auto-cleanup: Remove guild entry when last channel is unfavorited
CREATE OR REPLACE FUNCTION cleanup_empty_favorite_guilds()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM user_favorite_guilds
    WHERE user_id = OLD.user_id
      AND guild_id = OLD.guild_id
      AND NOT EXISTS (
          SELECT 1 FROM user_favorite_channels
          WHERE user_id = OLD.user_id AND guild_id = OLD.guild_id
      );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_favorite_guilds
AFTER DELETE ON user_favorite_channels
FOR EACH ROW
EXECUTE FUNCTION cleanup_empty_favorite_guilds();

COMMENT ON TABLE user_favorite_guilds IS 'Guild ordering for favorites section. One row per guild that has favorited channels.';
COMMENT ON TABLE user_favorite_channels IS 'User channel favorites. Max 25 per user enforced in API.';
