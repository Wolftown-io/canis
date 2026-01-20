-- Add feature flags column to users table
-- Bit 0: PREMIUM_VIDEO (1080p60 screen sharing)
-- Future bits reserved for additional premium features

ALTER TABLE users ADD COLUMN feature_flags BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.feature_flags IS 'User-level feature flags. Bit 0: PREMIUM_VIDEO';
