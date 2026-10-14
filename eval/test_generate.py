import csv

from PIL import Image

from eval.generate import generate_dataset


def test_generator_writes_fifty_synthetic_pngs_and_answer_rows(tmp_path):
    answer_key, images = generate_dataset(tmp_path)

    with answer_key.open(encoding="utf-8", newline="") as answer_file:
        rows = list(csv.DictReader(answer_file))

    assert len(rows) == 50
    assert len(list(images.glob("*.png"))) == 50
    assert sum(bool(row["planted_mismatch"]) for row in rows) == 10
    assert rows[0]["name"] == "Synthetic Aarav Sharma"
    assert rows[0]["form_name"] == "Aarav Sharma"
    assert Image.open(images / f"{rows[0]['id']}.png").format == "PNG"
