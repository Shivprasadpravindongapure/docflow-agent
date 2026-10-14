from __future__ import annotations

import csv
import hashlib
from pathlib import Path

import pytest

from eval.pdf.generate_pdfs import CSV_COLUMNS, generate_pdfs


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as generated_file:
        for chunk in iter(lambda: generated_file.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_rows(answer_key_path: Path) -> list[dict[str, str]]:
    with answer_key_path.open(encoding="utf-8", newline="") as answer_key:
        reader = csv.DictReader(answer_key)
        assert reader.fieldnames == list(CSV_COLUMNS)
        return list(reader)


def test_generates_fifty_synthetic_pdfs_and_matching_answer_rows(tmp_path: Path) -> None:
    answer_key_path, pdf_directory = generate_pdfs(tmp_path / "dataset", seed=2027)
    pdf_paths = sorted(pdf_directory.glob("*.pdf"))
    rows = _load_rows(answer_key_path)

    assert len(pdf_paths) == 50
    assert len(rows) == 50
    assert {path.stem for path in pdf_paths} == {row["id"] for row in rows}
    assert sum(bool(row["planted_mismatch"]) for row in rows) == 10
    assert rows[0]["name"] == "Synthetic Aarav Sharma"
    assert rows[0]["form_name"] == "Aarav Sharma"
    assert all(path.read_bytes().startswith(b"%PDF-") for path in pdf_paths)


def test_dataset_has_thirty_text_pdfs_and_twenty_image_only_pdfs(
    tmp_path: Path,
) -> None:
    answer_key_path, pdf_directory = generate_pdfs(tmp_path / "dataset", seed=2027)
    rows_by_id = {row["id"]: row for row in _load_rows(answer_key_path)}
    text_pdfs = []
    image_only_pdfs = []

    for pdf_path in sorted(pdf_directory.glob("*.pdf")):
        content = pdf_path.read_bytes()
        name = rows_by_id[pdf_path.stem]["name"].encode("ascii")
        if name in content:
            text_pdfs.append(pdf_path)
        else:
            image_only_pdfs.append(pdf_path)
            assert b"/Subtype /Image" in content

    assert len(text_pdfs) == 30
    assert len(image_only_pdfs) == 20


def test_same_seed_produces_byte_identical_files_and_answer_key(
    tmp_path: Path,
) -> None:
    first_key, first_pdf_directory = generate_pdfs(tmp_path / "first", seed=2027)
    second_key, second_pdf_directory = generate_pdfs(tmp_path / "second", seed=2027)

    assert _sha256(first_key) == _sha256(second_key)
    first_hashes = {
        path.name: _sha256(path) for path in sorted(first_pdf_directory.glob("*.pdf"))
    }
    second_hashes = {
        path.name: _sha256(path) for path in sorted(second_pdf_directory.glob("*.pdf"))
    }
    assert first_hashes == second_hashes


def test_different_seed_changes_text_vs_scanned_assignment(tmp_path: Path) -> None:
    first_key, first_pdf_directory = generate_pdfs(tmp_path / "first", seed=2027)
    second_key, second_pdf_directory = generate_pdfs(tmp_path / "second", seed=2028)

    def text_pdf_names(answer_key_path: Path, directory: Path) -> set[str]:
        rows = _load_rows(answer_key_path)
        names_by_id = {row["id"]: row["name"].encode("ascii") for row in rows}
        return {
            path.name
            for path in directory.glob("*.pdf")
            if names_by_id[path.stem] in path.read_bytes()
        }

    assert text_pdf_names(first_key, first_pdf_directory) != text_pdf_names(
        second_key, second_pdf_directory
    )


def test_rejects_negative_seed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="non-negative"):
        generate_pdfs(tmp_path / "dataset", seed=-1)
