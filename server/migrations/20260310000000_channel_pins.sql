-- Channel pins: per-channel pinned messages visible to all members
CREATE TABLE channel_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, message_id)
);

CREATE INDEX idx_channel_pins_channel ON channel_pins(channel_id, pinned_at DESC);

COMMENT ON TABLE channel_pins IS 'Per-channel pinned messages, max 50 per channel';

-- Add message_type to distinguish user vs system messages
ALTER TABLE messages ADD COLUMN message_type VARCHAR(10) NOT NULL DEFAULT 'user';
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
    CHECK (message_type IN ('user', 'system'));
