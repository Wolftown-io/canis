-- Add custom_status JSONB column to users table.
-- Structure: {"text": "...", "emoji": "...", "expires_at": "2026-..."}
ALTER TABLE users ADD COLUMN custom_status JSONB;

-- Partial index for periodic expiry sweep queries.
CREATE INDEX idx_users_custom_status_expires_at
  ON users ((custom_status->>'expires_at'))
  WHERE custom_status IS NOT NULL
    AND custom_status->>'expires_at' IS NOT NULL;
