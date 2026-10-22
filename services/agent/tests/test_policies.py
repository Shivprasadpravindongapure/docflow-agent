from contextlib import contextmanager
from datetime import date

import pytest

from services.agent.app.policies import (
    EMBEDDING_DIMENSION,
    PolicySource,
    chunk_policy,
    ingest_policy,
    set_policy_status,
)


class FakeDB:
    def __init__(self):
        self.sources = {}
        self.chunks = []
        self.queries = []

    @contextmanager
    def transaction(self):
        yield

    def execute(self, query, params=()):
        self.queries.append((query, params))
        if "SELECT 1 FROM policy_sources" in query:
            exists = (params[0], params[1]) in self.sources
            return Result({"?column?": 1} if exists else None)
        if "SELECT content_sha256 FROM policy_sources" in query:
            key = (params[0], params[1])
            row = self.sources.get(key)
            return Result(row)
        if "SELECT count(*) AS count FROM policy_chunks" in query:
            count = sum(c[0] == params[0] and c[1] == params[1] for c in self.chunks)
            return Result({"count": count})
        if "INSERT INTO policy_sources" in query:
            self.sources[(params[0], params[1])] = {
                "content_sha256": params[9], "status": params[10]
            }
            return Result(rowcount=1)
        if "INSERT INTO policy_chunks" in query:
            self.chunks.append((params[0], params[1], params[2], params[3]))
            return Result(rowcount=1)
        if "UPDATE policy_sources SET status='superseded'" in query:
            for (source_id, version), row in self.sources.items():
                if source_id == params[0] and version != params[1] and row["status"] == "active":
                    row["status"] = "superseded"
            return Result(rowcount=1)
        if "UPDATE policy_sources SET status=%s" in query:
            row = self.sources.get((params[1], params[2]))
            if row:
                row["status"] = params[0]
            return Result(rowcount=1 if row else 0)
        raise AssertionError(f"Unexpected query: {query}")


class Result:
    def __init__(self, row=None, rowcount=0):
        self.row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self.row


def source(version="v1", text="Synthetic mark sheet policy. Required fields: candidate name and exam year."):
    return PolicySource(
        source_id="synthetic-admissions-marksheet",
        version=version,
        title="Synthetic admissions marksheet requirements",
        text=text,
        workflow="synthetic-admissions",
        document_type="marksheet",
        effective_from=date(2026, 1, 1),
    )


def test_chunking_is_deterministic_and_respects_limit():
    text = ("A sentence about a synthetic requirement. " * 75) + "\n\nSecond section."
    first = chunk_policy(text, max_chars=180)
    assert first == chunk_policy(text, max_chars=180)
    assert len(first) > 1
    assert all(0 < len(chunk) <= 180 for chunk in first)


def test_chunk_text_is_normalized_and_preserves_headings():
    chunks = chunk_policy("# Heading\r\n\r\nCafe\u0301 requirement.")
    assert chunks == ["# Heading\nCaf\u00e9 requirement."]


def test_ingestion_persists_and_reingestion_is_idempotent():
    db = FakeDB()
    calls = []

    def embed(chunks):
        calls.append(list(chunks))
        return [[0.125] * EMBEDDING_DIMENSION for _ in chunks]

    result = ingest_policy(db, source(), embedder=embed)
    assert result.unchanged is False
    assert result.chunk_count == 1
    assert len(db.chunks) == 1
    assert len(calls) == 1

    same = ingest_policy(db, source(), embedder=embed)
    assert same.unchanged is True
    assert same.chunk_count == 1
    assert len(calls) == 1


def test_same_version_with_changed_text_is_rejected():
    db = FakeDB()
    embed = lambda chunks: [[0.0] * EMBEDDING_DIMENSION for _ in chunks]
    ingest_policy(db, source(), embedder=embed)
    with pytest.raises(ValueError, match="use a new version"):
        ingest_policy(db, source(text="Changed synthetic requirements."), embedder=embed)


def test_new_version_supersedes_previous_active_version():
    db = FakeDB()
    embed = lambda chunks: [[0.0] * EMBEDDING_DIMENSION for _ in chunks]
    ingest_policy(db, source("v1"), embedder=embed)
    ingest_policy(db, source("v2", "Updated synthetic requirements."), embedder=embed)
    assert db.sources[("synthetic-admissions-marksheet", "v1")]["status"] == "superseded"
    assert db.sources[("synthetic-admissions-marksheet", "v2")]["status"] == "active"


def test_obsolete_status_is_explicit_and_preserves_source():
    db = FakeDB()
    embed = lambda chunks: [[0.0] * EMBEDDING_DIMENSION for _ in chunks]
    ingest_policy(db, source(), embedder=embed)
    assert set_policy_status(db, "synthetic-admissions-marksheet", "v1", "obsolete")
    assert db.sources[("synthetic-admissions-marksheet", "v1")]["status"] == "obsolete"
    assert not set_policy_status(db, "missing", "v1", "obsolete")
    assert db.sources[("synthetic-admissions-marksheet", "v1")]["status"] == "obsolete"


def test_malformed_source_and_embedding_fail_before_persisting():
    db = FakeDB()
    with pytest.raises(ValueError, match="must not be empty"):
        ingest_policy(db, source(text="  "), embedder=lambda chunks: [])
    with pytest.raises(ValueError, match="different number"):
        ingest_policy(db, source(), embedder=lambda chunks: [])
    with pytest.raises(RuntimeError, match="provider unavailable"):
        ingest_policy(
            db,
            source(),
            embedder=lambda chunks: (_ for _ in ()).throw(RuntimeError("provider unavailable")),
        )
    assert not db.sources
    assert not db.chunks


def test_invalid_embedding_dimension_and_non_finite_values_are_rejected():
    db = FakeDB()
    with pytest.raises(ValueError, match="exactly 3072"):
        ingest_policy(db, source(), embedder=lambda chunks: [[1.0, 2.0]])
    with pytest.raises(ValueError, match="finite"):
        ingest_policy(db, source(), embedder=lambda chunks: [[float("nan")] * EMBEDDING_DIMENSION])
    assert not db.sources


def test_authoritative_policy_ingestion_is_not_enabled_yet():
    db = FakeDB()
    external = PolicySource(
        source_id="future-external-policy", version="v1", title="Unapproved",
        text="This source is not authorized for the synthetic-only corpus.",
        workflow="synthetic-admissions", document_type="marksheet", source_kind="authoritative",
    )
    with pytest.raises(ValueError, match="Only explicitly synthetic"):
        ingest_policy(db, external, embedder=lambda chunks: [])
    assert not db.sources

