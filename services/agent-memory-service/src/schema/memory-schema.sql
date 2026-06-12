CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(255),
    session_id VARCHAR(255),
    project VARCHAR(255),
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('SESSION', 'USER', 'TENANT')),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('PROMO', 'INCIDENT', 'NOTICE', 'PREFERENCE', 'FACT')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT memories_status_check CHECK (status IN ('PROPOSED', 'ACTIVE', 'REJECTED', 'ARCHIVED')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    topic_key VARCHAR(255),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('__FTS_LANGUAGE__', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('__FTS_LANGUAGE__', coalesce(content, '')), 'B')
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_topic_key ON memories(topic_key);
CREATE INDEX IF NOT EXISTS idx_memories_search_vector ON memories USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
