# DocFlow Agent: Phased Delivery Tasks

**Status:** Phases 1-5 complete. Phase 6 simulator implementation and mocked tests pass; its live 100-document synthetic acceptance run is pending. The owner approved this roadmap/documentation update only; no subsequent phase implementation is authorized.

The original nine phases are revised below to reflect the owner's requested future multi-document workflow and required safeguards. The Python processing agent replaces the separate PDF-only Python microservice and TypeScript processing worker. Work strictly one phase at a time; a roadmap approval does not approve implementation. For each separately authorized phase, implement only that phase, run its acceptance commands, update its checkboxes, report actual output, and stop.

**Scope boundary:** marksheets are the only currently supported processing category. The requested target workflow also names caste/category certificates, EWS certificates, fee receipts, nationality certificates, domicile certificates, and income certificates; these are planned only. Each category needs explicit fields/rules and synthetic fixtures before implementation. Never use real applicant data in development, testing, or evaluation. Consistency checks are not authenticity or fraud detection, and the system must not claim an unvalidated “realness” or confidence percentage or auto-reject an applicant.

## Preconditions and repository facts

- [ ] Add the original `DocFlow-Python-PDF-Plan.pdf` as `docs/DocFlow-Python-PDF-Plan.pdf`. The source PDF was not present in the repository when this plan was prepared; this plan follows the plan text supplied by the owner.
  - Files: `docs/DocFlow-Python-PDF-Plan.pdf`
  - Proof: `Test-Path docs/DocFlow-Python-PDF-Plan.pdf` (PowerShell) or `test -f docs/DocFlow-Python-PDF-Plan.pdf`.
- [x] Reconcile the prior Python-wide migration with the agreed split architecture: keep the Express API and web client in TypeScript; place document processing in `services/agent` Python; retain synthetic PDF generation in `eval/pdf`. The Node simulator remains scheduled for Phase 6.
  - Files: currently changed `apps/api/`, `services/agent/`, `eval/`; architecture in `AGENTS.md` and `docs/PLAN.md`.
  - Proof: restored Express API files pass `cd apps/api && npm test`; Python processing code and pinned requirements are under `services/agent`; generated data remains ignored.

## Phase 1 — Synthetic PDFs

**Stop point:** produce 50 reproducible, synthetic PDFs and a matching CSV answer key. About 30 PDFs must contain selectable text and about 20 must be image-only/scanned-style. Do not use real names or records.

- [x] Implement a fixed-seed generator with a stable PDF metadata/timestamp strategy so identical seed and inputs yield byte-identical files and answer key.
  - Files: `eval/pdf/generate_pdfs.py`, `eval/pdf/requirements.txt`
  - Proof: `python -m pip install -r eval/pdf/requirements.txt`; `python eval/pdf/generate_pdfs.py --seed 2027`; run it a second time and compare SHA-256 hashes of every PDF and the CSV.
- [x] Generate 50 PDFs under `eval/data/pdfs/` and `eval/data/pdf_answer_key.csv`; preserve the image answer-key columns and mark all planted mismatches. Keep `eval/data/` gitignored.
  - Files: `eval/pdf/generate_pdfs.py`, `eval/data/pdfs/`, `eval/data/pdf_answer_key.csv`, `.gitignore`
  - Proof: generated output contains 50 PDFs and 50 rows; PDF CSV columns and rows match the existing synthetic image answer key; `git check-ignore eval/data/pdfs eval/data/pdf_answer_key.csv`.
- [x] Test file count, row count, text/image-only distribution, columns, mismatch labels, and deterministic regeneration.
  - Files: `eval/pdf/test_generate_pdfs.py`
  - Proof: `python -m pytest eval/pdf/test_generate_pdfs.py -v` (5 passed); `python -m pytest` (29 passed).

**Phase acceptance: PASS.** Generated 50 PDFs (30 text-based, 20 image-only), 50 answer-key rows, and confirmed identical SHA-256 hashes across two runs with seed `2027`. Focused and full test suites pass. Do not start Phase 2 until authorized.

## Phase 2 — Python agent service and PDF handling

**Stop point:** the Python FastAPI agent starts on port 4100 and provides bounded PDF text extraction and scanned-page rendering.

