"""Maintainer-side policy ingestion for the synthetic RAG foundation.

Ingested policy text is reference data only. This module does not evaluate an
applicant or make a verification decision.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Callable, Sequence

from google import genai
from google.genai import types
from psycopg.types.json import Jsonb

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSION = 3072
MAX_CHUNK_CHARS = 1600


@dataclass(frozen=True)
class PolicySource:
    source_id: str
    version: str
    title: str
    text: str
    workflow: str
    document_type: str
    source_kind: str = "synthetic"
    jurisdiction: str | None = None
    organization_id: str | None = None
    source_uri: str | None = None
    status: str = "active"
    effective_from: date | None = None
    effective_to: date | None = None


@dataclass(frozen=True)
class IngestionResult:
    source_id: str
    version: str
    chunk_count: int
    unchanged: bool


def _clean_text(text: str) -> str:
    cleaned = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    cleaned = "\n".join(line.rstrip() for line in cleaned.splitlines()).strip()
    if not cleaned:
        raise ValueError("Policy source text must not be empty.")
    return cleaned


def chunk_policy(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split at paragraph/sentence boundaries with deterministic hard limits."""
    if max_chars < 100:
        raise ValueError("max_chars must be at least 100.")
    normalized = _clean_text(text)
    paragraphs = re.split(r"\n\s*\n", normalized)
    pieces: list[str] = []
    for paragraph in paragraphs:
        paragraph = re.sub(r"\s+", " ", paragraph).strip()
        while len(paragraph) > max_chars:
            boundary = max(
                paragraph.rfind(". ", 0, max_chars),
                paragraph.rfind("; ", 0, max_chars),
                paragraph.rfind(" ", 0, max_chars),
            )
            if boundary < max_chars // 2:
                boundary = max_chars
            pieces.append(paragraph[:boundary].strip())
            paragraph = paragraph[boundary:].lstrip(" .;")
        if paragraph:
            pieces.append(paragraph)

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n{piece}" if current else piece
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks


def gemini_embed(chunks: Sequence[str], *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY must be configured to ingest policy embeddings.")
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=8_000))
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=list(chunks),
        config=types.EmbedContentConfig(
            task_type=task_type,
            output_dimensionality=EMBEDDING_DIMENSION,
        ),
    )
    return [list(item.values) for item in response.embeddings]


def _validate_source(source: PolicySource) -> str:
    required = {
        "source_id": source.source_id,
        "version": source.version,
        "title": source.title,
        "workflow": source.workflow,
        "document_type": source.document_type,
    }
    if any(not isinstance(value, str) or not value.strip() for value in required.values()):
        raise ValueError("Policy source identifiers and context fields must be non-empty strings.")
    if source.source_kind != "synthetic":
        raise ValueError("Only explicitly synthetic policy content is enabled in this stage.")
    if source.status not in {"active", "obsolete"}:
        raise ValueError("New policy source status must be 'active' or 'obsolete'.")
    if source.effective_from and source.effective_to and source.effective_to < source.effective_from:
        raise ValueError("effective_to must not precede effective_from.")
    return _clean_text(source.text)


def _vector_literal(values: Sequence[float]) -> str:
    if len(values) != EMBEDDING_DIMENSION:
        raise ValueError(f"Embedding must contain exactly {EMBEDDING_DIMENSION} values.")
    normalized: list[str] = []
    for value in values:
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Embedding values must all be finite numbers.")
        normalized.append(format(number, ".9g"))
    return "[" + ",".join(normalized) + "]"


def _section_heading(chunk: str) -> str | None:
    for line in chunk.splitlines():
        match = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        if match:
            return match.group(1).strip()[:200]
    return None


def ingest_policy(
    db,
    source: PolicySource,
    *,
    embedder: Callable[[Sequence[str]], list[list[float]]] = gemini_embed,
) -> IngestionResult:
    """Persist a versioned policy and its embeddings atomically and idempotently."""
    text = _validate_source(source)
    source_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    chunks = chunk_policy(text)

    existing = db.execute(
        "SELECT content_sha256 FROM policy_sources WHERE source_id=%s AND version=%s",
        (source.source_id, source.version),
    ).fetchone()
    if existing:
        if existing["content_sha256"] != source_hash:
            raise ValueError("This policy source version already exists with different content; use a new version.")
        count = db.execute(
            "SELECT count(*) AS count FROM policy_chunks WHERE source_id=%s AND version=%s",
            (source.source_id, source.version),
        ).fetchone()["count"]
        return IngestionResult(source.source_id, source.version, count, True)

    embeddings = embedder(chunks)
    if len(embeddings) != len(chunks):
        raise ValueError("Embedding provider returned a different number of vectors than policy chunks.")
    vectors = [_vector_literal(vector) for vector in embeddings]

    with db.transaction():
        db.execute(
            """INSERT INTO policy_sources(
                source_id,version,title,source_kind,workflow,document_type,jurisdiction,
                organization_id,source_uri,content_sha256,status,effective_from,effective_to
            ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                source.source_id, source.version, source.title, source.source_kind,
                source.workflow, source.document_type, source.jurisdiction,
                source.organization_id, source.source_uri, source_hash, source.status,
                source.effective_from, source.effective_to,
            ),
        )
        for index, (chunk, vector) in enumerate(zip(chunks, vectors)):
            db.execute(
                """INSERT INTO policy_chunks(
                    source_id,version,chunk_index,content,content_sha256,metadata_json,
                    embedding,embedding_model,embedding_dimension
                ) VALUES(%s,%s,%s,%s,%s,%s,%s::public.vector,%s,%s)""",
                (
                    source.source_id, source.version, index, chunk,
                    hashlib.sha256(chunk.encode("utf-8")).hexdigest(),
                    Jsonb({"title": source.title, "workflow": source.workflow,
                           "document_type": source.document_type, "chunk_index": index,
                           "section": _section_heading(chunk)}),
                    vector, EMBEDDING_MODEL, EMBEDDING_DIMENSION,
                ),
            )
        if source.status == "active":
            db.execute(
                """UPDATE policy_sources SET status='superseded'
                   WHERE source_id=%s AND version<>%s AND status='active'""",
                (source.source_id, source.version),
            )
    return IngestionResult(source.source_id, source.version, len(chunks), False)


def set_policy_status(db, source_id: str, version: str, status: str) -> bool:
    """Obsolete or supersede an existing source without deleting its audit trail."""
    if status not in {"active", "superseded", "obsolete"}:
        raise ValueError("Invalid policy status.")
    with db.transaction():
        exists = db.execute(
            "SELECT 1 FROM policy_sources WHERE source_id=%s AND version=%s",
            (source_id, version),
        ).fetchone()
        if not exists:
            return False
        if status == "active":
            db.execute(
                "UPDATE policy_sources SET status='superseded' WHERE source_id=%s AND status='active' AND version<>%s",
                (source_id, version),
            )
        result = db.execute(
            "UPDATE policy_sources SET status=%s WHERE source_id=%s AND version=%s",
            (status, source_id, version),
        )
    return result.rowcount == 1
