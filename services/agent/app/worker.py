"""PostgreSQL-backed processing worker shared with the Express API."""
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from psycopg.types.json import Jsonb

from .db import connect
from .processing.models import ApplicationForm
from .processing.pipeline import analyze_document

MAX_ATTEMPTS = 3
RETRY_SECONDS = (5, 30)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def refresh_application_status(db, application_id: str) -> None:
    """Derive case status from all of its document jobs, never from one file alone."""
    db.execute(
        """UPDATE applications a SET status = CASE
             WHEN EXISTS (
               SELECT 1 FROM documents d JOIN jobs j ON j.document_id=d.id
               WHERE d.application_id=a.id AND j.status IN ('queued','processing','retry')
             ) THEN 'processing'
             WHEN EXISTS (
               SELECT 1 FROM documents d JOIN jobs j ON j.document_id=d.id
               WHERE d.application_id=a.id AND (j.status='failed' OR (j.status='completed' AND COALESCE(j.result_json->>'decision','needs_review') NOT IN ('verified','missing')))
             ) THEN 'needs_review'
             WHEN EXISTS (
               SELECT 1 FROM documents d JOIN jobs j ON j.document_id=d.id
               WHERE d.application_id=a.id AND j.result_json->>'decision'='missing'
             ) THEN 'missing'
             ELSE 'verified'
           END WHERE a.id=%s""",
        (application_id,),
    )


def claim_job(db, job_id: str | None = None):
    """Claim with row locking and SKIP LOCKED so concurrent workers never duplicate work."""
    with db.transaction():
        db.execute("UPDATE jobs SET status='queued',locked_at=NULL,updated_at=now() WHERE status='processing' AND locked_at < now()-interval '5 minutes'")
        query="SELECT j.*,d.application_id,d.document_type,d.content_type,d.storage_path,a.form_json FROM jobs j JOIN documents d ON d.id=j.document_id JOIN applications a ON a.id=d.application_id WHERE j.status IN ('queued','retry') AND j.available_at<=now()"
        params=()
        if job_id is not None:
            query+=" AND j.id=%s"; params=(job_id,)
        job = db.execute(query+" ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED",params).fetchone()
        if job is None:
            return None
        claimed = db.execute("UPDATE jobs SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now() WHERE id=%s RETURNING attempts",(job['id'],)).fetchone()
        job['attempts'] = claimed['attempts']
        db.execute("UPDATE applications SET status='processing' WHERE id=%s",(job['application_id'],))
        db.execute("INSERT INTO audit_events(id,application_id,document_id,job_id,event,details_json) VALUES(%s,%s,%s,%s,'job.processing',%s)",(uuid.uuid4().hex,job['application_id'],job['document_id'],job['id'],Jsonb({'attempt':job['attempts']})))
        return job


def process_job(db, job, processor=analyze_document):
    job_id, app_id = job['id'], job['application_id']
    try:
        content = Path(job['storage_path']).read_bytes()
        form = ApplicationForm.model_validate(job['form_json'])
        result = processor(content, form, content_type=job['content_type'], document_type=job['document_type'])
        with db.transaction():
            db.execute("DELETE FROM validations WHERE job_id=%s",(job_id,))
            for flag in result.validations:
                db.execute("INSERT INTO validations(id,job_id,field,expected,extracted,result,reason) VALUES(%s,%s,%s,%s,%s,%s,%s)",(uuid.uuid4().hex,job_id,flag.field,Jsonb(flag.expected),Jsonb(flag.extracted),flag.result,flag.reason))
            result_json = result.model_dump(mode='json')
            result_json.update({"application_id": app_id, "document_id": job['document_id']})
            db.execute("UPDATE jobs SET status='completed',locked_at=NULL,error=NULL,result_json=%s,updated_at=now() WHERE id=%s",(Jsonb(result_json),job_id))
            refresh_application_status(db, app_id)
            details={'decision':result.decision,'validations':[v.model_dump(mode='json') for v in result.validations]}
            db.execute("INSERT INTO audit_events(id,application_id,document_id,job_id,event,details_json) VALUES(%s,%s,%s,%s,'job.completed',%s)",(uuid.uuid4().hex,app_id,job['document_id'],job_id,Jsonb(details)))
        return result
    except Exception as error:
        terminal = job['attempts'] >= MAX_ATTEMPTS
        status = 'failed' if terminal else 'retry'
        error_code = type(error).__name__
        delay = RETRY_SECONDS[min(job['attempts']-1,len(RETRY_SECONDS)-1)] if not terminal else 0
        available = utcnow()+timedelta(seconds=delay)
        with db.transaction():
            db.execute("UPDATE jobs SET status=%s,locked_at=NULL,error=%s,available_at=%s,updated_at=now() WHERE id=%s",(status,error_code,available,job_id))
            refresh_application_status(db, app_id)
            details={'attempt':job['attempts'],'error_code':error_code,'terminal':terminal}
            event='job.failed' if terminal else 'job.retry_scheduled'
            db.execute("INSERT INTO audit_events(id,application_id,document_id,job_id,event,details_json) VALUES(%s,%s,%s,%s,%s,%s)",(uuid.uuid4().hex,app_id,job['document_id'],job_id,event,Jsonb(details)))
        return None


def run_once(db=None, job_id: str | None = None) -> bool:
    owns_connection = db is None
    if owns_connection:
        db=connect()
    try:
        job = claim_job(db,job_id)
        if job is None:
            return False
        process_job(db,job)
        return True
    finally:
        if owns_connection:
            db.close()


def run_forever(poll_seconds: float = 1.0):
    db=connect()
    try:
        while True:
            if not run_once(db):
                time.sleep(poll_seconds)
    finally:
        db.close()


if __name__ == '__main__':
    run_forever(float(os.environ.get('WORKER_POLL_SECONDS','1')))
