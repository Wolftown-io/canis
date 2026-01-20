-- Add voice-specific settings to channels table
-- These settings apply to voice channels only

ALTER TABLE channels ADD COLUMN max_screen_shares INTEGER NOT NULL DEFAULT 1;

-- Add comment explaining the setting
COMMENT ON COLUMN channels.max_screen_shares IS 'Maximum concurrent screen shares in this channel (default 1)';
