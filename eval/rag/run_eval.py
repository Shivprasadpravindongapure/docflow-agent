"""Run mechanics-only synthetic RAG checks against Neon in a disposable schema."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import psycopg

from eval.rag.generate_fixtures import OUTPUT, fixtures, generate
from services.agent.app.db import connect, database_url
from services.agent.app.policies import EMBEDDING_DIMENSION, PolicySource, ingest_policy
from services.agent.app.retrieval import answer_policy_question

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "eval" / "results" / "rag"
TOP_K = 3
MIN_SIMILARITY = 0.55


def fixture_vector(key: str) -> list[float]:
    values = [0.0] * EMBEDDING_DIMENSION
    values[0 if key == "candidate" else 1] = 1.0
    return values


def run() -> dict:
    generate(OUTPUT)
    dataset = fixtures()
    schema = "docflow_test_" + uuid.uuid4().hex
    admin = psycopg.connect(database_url(), autocommit=True)
    rows = []
    try:
        admin.execute(f'CREATE SCHEMA "{schema}"')
        db = connect(schema=schema)
        try:
            for source in dataset["sources"]:
                embedding_key = source["embedding_key"]
                policy = PolicySource(**{key: value for key, value in source.items() if key != "embedding_key"})
                ingest_policy(
                    db,
                    policy,
                    embedder=lambda chunks, key=embedding_key: [fixture_vector(key) for _ in chunks],
                )

            for case in dataset["queries"]:
                expected = set(case["expected_citations"])
                query_key = case["embedding_key"]
                answer = answer_policy_question(
                    db,
                    case["query"],
                    workflow=case["workflow"],
                    document_type=case["document_type"],
                    top_k=TOP_K,
                    minimum_similarity=MIN_SIMILARITY,
                    embedder=lambda queries, key=query_key: [fixture_vector(key)],
                    generator=lambda query, passages: {
                        "answer": "Synthetic evidence summary for review.",
                        "citation_ids": [passage.citation_id for passage in passages],
                    },
                )
                retrieved = {item.citation_id for item in answer.retrieval.passages}
                cited = {item.citation_id for item in answer.citations}
                hits = len(retrieved & expected)
                is_positive = bool(expected)
                rows.append({
                    "query_id": case["query_id"],
                    "status": answer.status,
                    "retrieval_status": answer.retrieval.status,
                    "expected_citations": sorted(expected),
                    "retrieved_citations": sorted(retrieved),
                    "answer_citations": sorted(cited),
                    "precision_at_k": hits / TOP_K if is_positive else None,
                    "recall_at_k": hits / len(expected) if is_positive else None,
                    "no_evidence_abstained": not is_positive and answer.status == "abstained",
                    "citations_valid": cited.issubset(expected),
                    "old_version_excluded": not any("@v1#" in value and "admissions-mark-sheet" in value for value in retrieved),
                    "similarities": [item.similarity for item in answer.retrieval.passages],
                })
        finally:
            db.close()
    finally:
        admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        admin.close()

    positives = [row for row in rows if row["precision_at_k"] is not None]
    no_evidence = [row for row in rows if row["precision_at_k"] is None]
    summary = {
        "dataset_version": dataset["dataset_version"],
        "evaluation_scope": "retrieval/filter/citation mechanics using deterministic synthetic fixture vectors; not semantic embedding quality or real-world accuracy",
        "top_k": TOP_K,
        "minimum_similarity": MIN_SIMILARITY,
        "positive_query_count": len(positives),
        "mean_precision_at_k": sum(row["precision_at_k"] for row in positives) / len(positives) if positives else 0,
        "mean_recall_at_k": sum(row["recall_at_k"] for row in positives) / len(positives) if positives else 0,
        "no_evidence_query_count": len(no_evidence),
        "no_evidence_abstained": sum(row["no_evidence_abstained"] for row in no_evidence),
        "citations_valid": all(row["citations_valid"] for row in rows),
        "superseded_version_excluded": all(row["old_version_excluded"] for row in rows),
        "query_results": rows,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"dataset_version={summary['dataset_version']}")
    print(f"positive_queries={summary['positive_query_count']}")
    print(f"mean_precision_at_{TOP_K}={summary['mean_precision_at_k']:.3f}")
    print(f"mean_recall_at_{TOP_K}={summary['mean_recall_at_k']:.3f}")
    print(f"no_evidence_abstained={summary['no_evidence_abstained']}/{summary['no_evidence_query_count']}")
    print(f"citations_valid={summary['citations_valid']}")
    print(f"superseded_version_excluded={summary['superseded_version_excluded']}")
    print(f"result_file={RESULTS / 'summary.json'}")
    if not summary["citations_valid"] or not summary["superseded_version_excluded"]:
        raise SystemExit("synthetic RAG evaluation acceptance failed")
    if summary["no_evidence_abstained"] != summary["no_evidence_query_count"]:
        raise SystemExit("synthetic RAG abstention acceptance failed")
    return summary


if __name__ == "__main__":
    run()
