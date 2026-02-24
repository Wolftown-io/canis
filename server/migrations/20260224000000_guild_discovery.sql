-- Guild Discovery: add columns for public guild browsing and full-text search

ALTER TABLE guilds ADD COLUMN discoverable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guilds ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE guilds ADD COLUMN banner_url TEXT;
ALTER TABLE guilds ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

-- Index for browsing discoverable guilds (newest first, excludes suspended)
CREATE INDEX idx_guilds_discoverable ON guilds (created_at DESC)
  WHERE discoverable = true AND suspended_at IS NULL;

-- GIN index for full-text search on name + description
CREATE INDEX idx_guilds_search_vector ON guilds USING gin (search_vector);

-- GIN index for tag-based filtering
CREATE INDEX idx_guilds_tags ON guilds USING gin (tags) WHERE discoverable = true;
