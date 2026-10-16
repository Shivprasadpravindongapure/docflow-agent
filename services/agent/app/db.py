import os
import re
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")


def database_url() -> str:
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL must be configured in the environment or repository .env file.")
    return value


def connect(conninfo: str | None = None, *, schema: str | None = None) -> psycopg.Connection:
    options={"row_factory":dict_row,"connect_timeout":10}
    if schema is not None:
        if not re.fullmatch(r"docflow_test_[0-9a-f]+",schema):
            raise ValueError("Invalid isolated test schema name.")
    db = psycopg.connect(conninfo or database_url(), **options)
    if schema is not None:
        db.execute(f'SET search_path TO "{schema}"')
    else:
        db.execute('SET search_path TO public')
    migrations = PROJECT_ROOT / "apps" / "api" / "src" / "migrations"
    script = "\n".join(path.read_text(encoding="utf-8") for path in sorted(migrations.glob("*.sql")))
    db.execute(script, prepare=False)
    db.commit()
    return db
