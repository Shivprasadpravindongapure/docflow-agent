CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS policy_sources (
    source_id TEXT NOT NULL,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('synthetic', 'authoritative')),
    workflow TEXT NOT NULL,
    document_type TEXT NOT NULL,
    jurisdiction TEXT,
    organization_id TEXT,
    source_uri TEXT,
    content_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'obsolete')),
    effective_from DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, version),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS policy_sources_lookup_idx
    ON policy_sources (workflow, document_type, jurisdiction, organization_id, status);

CREATE TABLE IF NOT EXISTS policy_chunks (
    source_id TEXT NOT NULL,
    version TEXT NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding public.vector(3072) NOT NULL,
    embedding_model TEXT NOT NULL CHECK (embedding_model = 'gemini-embedding-001'),
    embedding_dimension INTEGER NOT NULL CHECK (embedding_dimension = 3072),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, version, chunk_index),
    FOREIGN KEY (source_id, version)
        REFERENCES policy_sources (source_id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS policy_chunks_source_idx
    ON policy_chunks (source_id, version, chunk_index);
