import json

import pytest

from services.agent.app.policy_cli import load_source
from services.agent.app.policies import PolicySource


def test_loads_synthetic_source_and_iso_dates(tmp_path):
    path = tmp_path / "policy.json"
    path.write_text(json.dumps({
        "source_id": "synthetic-test", "version": "v1", "title": "Test policy",
        "text": "Synthetic only.", "workflow": "demo", "document_type": "marksheet",
        "effective_from": "2026-01-01",
    }), encoding="utf-8")
    source = load_source(path)
    assert isinstance(source, PolicySource)
    assert source.effective_from.isoformat() == "2026-01-01"
    assert source.source_kind == "synthetic"


def test_rejects_unexpected_fields(tmp_path):
    path = tmp_path / "policy.json"
    path.write_text(json.dumps({"source_id": "synthetic", "private_payload": "unexpected"}), encoding="utf-8")
    with pytest.raises(ValueError, match="Unknown policy JSON fields"):
        load_source(path)


def test_rejects_non_object_json(tmp_path):
    path = tmp_path / "policy.json"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="must be an object"):
        load_source(path)
