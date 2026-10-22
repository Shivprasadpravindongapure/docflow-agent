ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'applicant';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'marksheet';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('applicant','reviewer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS verification_runs (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('completed','needs_review','abstained','error')),
  summary TEXT NOT NULL,
  reason TEXT,
  policy_answers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_runs_application_idx ON verification_runs(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS verification_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  field TEXT NOT NULL,
  expected JSONB,
  extracted JSONB,
  result TEXT NOT NULL CHECK (result IN ('pass','mismatch','missing')),
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_findings_run_idx ON verification_findings(run_id, created_at);

CREATE TABLE IF NOT EXISTS verification_traces (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  tool TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','failed','skipped')),
  duration_ms DOUBLE PRECISION NOT NULL CHECK (duration_ms >= 0),
  error_code TEXT,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(run_id, ordinal)
);
CREATE INDEX IF NOT EXISTS verification_traces_run_idx ON verification_traces(run_id, ordinal);