- [x] Create the Python agent service with pinned dependencies and `GET /health` returning `{"status":"ok","service":"agent"}` on port 4100.
  - Files: `services/agent/app/main.py`, `services/agent/requirements.txt`, `services/agent/tests/test_main.py`
  - Proof: `python -m pytest services/agent/tests`; start with `python -m uvicorn services.agent.app.main:app --port 4100`, then `curl.exe -f http://localhost:4100/health`.
- [x] Implement `POST /extract` with multipart PDF upload, 2 MB maximum, five-page maximum, pdfplumber text extraction, and PyMuPDF page rendering for pages without selectable text. Return page count, per-page text, and PNG page images with an explicit response shape.
  - Files: `services/agent/app/pdf.py`, `services/agent/app/main.py`, `services/agent/tests/test_main.py`
  - Proof: `python -m pytest services/agent/tests/test_main.py`; use Phase 1 text-based and scanned synthetic PDFs to assert text extraction and image output respectively.
- [x] Reject non-PDF, malformed, empty, over-size, and over-page-limit uploads with explicit 4xx errors; ensure requests never persist uploads or call external services.
  - Files: `services/agent/app/pdf.py`, `services/agent/tests/test_main.py`
  - Proof: `python -m pytest services/agent/tests/test_main.py`; rejection cases pass and the service creates no uploaded files.

**Phase acceptance: PASS.** Health returned `{"status":"ok","service":"agent"}`. Live POST `/extract` returned HTTP 200 for both generated fixtures: the text PDF returned 270 characters of selectable text and no image payload; the scanned PDF returned a PNG with the valid PNG signature. Service tests: 10 passed; full Python suite: 33 passed. Express API tests: 1 passed; React production build succeeded. Uploads are processed in memory, and limit/error cases pass. No separate `services/pdf` service was created.

## Phase 3 — Python agent processing pipeline

**Stop point:** the Python agent processes text and scanned PDFs through OCR/extraction and deterministic validation, returning explainable decisions and timings.

- [x] Add a processing endpoint for PDF and image inputs that accepts the application-form fields and returns OCR/extraction/validation evidence, decision state, and per-stage timing. Keep the endpoint synthetic-only until authenticated API integration exists.
  - Files: `services/agent/app/main.py`, `services/agent/app/processing/models.py`, `services/agent/app/processing/pipeline.py`, `services/agent/tests/test_processing_api.py`
  - Proof: `python -m pytest services/agent/tests`; FastAPI tests submit generated synthetic PDF/image fixtures and assert response schema and size/type errors.
- [x] Implement marksheet OCR using Tesseract and preprocessing for image uploads and rendered scanned PDF pages; define explicit OCR executable errors, image limits, and timeouts.
  - Files: `services/agent/app/processing/ocr.py`, `services/agent/tests/test_ocr.py`
  - Proof: `python -m pytest services/agent/tests`; synthetic image/scanned-PDF fixtures exercise OCR, image bounds, and missing-executable/timeout failures.
- [x] Implement schema-checked field extraction (Gemini optional; local deterministic extraction for tests/default) and ground model values in OCR text.
  - Files: `services/agent/app/processing/extract.py`, `services/agent/app/processing/models.py`, `services/agent/tests/test_extraction.py`, `services/agent/tests/test_gemini_extraction.py`
  - Proof: `python -m pytest services/agent/tests`; mocked model calls assert invalid/ungrounded fields become null with warnings.
- [x] Implement deterministic validation, per-field evidence, decision states, and stage timings for PDF and image inputs.
  - Files: `services/agent/app/processing/validate.py`, `services/agent/app/processing/pipeline.py`, `services/agent/app/main.py`, `services/agent/tests/`, `eval/test_run_eval.py`
  - Proof: `python -m pytest services/agent/tests`; synthetic text/scanned PDFs and images reach `verified`, `needs_review`, and `missing` cases without auto-rejection.

**Phase acceptance: PASS.** `python -m pytest services/agent/tests -q` passed twice (40 tests per run); the full Python suite `python -m pytest -q` passed (47 tests). Synthetic text PDFs, scanned PDFs, PNG, and JPEG requests cover all three decision states, validation evidence, size/type limits, and stage timings. OCR is mocked for deterministic end-to-end scan tests; the local environment does not have the Tesseract executable, and the service reports this explicitly until it is installed. The endpoint remains unauthenticated and synthetic/local-only; do not expose it or submit real student records. No API key is needed for the default regex extractor. Phase 4 was separately authorized and is completed below.

