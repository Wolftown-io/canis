-- Security Improvements Migration
-- Migration: 20240102000000_security_improvements
-- Addresses CRITICAL, HIGH, and unbounded field security issues

-- ============================================================================
-- PRIORITY 1: CRITICAL Security Fixes
-- ============================================================================

-- 1. Constraint: Encrypted messages MUST have a nonce
ALTER TABLE messages
ADD CONSTRAINT encrypted_requires_nonce CHECK (
    encrypted = FALSE OR nonce IS NOT NULL
);

-- Note: MFA secrets and Megolm session data should be encrypted at application layer
-- before storage. This migration does not modify existing data, but application code
-- must be updated to:
-- 1. Encrypt mfa_secret before INSERT/UPDATE in users table
-- 2. Encrypt session_data before INSERT/UPDATE in megolm_sessions table
-- 3. Decrypt when reading these fields

-- ============================================================================
-- PRIORITY 2: Performance & Security Indexes
-- ============================================================================

-- 2. Add index on session token_hash (CRITICAL for auth performance & DoS prevention)
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);

-- 3. Add index on deleted messages for filtering
CREATE INDEX idx_messages_deleted ON messages(deleted_at) WHERE deleted_at IS NOT NULL;

-- 4. Add index on user_roles role_id for "users with role X" queries
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- ============================================================================
-- PRIORITY 3: Unbounded Field Constraints
-- ============================================================================

-- 5. Increase password_hash field size for modern Argon2id hashes
ALTER TABLE users ALTER COLUMN password_hash TYPE VARCHAR(512);

-- 6. Limit user_agent field size to prevent DoS
ALTER TABLE sessions ALTER COLUMN user_agent TYPE VARCHAR(512);

-- 7. Add message content length constraint (4000 chars, ~1000 words)
ALTER TABLE messages
ADD CONSTRAINT message_length CHECK (LENGTH(content) <= 4000);

-- 8. Add file size validation (positive and <= 100MB)
ALTER TABLE file_attachments
ADD CONSTRAINT valid_file_size CHECK (size_bytes > 0 AND size_bytes <= 104857600);

-- 9. Increase S3 key field to match AWS limit (1024 bytes)
ALTER TABLE file_attachments ALTER COLUMN s3_key TYPE VARCHAR(1024);

-- ============================================================================
-- Additional Security Constraints
-- ============================================================================

-- 10. Add email format validation
ALTER TABLE users
ADD CONSTRAINT email_format CHECK (
    email IS NULL OR
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);

-- 11. Ensure email uniqueness only for non-NULL values
DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_email_unique ON users(email) WHERE email IS NOT NULL;

-- 12. Add role color format validation (hex color)
ALTER TABLE roles
ADD CONSTRAINT valid_color CHECK (
    color IS NULL OR
    color ~ '^#[0-9A-Fa-f]{6}$'
);

-- 13. Add position value constraints (non-negative)
ALTER TABLE channels
ADD CONSTRAINT valid_position CHECK (position >= 0);

ALTER TABLE roles
ADD CONSTRAINT valid_role_position CHECK (position >= 0);

ALTER TABLE channel_categories
ADD CONSTRAINT valid_category_position CHECK (position >= 0);

-- 14. Add session expiration validation
ALTER TABLE sessions
ADD CONSTRAINT valid_expiration CHECK (expires_at > created_at);

-- 15. Add voice channel user limit validation (already exists but ensure it's correct)
-- Already handled by existing constraint: voice_channel_limit

-- ============================================================================
-- Comments for Application-Layer Enforcement
-- ============================================================================

-- IMPORTANT: The following must be enforced in application code:
--
-- 1. MFA Secret Encryption (users.mfa_secret):
--    - Encrypt with server-side key before INSERT/UPDATE
--    - Decrypt when reading
--    - Consider using envelope encryption with per-user keys
--
-- 2. Megolm Session Data Encryption (megolm_sessions.session_data):
--    - Encrypt with channel-specific key before storage
--    - Decrypt when loading session
--    - Rotate keys periodically
--
-- 3. One-Time Keys Array Limit (user_keys.one_time_keys):
--    - Enforce max 100 keys per user at application layer
--    - Prune old keys automatically
--
-- 4. MIME Type Whitelist (file_attachments.mime_type):
--    - Validate against allowed types before INSERT
--    - Reject dangerous types (.exe, .js, etc.)
--
-- 5. Deleted Messages Content Removal:
--    - Set content to empty string when deleted_at is set
--    - Or implement hard delete for GDPR compliance
--
-- 6. User Agent Truncation:
--    - Truncate to 512 chars before INSERT to prevent errors
