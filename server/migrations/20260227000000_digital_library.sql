-- Digital Library: revision history, page categories, per-guild limits

-- Page revisions: full content snapshots for version history
CREATE TABLE page_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    revision_number INT NOT NULL,
    content TEXT,
    content_hash VARCHAR(64),
    title VARCHAR(100),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_page_revision UNIQUE (page_id, revision_number)
);

CREATE INDEX idx_page_revisions_page_number ON page_revisions(page_id, revision_number DESC);
CREATE INDEX idx_page_revisions_page_created ON page_revisions(page_id, created_at DESC);

-- Page categories: guild-scoped groupings
CREATE TABLE page_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_page_categories_guild_name ON page_categories(guild_id, LOWER(name));
CREATE INDEX idx_page_categories_guild_position ON page_categories(guild_id, position);

-- Add category_id to pages (guild pages only; ON DELETE SET NULL makes pages uncategorized)
ALTER TABLE pages ADD COLUMN category_id UUID REFERENCES page_categories(id) ON DELETE SET NULL;

-- Per-guild limit overrides (NULL = use instance default)
ALTER TABLE guilds ADD COLUMN max_pages INT;
ALTER TABLE guilds ADD COLUMN max_revisions INT;

-- Backfill: create revision #1 for all existing non-deleted pages
INSERT INTO page_revisions (page_id, revision_number, content, content_hash, title, created_by, created_at)
SELECT id, 1, content, content_hash, title, created_by, created_at
FROM pages
WHERE deleted_at IS NULL;
