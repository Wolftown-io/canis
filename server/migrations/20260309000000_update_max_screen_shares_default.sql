-- Update default max_screen_shares from 1 to 6 for multi-stream support
ALTER TABLE channels ALTER COLUMN max_screen_shares SET DEFAULT 6;

-- Backfill existing channels that still have the old default of 1
UPDATE channels SET max_screen_shares = 6 WHERE max_screen_shares = 1;

COMMENT ON COLUMN channels.max_screen_shares IS 'Maximum concurrent screen shares in this channel (default 6, supports multi-stream)';
