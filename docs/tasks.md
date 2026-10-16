# DocFlow Agent: Phased Delivery Tasks

**Status:** Phases 1-5 complete; waiting for owner authorization before Phase 6.

The nine phases below follow section 6 of the supplied PDF plan, with the Python processing agent replacing the separate PDF-only Python microservice and TypeScript processing worker. Work strictly one phase at a time. Phases 1-5 are complete; phases 6-9 require separate owner authorization. For each approved phase, implement only that phase, run its acceptance commands, update its checkboxes, report the actual output, and stop.

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

**Phase acceptance: PASS.** The API integration suite passed twice (4 tests per run) and the API TypeScript build passed. It streamed queued, processing, and verified status updates for the owner, returned 401/404 to unauthenticated/other-account requests, omitted document contents and tokens, and stopped polling after client disconnect. The web status component tests passed (2 tests); the production build passed; API and web `npm audit` both reported 0 vulnerabilities. A browser smoke test signed in with synthetic values and displayed `needs_review` from a mock status stream without reloading; the database-driven SSE transitions and synthetic PDF worker pipeline are covered separately by integration tests. No real applicant data was used. Stop here; do not start Phase 6 until separately authorized.

## Phase 6 — Node live-traffic simulator

**Stop point:** send 100 synthetic applications/uploads through the live system and write measured timings to `eval/results/realtime.csv`.

- [ ] Implement a rate-limited Node simulator that authenticates with credentials from environment variables, selects synthetic answer-key rows, uploads matching PDFs/PNGs, and records submit/start/finish/status/answer-match fields.
  - Files: `eval/simulator/run.js`, `eval/simulator/package.json` (if needed), `.env.example`
  - Proof: `node eval/simulator/run.js --help`; simulator unit tests with mocked API; no credentials in fixtures or logs.
- [ ] Support a fixed seed and configurable submission rate/count; make the planned 100-document run reproducible in its inputs without fabricating observed times.
  - Files: `eval/simulator/run.js`, `eval/simulator/run.test.js`
  - Proof: `node --test eval/simulator/run.test.js`.
- [ ] Write raw per-document timings and outcomes to an ignored CSV; calculate completion rate, median/p95 decision time, failures, and retries only from that CSV.
  - Files: `eval/simulator/run.js`, `.gitignore`
  - Proof: run against local services and inspect `eval/results/realtime.csv`; verify CSV has one real result per submitted synthetic document.

**Phase acceptance:** `eval/results/realtime.csv` exists after a live 100-document run and contains actual measured timings; simulator tests pass.

## Phase 7 — React screens

**Stop point:** complete synthetic applicant upload and reviewer approval in the browser.

- [ ] Implement applicant registration/login, application form, PDF/PNG upload, and submission confirmation using the TypeScript API.
  - Files: `apps/web/src/App.tsx`, `apps/web/src/api/`, `apps/web/src/pages/Applicant*.tsx`
  - Proof: `cd apps/web && npm run build`; browser test uploads a synthetic fixture.
- [ ] Implement status/reviewer queue/document detail with page preview, extracted fields, form comparison, validation reasons, audit trail, approve/reject-with-note; human reviewer remains final.
  - Files: `apps/web/src/pages/Reviewer*.tsx`, `apps/web/src/components/`, `apps/web/src/api/`
  - Proof: `cd apps/web && npm run build`; browser test completes reviewer approval and verifies audit entry.
- [ ] Configure API URL from environment and keep authentication tokens out of persistent browser storage unless a reviewed decision explicitly allows it.
  - Files: `apps/web/src/api/client.ts`, `apps/web/vite.config.ts`, `.env.example`
  - Proof: `cd apps/web && npm run build`; configuration and auth tests pass.

**Phase acceptance:** browser flow completes synthetic upload, live status, reviewer inspection, and approval; no real data is used.

## Phase 8 — Deploy

**Stop point:** deployed web, Express API, Python agent, and database operate together on free-tier infrastructure; cold starts are documented.

- [ ] Add container/runtime configuration for Express API, Python agent/worker, health checks, resource limits, and private service connectivity.
  - Files: `apps/api/Dockerfile`, `services/agent/Dockerfile`, `infra/docker-compose.yml`, `render.yaml`
  - Proof: `docker compose config`; local `docker compose up` health checks for API and Python agent.
- [ ] Configure free-tier PostgreSQL/API/PDF deployment and Vercel web build without hard-coded secrets or public unauthenticated PDF handling.
  - Files: `render.yaml`, `apps/web/vercel.json` (if needed), `.env.example`, `docs/DEPLOY.md`
  - Proof: run deployed `/health` checks and synthetic upload/review smoke test; record cold-start observations from actual runs.
- [ ] Document setup, environment variables, synthetic demo accounts, and operational limits.
  - Files: `docs/DEPLOY.md`, `README.md`
  - Proof: follow the documented deployment procedure from a clean environment.

**Phase acceptance:** Render/API/agent and Vercel links work with the synthetic demo from a phone/browser; no paid service is added without owner approval.

## Phase 9 — Evaluation and finish

**Stop point:** full synthetic accuracy and live simulator results are reproducible, and README metrics exactly match generated output files.

- [ ] Run full synthetic image/PDF accuracy evaluation and report valid/mismatch counts, field accuracy, false flags, missed mismatches, and limitations from the generated artifacts only.
  - Files: `eval/run-eval.ts` or the repository's TypeScript evaluation entry point, `eval/results/`, `README.md`
  - Proof: run the documented evaluation command; compare every README number programmatically or manually to its output file.
- [ ] Run the Node simulator and preserve `eval/results/realtime.csv` plus its summary with the actual run configuration and measurements.
  - Files: `eval/simulator/run.js`, `eval/results/realtime.csv`, `eval/results/`
  - Proof: rerun the documented simulator command against the live synthetic system; verify completion/timing values derive from CSV rows.
- [ ] Run all relevant tests/builds and verify no secrets or generated data are staged/tracked.
  - Files: project test/build manifests, `.gitignore`, `README.md`
  - Proof: `cd apps/api && npm test`; `cd services/agent && pytest`; `cd apps/web && npm run build`; `git status --short`; `git ls-files .env eval/data`.

**Phase acceptance:** nine phase checklists are complete, all acceptance commands have actual results, README metrics match `eval/results/`, and `.env`/`eval/data/` are not tracked.