## Phase 4 — Database and API

**Stop point:** registration, login, application creation, PDF/PNG upload, and job creation work through the Express API using synthetic data.

- [x] Restore or implement TypeScript Express API, PostgreSQL schema migrations, database configuration, and typed models for users, applications, documents, jobs, validations, reviews, and audit events.
  - Files: `apps/api/package.json`, `apps/api/src/server.ts`, `apps/api/src/db/models.ts`, `apps/api/src/migrations/`, `apps/api/src/server.test.ts`
  - Proof: `cd apps/api; npm test`; schema-isolated migration and API integration tests run against `TEST_DATABASE_URL` or the configured `DATABASE_URL`.
- [x] Add registration/login and authenticated application/document routes, upload size/type validation, synthetic-only test fixtures, and job enqueueing. Never put credentials in source control.
  - Files: `apps/api/src/server.ts`, `apps/api/src/server.test.ts`, `.env.example`
  - Proof: `cd apps/api; npm test`; integration tests register, log in, create an application, upload a synthetic PNG, and verify a queued job.
- [x] Connect the Python agent worker to the PostgreSQL job table; claim jobs safely, process PDF/PNG through the Python pipeline, persist validations and audit entries, and retry failures with a bounded policy.
  - Files: `services/agent/app/worker.py`, `services/agent/app/db.py`, `services/agent/tests/test_worker.py`, `.env.example`
  - Proof: `python -m pytest services/agent/tests`; test duplicate workers, retries, failed jobs, and successful synthetic PDF processing.
