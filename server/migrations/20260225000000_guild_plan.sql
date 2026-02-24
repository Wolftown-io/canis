-- Add plan column to guilds for future tier/boost system
ALTER TABLE guilds ADD COLUMN plan VARCHAR(32) NOT NULL DEFAULT 'free';
CREATE INDEX idx_guilds_plan ON guilds (plan);
