-- Add threads_enabled setting to guilds table
ALTER TABLE guilds ADD COLUMN threads_enabled BOOLEAN NOT NULL DEFAULT true;
