"""CLI for maintainer-controlled ingestion of explicitly synthetic policy JSON."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .policies import EMBEDDING_DIMENSION, EMBEDDING_MODEL, PolicySource, chunk_policy, ingest_policy


def _optional_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def load_source(path: Path) -> PolicySource:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Policy JSON must be an object.")
    allowed = {
        "source_id", "version", "title", "text", "workflow", "document_type",
        "source_kind", "jurisdiction", "organization_id", "source_uri", "status",
        "effective_from", "effective_to",
    }
    extra = set(raw) - allowed
    if extra:
        raise ValueError("Unknown policy JSON fields: " + ", ".join(sorted(extra)))
    raw["effective_from"] = _optional_date(raw.get("effective_from"))
    raw["effective_to"] = _optional_date(raw.get("effective_to"))
    return PolicySource(**raw)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest one synthetic policy source into DocFlow's policy store.")
    parser.add_argument("source", type=Path, help="UTF-8 JSON file containing a synthetic policy source")
    parser.add_argument("--dry-run", action="store_true", help="Validate and preview chunks without embeddings or database writes")
    args = parser.parse_args()

    source = load_source(args.source)
    chunks = chunk_policy(source.text)
    if args.dry_run:
        print(
            f"dry_run=ok source_id={source.source_id} version={source.version} "
            f"chunks={len(chunks)} max_chunk_chars={max(map(len, chunks))}"
        )
        return 0

    from .db import connect

    db = connect()
    try:
        result = ingest_policy(db, source)
    finally:
        db.close()
    print(
        f"ingested source_id={result.source_id} version={result.version} "
        f"chunks={result.chunk_count} unchanged={str(result.unchanged).lower()} "
        f"embedding_model={EMBEDDING_MODEL} dimensions={EMBEDDING_DIMENSION}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
