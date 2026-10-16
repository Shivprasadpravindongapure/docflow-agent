import csv
import json
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.types.json import Jsonb

from services.agent.app.db import connect, database_url
from services.agent.app.processing.models import ExtractedFields, FieldValidation
from services.agent.app.processing.pipeline import ProcessingResult
from services.agent.app.worker import claim_job, process_job


@pytest.fixture(scope="module")
def pg_schema():
    schema="docflow_test_"+uuid.uuid4().hex
    admin=psycopg.connect(database_url(),connect_timeout=10)
    admin.execute(f'CREATE SCHEMA "{schema}"')
    admin.commit()
    yield schema
    admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
    admin.commit()
    admin.close()


def seeded(tmp_path: Path,schema: str):
    db = connect(schema=schema)
    timestamp = "2000-01-01T00:00:00Z"
    user, app, doc, job = (uuid.uuid4().hex for _ in range(4))
    pdf = tmp_path / f"{doc}.pdf"
    pdf.write_bytes(b"%PDF-synthetic fixture")
    db.execute("INSERT INTO users(id,email,password_hash) VALUES(%s,%s,%s)",(user,f"{user}@example.test","synthetic-test-only"))
    db.execute("INSERT INTO applications(id,user_id,form_json,created_at) VALUES(%s,%s,%s,%s)",(app,user,Jsonb({"name":"Asha Example","roll_number":"SYN-1","dob":"2008-01-02","year":2025}),timestamp))
    db.execute("INSERT INTO documents(id,application_id,filename,content_type,sha256,storage_path) VALUES(%s,%s,%s,%s,%s,%s)",(doc,app,"synthetic.pdf","application/pdf","synthetic-sha",str(pdf)))
    db.execute("INSERT INTO jobs(id,document_id,status,available_at) VALUES(%s,%s,'queued',now())",(job,doc))
    db.commit()
    return db,user,job,app,doc


def cleanup(db,user):
    db.execute("DELETE FROM users WHERE id=%s",(user,))
    db.commit()
    db.close()


def result(decision="needs_review"):
    flag = FieldValidation(field="total",expected=450,extracted=449,result="mismatch",reason="Synthetic fixture mismatch.")
    return ProcessingResult(input_type="pdf",ocr_text="synthetic marksheet",extracted=ExtractedFields(name="Asha Example",roll_number="SYN-1",dob="2008-01-02",board=None,year=2025,total=449,result=None),validations=[flag],decision=decision,timings_ms={"document":1,"ocr":0,"extraction":1,"validation":1,"total":3})


def test_claim_is_atomic_across_workers(tmp_path,pg_schema):
    db1,user,job_id,_,_=seeded(tmp_path,pg_schema)
    db2=connect(schema=pg_schema)
    try:
        first=claim_job(db1)
        second=claim_job(db2)
        assert first["id"]==job_id and first["attempts"]==1
        assert second is None
    finally:
        db2.close(); cleanup(db1,user)


def test_success_persists_decision_validation_evidence_and_audit(tmp_path,pg_schema):
    db,user,job_id,_,_=seeded(tmp_path,pg_schema)
    try:
        job=claim_job(db)
        processed=process_job(db,job,lambda *_args,**_kwargs:result())
        assert processed.decision=="needs_review"
        assert db.execute("SELECT status FROM jobs WHERE id=%s",(job_id,)).fetchone()["status"]=="completed"
        validation=db.execute("SELECT field,expected,extracted,result,reason FROM validations WHERE job_id=%s",(job_id,)).fetchone()
        assert validation["field"]=="total" and validation["expected"]==450 and validation["extracted"]==449 and validation["result"]=="mismatch" and validation["reason"]
        event=db.execute("SELECT event,details_json FROM audit_events WHERE job_id=%s AND event='job.completed'",(job_id,)).fetchone()
        assert event["event"]=="job.completed" and event["details_json"]["decision"]=="needs_review"
    finally:
        cleanup(db,user)


def test_processes_generated_synthetic_pdf_through_real_pipeline(tmp_path,pg_schema):
    repo=Path(__file__).resolve().parents[3]
    pdf_path=repo/"eval"/"data"/"pdfs"/"DF-2027-0002.pdf"
    answer_key=repo/"eval"/"data"/"pdf_answer_key.csv"
    if not pdf_path.exists() or not answer_key.exists():
        raise AssertionError("Generate Phase 1 synthetic PDFs before running Phase 4 worker integration tests.")
    with answer_key.open(newline="",encoding="utf-8") as handle:
        row=next(item for item in csv.DictReader(handle) if item["id"]=="DF-2027-0002")
    db,user,job_id,app_id,doc_id=seeded(tmp_path,pg_schema)
    try:
        db.execute("UPDATE documents SET storage_path=%s WHERE id=%s",(str(pdf_path),doc_id))
        form={"name":row["form_name"],"roll_number":row["form_roll_number"],"dob":row["form_dob"],"year":int(row["form_year"]),"board":row["board"],"total":int(row["form_total"])}
        db.execute("UPDATE applications SET form_json=%s WHERE id=%s",(Jsonb(form),app_id))
        db.commit()
        job=claim_job(db)
        assert job is not None
        processed=process_job(db,job)
        assert processed is not None and processed.input_type=="pdf"
        assert processed.decision in {"verified","needs_review","missing"}
        assert db.execute("SELECT status FROM jobs WHERE id=%s",(job_id,)).fetchone()["status"]=="completed"
        assert db.execute("SELECT count(*) AS total FROM validations WHERE job_id=%s",(job_id,)).fetchone()["total"]==len(processed.validations)
    finally:
        cleanup(db,user)


def test_failures_retry_boundedly_then_become_terminal(tmp_path,pg_schema):
    db,user,job_id,_,_=seeded(tmp_path,pg_schema)
    try:
        for attempt in range(1,4):
            job=claim_job(db)
            assert job["attempts"]==attempt
            assert process_job(db,job,lambda *_a,**_k: (_ for _ in ()).throw(RuntimeError("synthetic processing failure"))) is None
            assert db.execute("SELECT status FROM jobs WHERE id=%s",(job_id,)).fetchone()["status"]==("failed" if attempt==3 else "retry")
            if attempt<3:
                db.execute("UPDATE jobs SET available_at=now() WHERE id=%s",(job_id,))
        assert db.execute("SELECT count(*) AS total FROM audit_events WHERE job_id=%s AND event='job.failed'",(job_id,)).fetchone()["total"]==1
        assert db.execute("SELECT count(*) AS total FROM audit_events WHERE job_id=%s AND event='job.retry_scheduled'",(job_id,)).fetchone()["total"]==2
    finally:
        cleanup(db,user)
