-- Bot Ecosystem: Bot users, applications, and slash commands
-- Migration: 20260202204100

-- Add bot flags to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_owner_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Create index for efficient bot user queries
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot) WHERE is_bot = true;

-- Bot applications table
-- Represents a bot application that can be invited to guilds
CREATE TABLE IF NOT EXISTS bot_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
    bot_user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT,  -- Argon2id hash of the bot token
    public BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for bot_applications
CREATE INDEX IF NOT EXISTS idx_bot_applications_owner ON bot_applications(owner_id);
CREATE INDEX IF NOT EXISTS idx_bot_applications_bot_user ON bot_applications(bot_user_id);

-- Slash commands table
-- Commands can be guild-specific or global (guild_id = NULL)
CREATE TABLE IF NOT EXISTS slash_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
    guild_id UUID REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 32),
    description TEXT NOT NULL CHECK (char_length(description) >= 1 AND char_length(description) <= 100),
    options JSONB,  -- Command parameters/options as JSON
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id, guild_id, name)
);

-- Indexes for slash_commands
CREATE INDEX IF NOT EXISTS idx_slash_commands_application ON slash_commands(application_id);
CREATE INDEX IF NOT EXISTS idx_slash_commands_guild ON slash_commands(guild_id) WHERE guild_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slash_commands_global ON slash_commands(application_id) WHERE guild_id IS NULL;

-- Guild bot installations tracking
-- Tracks which bots are installed in which guilds
CREATE TABLE IF NOT EXISTS guild_bot_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
    installed_by UUID NOT NULL REFERENCES users(id),
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(guild_id, application_id)
);

-- Indexes for guild_bot_installations
CREATE INDEX IF NOT EXISTS idx_guild_bot_installations_guild ON guild_bot_installations(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_bot_installations_application ON guild_bot_installations(application_id);

-- Add constraint to ensure bot_owner_id is only set for bot users
ALTER TABLE users ADD CONSTRAINT check_bot_owner_for_bots
    CHECK ((is_bot = true AND bot_owner_id IS NOT NULL) OR (is_bot = false AND bot_owner_id IS NULL));

-- Add comment documentation
COMMENT ON COLUMN users.is_bot IS 'Whether this user account is a bot';
COMMENT ON COLUMN users.bot_owner_id IS 'The user who owns this bot (only set for bot users)';
COMMENT ON TABLE bot_applications IS 'Bot applications that can be invited to guilds';
COMMENT ON TABLE slash_commands IS 'Slash commands registered by bot applications';
COMMENT ON TABLE guild_bot_installations IS 'Tracking which bots are installed in which guilds';
