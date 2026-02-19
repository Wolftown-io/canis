-- Webhooks & Bot Gateway Intents
--
-- Phase 5: Webhook delivery system and gateway intent filtering.

CREATE TYPE webhook_event_type AS ENUM (
    'message.created', 'member.joined', 'member.left', 'command.invoked'
);

CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
    url TEXT NOT NULL CHECK (char_length(url) >= 10 AND char_length(url) <= 2048),
    signing_secret TEXT NOT NULL,
    subscribed_events webhook_event_type[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true,
    description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type webhook_event_type NOT NULL,
    event_id UUID NOT NULL,
    response_status SMALLINT,
    success BOOLEAN NOT NULL DEFAULT false,
    attempt INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_dead_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type webhook_event_type NOT NULL,
    event_id UUID NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL,
    last_error TEXT,
    event_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_applications
    ADD COLUMN IF NOT EXISTS gateway_intents TEXT[] NOT NULL DEFAULT '{}';

-- Indexes
CREATE INDEX idx_webhooks_application ON webhooks(application_id);
CREATE INDEX idx_webhooks_active ON webhooks(application_id, active) WHERE active = true;
CREATE INDEX idx_webhook_delivery_log_webhook ON webhook_delivery_log(webhook_id, created_at DESC);
CREATE INDEX idx_webhook_delivery_log_created ON webhook_delivery_log(created_at);
CREATE INDEX idx_webhook_dead_letters_webhook ON webhook_dead_letters(webhook_id, created_at DESC);