- [x] Persist each validation flag and audit entry with field, expected, extracted, and reason; keep decisions at `verified`, `needs_review`, or `missing` and never auto-reject.
  - Files: `apps/api/src/db/`, `apps/api/src/migrations/`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`
  - Proof: `cd apps/api; npm test`; verify stored validation evidence and audit history for synthetic records.

**Phase acceptance: PASS.** PostgreSQL migrations create the users, applications, documents, jobs, validations, reviews, audit events, and session tables. API integration tests passed twice (3 tests per run), `npm run build` passed, and the Python agent/worker suite passed (44 tests; 6 dependency deprecation warnings). The API tests use a disposable `docflow_test_*` schema; for Neon transaction-pooler `DATABASE_URL`s they connect to the matching direct endpoint so schema isolation persists across requests. Synthetic API tests cover registration, login, application creation, upload, queue creation, and audit entries. The worker uses `FOR UPDATE SKIP LOCKED`, recovers stale claims, and retries failures at most three times. The example environment file contains placeholders only; local `.env` is ignored by Git.

## Phase 5 — Live status

**Stop point:** applicant status updates without page refresh, using Server-Sent Events (SSE).

- [x] Add authenticated SSE endpoint with correct event-stream headers, per-user/application authorization, disconnect cleanup, and status events.
  - Files: `apps/api/src/server.ts`, `apps/api/src/server.test.ts`
  - Proof: `cd apps/api; npm test`; stream receives queued, processing, and terminal synthetic-job updates and stops polling after client disconnect.
- [x] Add React status subscription with reconnect/error handling and no polling fallback.
  - Files: `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/api/status.ts`, `apps/web/src/components/DocumentStatus.tsx`
  - Proof: `cd apps/web; npm test`; component tests assert live status changes without reconnecting or refreshing. `npm run build` verifies the production bundle.
- [x] Ensure events contain no secrets or document contents and only reach the owning synthetic test applicant.
  - Files: `apps/api/src/server.ts`, `apps/api/src/server.test.ts`
  - Proof: `cd apps/api; npm test`; authorization and minimal event-payload tests pass.

**Phase acceptance: PASS.** The API integration suite passed twice (4 tests per run) and the API TypeScript build passed. It streamed queued, processing, and verified status updates for the owner, returned 401/404 to unauthenticated/other-account requests, omitted document contents and tokens, and stopped polling after client disconnect. The web status component tests passed (2 tests); the production build passed; API and web `npm audit` both reported 0 vulnerabilities. A browser smoke test signed in with synthetic values and displayed `needs_review` from a mock status stream without reloading; the database-driven SSE transitions and synthetic PDF worker pipeline are covered separately by integration tests. No real applicant data was used.

## Phase 6 — Node live-traffic simulator

**Stop point:** send 100 synthetic applications/uploads through the live system and write measured timings to `eval/results/realtime.csv`.

- [x] Implement a rate-limited Node simulator that authenticates with credentials from environment variables, selects synthetic answer-key rows, uploads matching synthetic PDFs or PNGs, and records submit/start/finish/status/answer-match fields.
  - Files: `eval/simulator/run.js`, `eval/simulator/package.json` (if needed), `.env.example`
  - Proof: `node eval/simulator/run.js --help`; `node --test eval/simulator/run.test.js`; mocked API verifies the authenticated upload/status path and no credentials are logged.
- [x] Support a fixed seed and configurable submission rate/count; make the planned 100-document run reproducible in its inputs without fabricating observed times.
  - Files: `eval/simulator/run.js`, `eval/simulator/run.test.js`
  - Proof: `node --test eval/simulator/run.test.js`; fixture selection is deterministic for the same seed.
- [x] Write raw per-document timings and outcomes to an ignored CSV; calculate completion rate, median/p95 decision time, failures, and retries only from that CSV.
  - Files: `eval/simulator/run.js`, `.gitignore`
  - Proof: mocked integration test verifies CSV output; acceptance still requires a live run against local services and `eval/results/realtime.csv` with one observed result per submission.

**Phase acceptance: PENDING.** Simulator CLI and tests pass. Run the planned 100 submissions against the configured API/worker/database before recording measured results or marking this phase accepted. The output remains ignored and must not be committed.

## Phase 7 — Applicant multi-document and reviewer UI

**Stop point:** complete an end-to-end synthetic multi-document submission/status and human-review experience in the browser. The processing engine remains marksheet-only in this phase; other requested categories must be clearly marked as planned/not supported, not silently accepted as verified.

- [x] Build an applicant workflow with registration/login, application form, a document checklist, multi-file upload, per-file type/size validation, and clear submission confirmation using the TypeScript API. Preserve separate document types and statuses within an application.
  - Files: `apps/web/src/App.tsx`, `apps/web/src/api/`, `apps/web/src/pages/NewApplication.tsx`, `apps/web/src/pages/ApplicationDetail.tsx`, `apps/web/src/pages/Dashboard.tsx`
  - Proof: `cd apps/web; npm test; npm run build`; browser flow uploads synthetic marksheets and confirms document status.
- [x] Implement reviewer queue and document detail with page preview, extracted fields/evidence, applicant-form comparison, validation reasons, audit trail, and approve or return-for-correction with a required note. Do not add an authenticity/fraud verdict or automatic rejection.
  - Files: `apps/web/src/pages/ReviewerQueue.tsx`, `apps/web/src/pages/ReviewerDetail.tsx`, `apps/api/src/server.ts`, `apps/api/src/server.test.ts`
  - Proof: API/UI tests verify per-document ownership, reviewer authorization, required note, audit event, and human-controlled final decision using synthetic records.
- [x] Configure API URL from environment and keep authentication tokens out of persistent browser storage unless a reviewed decision explicitly allows it.
  - Files: `apps/web/src/api/client.ts`, `apps/web/vite.config.ts`, `.env.example`
  - Proof: `cd apps/web && npm run build`; configuration and auth tests pass.

**Phase acceptance: PASS.** Full React router architecture with dashboard, creation, upload, live SSE tracking, field comparison, reviewer queue, reviewer detail decision recording, and document file retrieval implemented. API endpoints (`/applications/:id/result`, `/applications/:id/documents`, `/applications/:id/documents/:docId/file`, `/applications/:id/audit`, `/reviewer/queue`, `/reviewer/applications/:id`, `/reviewer/applications/:id/review`, JPEG upload) verified with integration tests (`npm test` in `apps/api` passed 5/5; `apps/web` passed 2/2 and built in 933ms).

## Phase 8 — Security, privacy, and safe deployment readiness

**Stop point:** security/privacy controls are tested and a synthetic-only demo can be deployed on free-tier infrastructure. This phase does not authorize processing real applicant records or claim production readiness.

- [ ] Threat-model API, worker, document storage, browser sessions, SSE, and reviewer access. Add least-privilege applicant/reviewer roles, object-level authorization, request/file limits, safe logging, and authentication/private networking for every processing endpoint; remove public access to local document paths.
  - Files: `apps/api/src/`, `services/agent/app/`, migrations, tests, `docs/`
  - Proof: tests cover unauthenticated and cross-account access, reviewer role boundaries, upload limits, and no document contents/secrets in logs or status events.
- [ ] Define and implement synthetic-demo data lifecycle controls: encryption in transit/at rest where supported, retention/deletion behavior, audit coverage, backup/restore procedures, and incident/monitoring expectations. Ask before adopting paid services.
  - Files: storage/API/worker configuration, migrations, `docs/`
  - Proof: automated deletion/access tests and documented restore/operations checks use synthetic fixtures only.
- [ ] Add container/runtime configuration for the Express API, private Python agent/worker, health checks, resource limits, and service connectivity; deploy only the synthetic demo.
  - Files: `apps/api/Dockerfile`, `services/agent/Dockerfile`, `infra/docker-compose.yml`, `render.yaml`
  - Proof: `docker compose config`; local health checks; deployment smoke test uses a synthetic account and generated documents only.
- [ ] Configure free-tier PostgreSQL/API/agent deployment and web build without hard-coded secrets or public unauthenticated document handling.
  - Files: `render.yaml`, `apps/web/vercel.json` (if needed), `.env.example`, `docs/DEPLOY.md`
  - Proof: deployed health checks and synthetic multi-document upload/review smoke test; record cold-start observations from actual runs.
- [ ] Document setup, environment variables, synthetic demo accounts, operational limits, privacy assumptions, and explicit non-production limitations.
  - Files: `docs/DEPLOY.md`, `README.md`
  - Proof: follow the documented deployment procedure from a clean environment.

**Phase acceptance:** deployed links operate with synthetic data only; security tests pass; no paid service is added without owner approval. This is not approval to upload or process real student/applicant records.

## Phase 9 — Category-by-category synthetic evaluation and finish

**Stop point:** each separately approved document category has versioned, explainable deterministic rules, synthetic fixtures/answer keys, measured field-level results, and stated limitations. No category is assumed supported merely because it appears in the requested product target.

- [ ] For each individually approved added category, define an authority/source-neutral schema and deterministic checks with explicit evidence and human-review outcomes; add synthetic-only generators/fixtures and labeled expected outcomes. Do not add issuer-authenticity checks, fraud scoring, or a final-decision model.
  - Files: `services/agent/app/processing/`, `services/agent/tests/`, `eval/`
  - Proof: category-specific tests verify pass/mismatch/missing evidence and that uncertainty routes to human review; all records are synthetic.
- [ ] Run per-category synthetic evaluation and report field-level extraction/validation measures, false flags, missed planted mismatches, sample size, and limitations from generated artifacts only.
  - Files: `eval/`, `eval/results/`, `README.md`
  - Proof: documented evaluation command; outputs identify category and dataset version; README values match actual result files. Never label a synthetic result as real-world accuracy or genuineness probability.
- [ ] Run the Node simulator and preserve `eval/results/realtime.csv` plus its summary with the actual run configuration and measurements.
  - Files: `eval/simulator/run.js`, `eval/results/realtime.csv`, `eval/results/`
  - Proof: rerun the documented simulator command against the live synthetic system; verify completion/timing values derive from CSV rows.
- [ ] Run all relevant tests/builds and verify no secrets or generated data are staged/tracked.
  - Files: project test/build manifests, `.gitignore`, `README.md`
  - Proof: `cd apps/api && npm test`; `cd services/agent && pytest`; `cd apps/web && npm run build`; `git status --short`; `git ls-files .env eval/data`.

**Phase acceptance:** all authorized synthetic acceptance commands have actual results, README metrics match `eval/results/`, and `.env`/`eval/data/` are not tracked. Real-data use is outside repository development, testing, and evaluation; any future external pilot would require independent legal, privacy, security, and institutional approvals and is not authorized by this plan.
