-- Message reactions and guild custom emojis
-- Part of Task 4.1: Database Schema for Reactions and Custom Emojis

-- Message reactions
CREATE TABLE message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,  -- Unicode emoji or custom emoji ID
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user ON message_reactions(user_id);

-- Guild custom emojis
CREATE TABLE guild_emojis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(32) NOT NULL,
    image_url TEXT NOT NULL,
    animated BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(guild_id, name)
);

CREATE INDEX idx_emojis_guild ON guild_emojis(guild_id);

-- User emoji preferences (favorites)
CREATE TABLE user_emoji_favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, emoji)
);

-- User recent emojis
CREATE TABLE user_emoji_recents (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id, emoji)
);

CREATE INDEX idx_recents_user_time ON user_emoji_recents(user_id, used_at DESC);

COMMENT ON TABLE message_reactions IS 'Message reactions with unique constraint per user+message+emoji.';
COMMENT ON TABLE guild_emojis IS 'Guild custom emojis with unique names per guild.';
COMMENT ON TABLE user_emoji_favorites IS 'User favorite emojis for quick access.';
COMMENT ON TABLE user_emoji_recents IS 'Recently used emojis per user for quick access.';
