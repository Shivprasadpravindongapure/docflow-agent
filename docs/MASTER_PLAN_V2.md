# DocFlow Agent V2 Master Plan

**Purpose:** Upgrade the existing DocFlow Agent into a synthetic-data-first, evidence-grounded document review platform using retrieval-augmented generation (RAG), one bounded AI agent, deterministic checks, and human decisions.

**Plan status:** Owner approved sequential implementation through the remaining stages, existing Gemini/Groq free-tier use, and additive changes to the confirmed Neon development database. Stages B-F passed their recorded checks. Stage G documentation/release-candidate checks are underway. No production database or deployment is authorized.

**Current supported scope:** Marksheets only. The owner's desired product scope includes multiple document categories for college administration, company verification, government recruitment, examination cases, and similar workflows. Additional categories (including birth certificates and identity cards such as Aadhaar) remain unsupported until each has a separately approved schema, extraction behavior, checks, synthetic fixtures, and acceptance tests. The system reports evidence and consistency; it must not claim authenticity or make final eligibility, fraud, or rejection decisions.

**Owner's V2 product direction (planning input, 2026-10-22):** Serve college administrators, company verification teams, government recruitment administrators, examination teams, and similar organizations that currently review documents manually. An authenticated user creates an applicant/case, uploads multiple PDF or image documents for that applicant, and receives a case-scoped assistant that organizes scans, extracted evidence, checks, policy references, and review progress to help reviewers work faster. Keep applicant data and agent context isolated by case. Build for failure handling and reviewability; never promise zero failures or replace accountable human decisions.

## 1. Current repository audit (2026-10-22)

### Repository and Git state

- Working directory is `D:\Downloads\internship2027\docflowagent`.
- Current branch is `main`, tracking `origin/main`; latest commit observed: `9eb772f feat: integrate Gemini Vision pipeline, multimodal extraction, quality checks and verification UI`.
- `git status --short --branch` showed `## main...origin/main` with no listed changes. A follow-up full porcelain status also listed no files. Git printed a permission warning for `.pytest_cache`; treat clean status as observed with that unreadable cache caveat.
- This establishes local Git branch tracking, not whether a GitHub integration/connector is currently authenticated or able to perform remote operations.
- `.env` exists and is ignored by Git. Its contents were not inspected or copied. Continue to keep credentials private.

### Existing implementation found in source

- **Web:** React/Vite/TypeScript app in `apps/web`; routes/pages cover applicant dashboard, application creation/detail, document status, reviewer queue, and reviewer detail. Status uses authenticated fetch streaming over SSE.
- **Application API:** Express/TypeScript in `apps/api/src/server.ts`; includes registration/login, application and upload routes, status SSE, document/result/audit routes, and reviewer routes. PostgreSQL is configured through `DATABASE_URL`.
- **Processing service:** FastAPI in `services/agent/app/main.py`; `/health`, `/extract`, and `/process`. PDF handling, OCR, extraction, deterministic checks, and database worker live under `services/agent/app`.
- **Extraction:** `services/agent/app/processing/extract.py` has local labelled-field extraction and Gemini Vision integration configured with `GEMINI_API_KEY` and `gemini-2.5-flash`. The source also defines a Gemini verdict/reasoning field. V2 must inspect and explicitly separate model suggestions from rule/human decisions before reusing this behavior; do not silently reinterpret existing API responses.
- **Document-type schema gap:** the current processing model and extractor are marksheet-shaped (`ExtractedDocument`/`ExtractedFields`) and are not suitable as a universal result for birth certificates, identity cards, receipts, or other categories. Do not return marksheet fields for a non-marksheet document.
- **OCR fallback readiness:** `pytesseract` is pinned and `ocr.py` has a 30-second local Tesseract call. The Stage B substep now calls it first for images/scanned pages and falls back to Gemini only when local extraction fails or has no supported labelled fields. Windows default executable discovery was added. The full agent test suite passes; a native OCR check against the installed Windows binary has not yet been run.
- **Worker:** Python worker claims PostgreSQL jobs using row locks and `SKIP LOCKED`; task documentation states a bounded retry policy. Existing upload/job flow should be extended rather than duplicated.
- **Database:** Existing migrations `001_init.sql` through `004_user_name.sql` cover the application workflow. Stage B adds `005_policy_rag.sql` for versioned policy sources and chunks. The API schema is extended additively; embeddings are fixed at 3072 dimensions for the pinned model.
- **Neon capability check and approved change (2026-10-22):** using the existing `.env` connection without printing its value, the connected database reported PostgreSQL 18.6. After the owner confirmed it is a development/test database safe to modify, `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public` succeeded; installed extension version is 0.8.6. An isolated temporary schema verified the new migrations and was dropped. The shared dev database now has the extension; no production database was touched.
- **Policies/RAG:** No ingestion pipeline, persistent policy corpus, embeddings, retrieval implementation, citation model, or RAG evaluation set was found.
- **Agent:** No bounded tool-calling agent or explicit tool registry/budget was found. Existing pipeline is a processing pipeline, not evidence of an allowlisted agent.
- **Evaluation:** Synthetic PDF/image generation, Python tests/evaluation, and a Node simulator with mocked tests exist. `docs/tasks.md` says Phase 6's 100-document live synthetic run remains pending. Do not report performance values until generated by a real run and saved in `eval/results/`.
- **Deployment:** No root-level Docker, compose, Render, Vercel, or deployment manifest was found in the root check; Phase 8 deployment/security work is still unchecked in `docs/tasks.md`.
- **Configuration:** `.env.example` has placeholders for database and simulator settings. README documents `GEMINI_API_KEY`. No embedding configuration exists in the checked search. Do not print local secret values.
- **Libraries/data for quality comparison:** `rapidfuzz` is already in `services/agent/requirements.txt` and can support normalized name comparisons ([usage docs](https://rapidfuzz.github.io/RapidFuzz/Usage/process.html)); exact IDs, dates, and totals need field-specific deterministic normalization and rules. [JiWER](https://jitsi.github.io/jiwer/) is a small candidate for character/word error metrics; it is not part of the runtime pipeline. `pytesseract`/Tesseract is present. [PaddleOCR's official docs](https://www.paddleocr.ai/main/en/index.html) describe OCR plus document-layout/table pipelines and make it a candidate to benchmark, not an assumed upgrade. [MIDV-2020](https://arxiv.org/abs/2107.00396) contains mock identity documents with generated field values/faces and can inform generic ID layout evaluation, but it does not encode Aadhaar rules or verify authenticity. [FUNSD](https://arxiv.org/abs/1905.13538) (noisy forms), [SROIE](https://arxiv.org/abs/2103.10213) and [CORD](https://openreview.net/pdf?id=SJl3z659UH) (receipts) cover limited tasks. Do not copy public corpora into the synthetic-only repository without a separately approved evaluation/license review. Prefer our own generated per-category fixtures and answer keys for project acceptance.

### Documentation inconsistencies to resolve

- `docs/tasks.md` marks Phases 1–5 complete, Phase 6 pending, Phase 7 complete, and Phases 8–9 incomplete.
- At audit time, the top-level status in `docs/tasks.md` and `README.md` conflicted with the completed Phase 7 section. The status wording has now been reconciled to the checked-in phase record and the newly completed Stage B; Phase 6's live run and Phases 8-9 remain pending.
- The task plan reports historical test results, but this audit did not rerun tests. Current test health is therefore **not freshly verified**. Acceptance commands are listed below for approved stages.

### Reusable components

- Preserve the existing API, React workflows, SQL migration history, Python document pipeline, PostgreSQL worker, audit records, SSE stream, synthetic fixture generator, and simulator.
- Extend the Python processing service for policy ingestion/retrieval and bounded verification orchestration; keep applicant-facing APIs and authorization in Express.
- Extend existing migrations additively, preserving existing API contracts unless a versioned/compatible strategy is approved.

## 2. Target V2 workflow

1. An administrator signs up/logs in using existing authentication, creates an applicant case, and enters only authorized case information needed for that organization's workflow.
2. The administrator uploads multiple supported files for the same applicant/case. The system validates each file, stores it under access-controlled case ownership, and tracks each document's processing state independently.
3. A case-scoped assistant/workflow coordinates permitted document scans, extraction, retrieval, and checks. It cannot see another applicant's data or carry context across cases.
4. Existing worker extracts fields and records page/field evidence. For selectable-text PDFs use local text extraction. For scans/images, run local Tesseract OCR first, then local field extraction and deterministic checks. Call Gemini Vision only if Tesseract is unavailable, errors/times out, returns empty text, or returns text from which no supported marksheet fields can be extracted. If both paths fail or evidence is incomplete, preserve partial evidence and route the document to review instead of failing the entire case.
5. A V2 verification run retrieves only current, applicable policy passages for the configured organization/workflow/document type and records source IDs, versions, and excerpts.
6. A bounded agent may select approved checks from an explicit allowlist; deterministic code runs calculations and rule checks. Each result remains attributable to its document and applicant case.
7. The system records passed, inconsistent, missing, and uncertain findings, citations, processing/model/OCR path, and a bounded tool trace. A failure for one document does not erase successful results for other documents in that case.
8. Unsupported, conflicting, low-evidence, malformed, or failed operations abstain and route to a human reviewer. The reviewer sees per-document evidence, case-level progress, rules, policy sources, tool timeline, and audit trail, then makes the consequential decision.

The platform must distinguish internal consistency from external authenticity. No policy text or document text may instruct the agent to change its tools, rules, or authority.

### Document-specific result contract

- Every uploaded file has an explicit document category (selected by the user or cautiously classified). Keep shared envelope metadata separate: applicant/case ID, document ID/type, page count, processing state, timestamps, and evidence references.
- Each supported type has its own versioned typed payload and field names. A marksheet schema contains academic fields (board, candidate identifiers, exam/session, subjects, marks, totals, result); a birth-certificate schema contains only fields approved for that type (for example, registered person's name, date/place of birth, parent names, registration number/date, and issuing authority); an identity-card schema contains only its approved identity fields. These are schema examples, not claims that any issuer requires those fields.
- Type-specific checks are selected by document type and configured workflow. Never apply marksheet arithmetic to a birth certificate or identity card. Shared checks (file validity, OCR evidence, field provenance) must not imply that type-specific verification passed.
- If type is unknown, unsupported, or classification is uncertain, preserve OCR/page evidence, return an explicit unsupported/needs-review result, and ask for human classification. Do not coerce it into the nearest known schema.
- For a multi-document applicant, retain a separate typed extraction result and status per file. Link cross-document comparisons only through an explicit, authorized rule that records both source document/field references and reports conflicts for human review.
- Real identity documents and real personal data remain prohibited in repository fixtures/evaluation. Use synthetic stand-ins; redact or minimize sensitive identity values in logs and traces.

## 3. Staged implementation roadmap

Each stage requires explicit owner approval before implementation. Acceptance commands are proposed; if repo paths or commands differ, revise the stage plan and get approval first. No stage should silently mark later work complete.

### Stage A — Audit and plan approval (this document)

- Deliver this verified repository audit, target workflow, staged plan, decisions needed, and acceptance strategy.
- No application code, database, dependency, environment, or external-service changes.
- **Gate:** Owner reviews this master plan and authorizes Stage B or requests revisions.

### Stage B — RAG foundation and policy ingestion

- First resolve PostgreSQL deployment capability: inspect server version and whether `CREATE EXTENSION vector` is supported in the intended development database. Do not run extension/migration changes against production. If unavailable, report the constraint and propose the smallest alternative before adopting new infrastructure.
- Use a synthetic-only source schema with source/version, workflow, document type, organization/jurisdiction context, effective dates, status, and content hash. Do not ingest authoritative or external requirements until their source and use are approved.
- Implement maintainer CLI ingestion for UTF-8 JSON sources, deterministic paragraph/heading-preserving chunks, metadata, effective-date handling, idempotency, version conflict checks, and explicit obsolete/superseded states. `docs/examples/synthetic_marksheet_policy.json` is invented demo text, not an official requirement.
- Fix the embedding index at `gemini-embedding-001`, 3072 dimensions. A single approved synthetic API probe returned 3072 values; a second end-to-end synthetic check stored one vector in an isolated Neon schema and verified 3072 dimensions, then dropped that schema. This is a connectivity/storage check, not a quality or cost evaluation. Do not mix model spaces; changing model/dimension needs a re-embedding/re-index plan.
- Persist policy sources, versions, chunks, and embeddings with additive migration `005_policy_rag.sql`, uniqueness constraints, context indexes, and source/version lifecycle. Add dry-run and idempotency behavior.
- Add no new paid service, managed database, Redis, queue, or orchestration framework without explicit approval.
- **Acceptance:** focused ingestion tests for normalization, chunk boundaries/metadata, idempotent re-ingestion, version changes, obsolete policy handling, malformed input, and mocked embedding failures; migration tests against a disposable schema. Record actual command output.
- Add Gemini-independent primary OCR to the existing processing path: Tesseract handles image/scanned-PDF text first, followed by local extraction and deterministic checks. Preserve selectable PDF text behavior; record explicit provider/path status and warnings. Invoke Gemini only when Tesseract/local extraction fails or yields no usable labelled fields. If both paths fail, return a partial/needs-review result without losing the application/job or unrelated document results.
- Processing order is owner-confirmed: **Tesseract/local extraction first; Gemini Vision fallback only when Tesseract/local extraction fails or produces unusable evidence.** Do not call Gemini on a successful usable local extraction. For text-based PDFs, keep local selectable-text extraction first and use the same local parser; Gemini is a fallback only if that route is unusable. Gemini failure after local OCR failure must produce a safe needs-review result with warnings, never a crash or authenticity claim.
- **Owner's later provider request (2026-10-22), implemented in Stage D:** Groq `openai/gpt-oss-20b` is a text-only fallback after Tesseract/local OCR and Gemini, only when OCR text exists. It cannot substitute for OCR when no usable text is returned. The implementation is lazy-loaded, bounded to one no-retry call, and covered by mocked tests. Keep it within the owner's free-tier account; the repository cannot enforce a provider account's plan.
- **Gate:** Review schema, source lifecycle, vector choice, and tests before Stage C.

### Stage C — Grounded retrieval and answer contract

- Implement marksheet/context-filtered semantic retrieval with configurable top-k and a measured/defined abstention threshold. Keep query embedding model/dimension identical to the index.
- Return a typed result containing concise answer/findings, source IDs and version, section/page where available, relevant excerpts, uncertainty/missing evidence, and retrieval metadata needed for audit.
- Never invent citations. If no sufficiently relevant source exists, abstain and route to review. Treat retrieved passages as evidence, not agent instructions.
- Keep deterministic validations and generated explanations separate; retrieval cannot alter rules or final status.
- Add a small versioned synthetic policy/retrieval dataset with positive, no-evidence, conflicting-version, and malicious-instruction cases.
- Replace the single marksheet-shaped result as the V2 cross-category contract with a discriminated document-type result registry: shared envelope plus one validated schema per explicitly approved type. Preserve the existing marksheet API contract through an adapter/versioning plan; do not silently break current consumers. Unknown type and schema-validation errors must abstain with evidence retained.
- Add category-specific extraction prompts/parsers and field provenance (page/region or OCR excerpt) as separate strategies behind the registry. Never reuse one document's schema/prompt/rules for another type. Each newly enabled category gets synthetic clean/missing/ambiguous/poor-scan fixtures and type-confusion tests before it becomes selectable as supported.
- Add synthetic type-confusion evaluations: marksheet sent as birth certificate and vice versa, identity card mistaken for marksheet, unsupported certificate, mixed multi-document case, and uncertain auto-classification. Assert no fields leak across schemas and uncertainty routes to a reviewer.
- **Acceptance:** deterministic retrieval tests; mocked embedding/generation tests; evaluate retrieval precision/recall at a declared k and citation correctness on the synthetic set. Only report measured output. Commands proposed: `python -m pytest services/agent/tests` and a documented focused evaluation command writing actual artifacts under `eval/results/` (never fabricate results).
- **Gate:** Reviewed under the owner's instruction to proceed sequentially; proceed to Stage D. Additional document categories remain marksheet-only until separately scoped with category-specific schemas and synthetic fixtures.

### Stage D — Bounded agent and deterministic verification

**Status: PASS (2026-10-22).** The bounded orchestration core is implemented and its Python acceptance suite passed. Express/API persistence and reviewer UI integration remain Stage E.

- Add one bounded orchestration layer in `services/agent`, reusing existing extraction/validation and worker interfaces.
- Define a typed explicit allowlist mapped to existing functions where possible: retrieve policy, inspect extracted evidence, required-field checks, marks-total/percentage checks only when inputs/rules support them, field comparisons, and structured finding creation. No arbitrary SQL, shell, code execution, unrestricted network, or model-selected tool names.
- Define enforceable maximum tool calls, wall-clock budget, retry count, response size, and safe error behavior. Handle malformed model output, rate limits, timeouts, retrieval/tool failures, duplicate requests, and partial results by recording uncertainty and routing to review.
- Store minimal, privacy-conscious run metadata, tool names/outcomes, source references, and errors. Avoid unnecessary OCR/document text in traces and redact credentials/internal details.
- Keep model output advisory. Deterministic rules and/or authorized human reviewers control decisions; no automated authenticity/fraud verdict or rejection.
- **Acceptance:** isolated tests for tool allowlist and budget enforcement, deterministic rule results, prompt injection, malformed output, timeout/rate-limit, retries, duplicate jobs, trace redaction, and abstention. Mock all model calls in ordinary tests.
- Add case-scoped context assembly with strict applicant/document ownership boundaries. The assistant may summarize progress across that case's documents but must cite which document and evidence supports each finding; test cross-case isolation and one-document failure while sibling documents continue.
- **Gate:** Review agent contract, trace schema, and safeguards before Stage E.

**Recorded acceptance:** `python -m pytest services/agent/tests -q -p no:cacheprovider --basetemp=.pytest-tmp` — **86 passed, 6 dependency deprecation warnings**. `cd apps/api && npm run build` — passed. `cd apps/web && npm run build` — passed. `cd apps/api && npm test` could not complete because the configured Neon hostname did not resolve (`getaddrinfo ENOTFOUND`); the suite's database integration tests were skipped after setup failure. This is an environment/connectivity limitation, not a passing API test result.

### Stage E — API/database and reviewer UI integration

**Status: PASS (2026-10-22).**

- [x] Add additive migration `006_agent_runs.sql` for reviewer role, case assistant run/finding/trace records and indexes.
- [x] Add owner-authenticated Express `POST /applications/:id/agent-runs`; it gathers only that case's completed documents and checks; add a token-protected private FastAPI endpoint and do not expose direct unauthenticated case-agent calls.
- [x] Persist case-run summary, findings, policy answer citations, redacted tool timeline, and audit event separately from human review records.
- [x] Require reviewer role on reviewer queue/detail/decision routes. New accounts default to applicant; development reviewer role is assigned through controlled database administration.
- [x] Extend reviewer detail with case assistant controls, summaries, policy citations/version/excerpts, and trace timeline.
- [x] `cd apps/api && npm run build` — passed.
- [x] `cd apps/web && npm run build` — passed.
- [x] Focused agent endpoint/runner tests — **21 passed, 5 dependency deprecation warnings**; full agent suite after integration — **88 passed, 6 dependency deprecation warnings**.
- [x] `cd apps/api && npm test` — **5 passed** against a disposable `docflow_test_*` Neon schema. One initial run exposed missing synthetic `name` fields in old fixtures; fixtures were corrected and the rerun passed.
- [x] `cd apps/api && npm run build` — passed.
- [x] `cd apps/web && npm test` — **2 passed**.
- [x] `cd apps/web && npm run build` — passed.
- [x] Applied the additive migration to the approved development Neon public schema and confirmed the three `verification_*` tables and `users.role` exist. No production database was touched.

- Add only the persistent verification run, finding, and trace records not already represented; use additive reversible migrations where practical, proper foreign keys/unique keys, transactions, and indexes.
- Add authenticated, object-scoped API access through Express. The Python service remains processing-only and must not expose a public unauthenticated verification route. Preserve existing API contracts or document a compatibility versioning strategy first.
- Extend current reviewer screens to show extracted evidence, rule outcomes, policy citations/excerpts/version, agent tool timeline, missing/uncertain states, and human decision/audit history. Add explicit loading, empty, error, and retry states.
- Only add policy ingestion/admin UI if a documented authorized administrator role and access model are established; otherwise use a controlled local ingestion command for synthetic policy fixtures.
- Clearly label synthetic policy demonstrations, automated findings, and human decisions. Never show “authentic/genuine” based on model output.
- **Acceptance:** API/UI tests for ownership/role authorization, document scoping, citation rendering, no-evidence behavior, error handling, decision/audit separation, and no sensitive data in logs/events. Run `cd apps/api && npm test`, `cd apps/api && npm run build`, `cd apps/web && npm test`, `cd apps/web && npm run build`, and `python -m pytest services/agent/tests` as applicable. Report actual results.
- **Gate:** Review end-to-end synthetic workflow before Stage F.

### Stage F — Security, reliability, evaluation, and demo readiness

**Status: PASS (2026-10-22).** A code-level threat review is recorded in `docs/SECURITY_REVIEW.md`. The 100-document simulator acceptance completed against local services and the development Neon database using generated synthetic PDFs and a synthetic account. Gemini/Groq keys were disabled in worker processes for this run, so it evaluates local OCR/rules and API/worker flow only.

- [x] Code-level threat review documented trust boundaries, access controls, privacy limits, and non-deployment gaps.
- [x] Error content is redacted from API logs and worker failure records; missing/invalid internal-token, wrong-owner, unavailable-service, and timeout responses have synthetic tests.
- [x] RAG mechanics evaluation output from Stage C remains saved in ignored `eval/results/rag/summary.json`; values are limited to its generated synthetic fixture set.
- [x] Run `python -m pytest services/agent/tests -q -p no:cacheprovider --basetemp=.pytest-tmp` — **88 passed, 6 dependency deprecation warnings**.
- [x] Run `cd apps/api && npm test` — **5 passed**; `npm run build` — passed.
- [x] Run `cd apps/web && npm test` — **2 passed**; `npm run build` — passed.
- [x] Verify `.env`, `eval/data`, and `eval/results` are ignored and `.env`/generated files are not tracked.
- [x] Native Tesseract 5.5.3.20260724 check on a synthetic image extracted both expected labels.
- [x] `node --env-file=.env eval/simulator/run.js --count 100 --seed 2027 --rate-per-second 2 --timeout-seconds 300 --output eval/results/realtime-stagef-20261022.csv` — **100 submitted, 100 completed, 100% completion, median decision 62,832 ms, p95 94,897 ms, 0 failures, 0 retries, 96 answer-match cases evaluated, 100% answer match**. Metrics are synthetic-only; four records were not evaluable for the configured answer-match fields. The worker ran without Gemini/Groq credentials.
- [x] The actual result CSV has 100 rows and remains ignored under `eval/results/`.

- Threat-model authentication/roles, object access, document storage, worker/API boundaries, SSE, policy ingestion, retrieval, traces, retention/deletion, backups, and operational monitoring. Keep public access to local document paths and unauthenticated network processing disabled.
- Add reliability controls and documented setup for supported local synthetic demo operation. Deployment remains a separate explicit authorization and must stay synthetic-only; no paid resources without approval.
- Expand a versioned synthetic evaluation set: clean, missing fields, wrong totals, conflicting fields, poor OCR, unsupported policy question, conflicting/outdated policies, embedded prompt injection, model timeout/rate limit, duplicate jobs, and repeated tool failures.
- Include multi-document cases with missing/duplicate/wrong file types, corrupt/password-protected/oversized files, page and image pixel limits, mixed text/scanned PDFs, partial OCR, repeated uploads/idempotency, transient Gemini failures, Tesseract unavailable/timeout, queue retries, per-document partial failure, case isolation, and reviewer correction cycles. Define accepted formats and per-file limits from actual API behavior before promising broader format support.
- Measure only applicable observed values: extraction fields, retrieval precision/recall at k, citation correctness/coverage, deterministic check outcomes, false positives/negatives, unsupported response rate, review rate, latency, and API usage. State dataset/version/limitations; no real-world accuracy or authenticity probability claims.
- Compare OCR candidates only on the same versioned synthetic scans with known answer keys: current Tesseract, optionally PaddleOCR after approval/installation, and Gemini only as the configured fallback. Report OCR character/word error and per-field exact/normalized match separately by document type, plus fallback frequency and review rate. Do not infer authenticity from any OCR score. No public personal-document dataset may be added to repository fixtures.
- Complete or explicitly defer the pre-existing Phase 6 live simulator acceptance run only with configured local services and synthetic credentials, and save real output under ignored `eval/results/`.
- **Acceptance:** all relevant Python/API/web/simulator commands from `docs/tasks.md`, security tests, no staged secrets/generated data, and documented results. Do not run paid API evaluations without owner approval.
- **Gate:** Owner review of measured results and demo limitations. This gate does not imply production readiness.

### Stage G — Documentation and V2 release candidate

**Status: IN PROGRESS (2026-10-22).**

- Reconcile `README.md`, `docs/PLAN.md`, `docs/tasks.md`, environment examples, and this plan with implemented evidence. Resolve the current Phase 7 status contradiction based on owner-approved history.
- Document setup, synthetic policy source lifecycle, embedding model/dimension and re-index procedure, tool budgets, evaluation commands/results, operational limits, and known gaps.
- Verify Git status, ignored `.env` and generated data, migration order, and reproducible synthetic setup. No commit or deployment unless separately requested/authorized.
- **Acceptance:** clean documented setup from a fresh environment, all approved checks passing, real results saved, no secrets tracked, and clear non-production/synthetic-only scope.
- **Gate:** Owner accepts V2 plan completion and separately decides any future deployment or document-category expansion.

## 4. Decisions needed from owner before dependent stages

1. Approve or revise this staged plan; Stage A approval alone is not permission to implement every stage.
2. Confirm whether V2 begins marksheets-only with the case workflow and then adds organization-specific document categories one at a time. Requested types may include marksheets, birth certificates, Aadhaar/other identity cards, caste/category, EWS, fee receipts, nationality, domicile, and income certificates, but each type and organization's rules must be explicitly scoped; no universal or official rule should be invented. Do not claim these types are currently supported.
3. **Resolved for Stage B:** the connected Neon database is the development/test branch; the owner approved enabling `pgvector` and additive dev migrations. Do not infer approval for production.
4. **Resolved for current implementation:** use existing Gemini for embeddings with synthetic content; default tests remain mocked and network-free. Broader or repeated live evaluation still requires review of its scope/cost.
5. Confirm the policy corpus owner/source and how synthetic demonstration rules should be distinguished from authoritative policy. Until approved, use only clearly labelled synthetic policy samples.
6. Confirm whether policy ingestion is maintainer-only via CLI or needs an authenticated UI and role model.
7. **Resolved in Stage F:** ran the 100-document seeded synthetic simulator against local services and the confirmed development Neon database. Gemini/Groq were disabled in worker processes; actual metrics and the scope limitation are recorded in `eval/results/realtime-stagef-20261022.csv` and `docs/tasks.md`.
8. Confirm the GitHub expectation. Local branch tracking `origin/main` is observed, but connector authentication, remote permissions, and CI checks have not been verified. No remote write or GitHub operation is included in this plan.

## 5. Windows Tesseract fallback setup (manual operator steps)

Tesseract is a separate native OCR program; installing the Python `pytesseract` package alone does not install that executable. The repository already pins `pytesseract`, and current local OCR code expects the executable on `PATH`. The upstream Tesseract download page points Windows users to the UB Mannheim builds because it does not provide a current official Windows installer. See [Tesseract download guidance](https://tesseract-ocr.github.io/tessdoc/Downloads.html) and the [UB Mannheim Windows installer page](https://github.com/UB-Mannheim/tesseract/wiki).

If Gemini is down and the owner wants to enable local OCR on this Windows development machine, follow these steps (no credentials required):

1. Open the Tesseract download guidance above and follow its Windows link to UB Mannheim. Download the current 64-bit installer from that publisher; avoid third-party download sites.
2. Run the installer. Keep English language data selected (add other required languages through the installer only when the use case is approved). Note the install folder; the common default is `C:\Program Files\Tesseract-OCR`.
3. Add the install folder containing `tesseract.exe` to the Windows `Path` environment variable if the installer did not do so. Close and reopen PowerShell/VS Code terminals so they receive the updated `Path`.
4. In a new PowerShell terminal, verify the native program and language data:

   ```powershell
   tesseract --version
   tesseract --list-langs
   ```

   Confirm `eng` is listed. If `tesseract` is not found, add the actual installation folder to `Path` or configure `pytesseract.pytesseract.tesseract_cmd` to the full `tesseract.exe` path in application configuration (a future approved code change; do not edit installed package files).
5. From the repository root, activate the project virtual environment and install the existing agent requirements if needed:

   ```powershell
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r services/agent/requirements.txt
   python -c "import pytesseract; print(pytesseract.get_tesseract_version())"
   ```

6. Current OCR code has a 30-second invocation limit and 4-million-pixel image bound. The implemented processing order is Tesseract/local extraction first, followed by Gemini Vision only when local OCR or extraction fails or yields no supported labelled marksheet fields, then Groq text fallback only when OCR text exists. If no path provides useful evidence, partial evidence is preserved and routed to review.

Do not put Tesseract binaries or language data into the repository. For deployment, install the native package in the service image/runtime under a separately approved deployment stage, and record its version and language data. Local installation alone does not make a hosted service use your machine's executable.

## 6. Cross-stage engineering constraints

- Synthetic names, identifiers, documents, policies, and evaluation data only. Generated artifacts remain in ignored `eval/data/`; run results remain in ignored `eval/results/` unless a later approved policy says otherwise.
- Do not read, paste, log, or commit `.env` secrets. Keep `.env.example` placeholder-only; reuse current variable names when applicable.
- Preserve Git history, uncommitted user changes, current routes/contracts, migrations, and existing features. Never reset/clean/rewrite history or recreate a database.
- Any database schema change is additive and tested in a disposable schema first. No production data modification.
- Use a single bounded agent, allowlisted tools, explicit budgets, and deterministic verification. The LLM never makes final decisions.
- No authenticity/fraud claim, automatic rejection, invented official requirement, or fabricated performance metric.
- No paid service or cost-bearing API run without explicit approval.
- At every stage: summarize intended scope; implement only that stage; run its acceptance checks; report changed files, actual outputs, remaining risks, and required configuration; then stop for review.

## 7. Audit commands and status at plan creation

Read-only inspection performed: Git branch/status/log, checked-in documentation, package scripts, API routes, migrations, Python agent/worker/extraction modules, environment variable names (not values), and deployment-manifest presence. Tests/builds and live services were **not run** for this audit.

Useful checks for the next approved implementation stage:

```powershell
git status --short --branch
git log -1 --oneline
python -m pytest services/agent/tests
cd apps/api; npm test; npm run build
cd ../web; npm test; npm run build
node --test eval/simulator/run.test.js
```

## 8. Implementation progress (2026-10-22)

### Stage B substep: local OCR first, Gemini fallback

- Updated `services/agent/app/processing/pipeline.py` to run Tesseract for scanned images and image-only PDF pages before Gemini. Labelled local fields are extracted without a Gemini call; Gemini is called only after Tesseract failure or no supported labelled fields. Selectable PDF text stays local-first.
- Added labelled-field regex extraction in `services/agent/app/processing/extract.py` and Windows default executable discovery in `services/agent/app/processing/ocr.py` for `C:\Program Files\Tesseract-OCR\tesseract.exe` when Tesseract is not on PATH.
- This extraction parser is explicitly marksheet-only. Cross-category schema registry and type-specific extraction are planned separately; do not use this marksheet parser for birth certificates, Aadhaar/identity cards, receipts, or other categories.
- Added synthetic routing tests in `services/agent/tests/test_tesseract_first.py` for local success (no Gemini), missing Tesseract (Gemini fallback), and unusable OCR (Gemini fallback).
- Added applicant-versus-document marksheet checks for name, roll number, date of birth, board, year, and optional total. Decisions for this path come from deterministic field evidence; Gemini output does not determine the result. Missing evidence remains `missing`, differences route to `needs_review`, and no authenticity claim is made.
- Added pre-processing PDF structural/page-limit validation in the FastAPI `/process` route. Mixed text/scanned PDFs run OCR on scanned pages while preserving selectable text.
- Updated tests to reflect the approved Gemini fallback behavior and made a worker test result fixture conform to the current response schema; expected behavior was not weakened.
- **Focused result:** `python -m pytest services/agent/tests/test_validation.py services/agent/tests/test_pipeline.py services/agent/tests/test_tesseract_first.py services/agent/tests/test_processing_api.py::test_process_mixed_pdf_combines_selectable_text_and_scanned_ocr -q -p no:cacheprovider` — 11 passed, 5 dependency deprecation warnings.
- **Full agent acceptance:** `python -m pytest services/agent/tests -q -p no:cacheprovider --basetemp=.pytest-tmp` — 47 passed, 6 dependency deprecation warnings. `python -m compileall -q services/agent/app/processing` and `git diff --check` also completed without reported errors.
- **Substep result:** Tesseract-first marksheet extraction and Gemini fallback is implemented and included in the Stage B acceptance run.
- **Neon/Gemini prerequisite check:** the confirmed development Neon database reports PostgreSQL 18.6. The owner approved the extension and additive migration. pgvector `0.8.6` is installed in `public`; `005_policy_rag.sql` is applied in the development schema. One synthetic Gemini embedding was stored and checked in a disposable schema, which was then dropped.
- **Dataset/library finding:** no broad benchmark validates marksheets, birth certificates, Aadhaar, receipts, and all other target types together. MIDV-2020 offers mock identity documents useful for generic ID layout tests; FUNSD/SROIE/CORD cover forms or receipts, not certificate authenticity. The repo must continue using synthetic, per-type answer-key fixtures. Existing RapidFuzz can assist text comparison; JiWER is a candidate for OCR CER/WER; PaddleOCR is only a candidate alternative to benchmark against Tesseract on the same synthetic pages.
- **Neon capability check:** the owner confirmed the connected Neon database is a dev/test branch safe for additive changes. `vector` version `0.8.6` was enabled explicitly in `public`; no existing application data was modified.

### Stage B substep: synthetic policy ingestion foundation

- Added `apps/api/src/migrations/005_policy_rag.sql` with source/version records, context metadata, lifecycle status, content hashes, and `public.vector(3072)` chunks. Existing migrations remain additive and the embedding model is constrained to `gemini-embedding-001`.
- Added `services/agent/app/policies.py` for normalized deterministic chunking, synthetic-only source validation, embeddings, atomic persistence, idempotent same-version ingestion, changed-content conflict rejection, version superseding, and explicit obsolete status.
- Added `services/agent/app/policy_cli.py` for maintainer-controlled JSON ingestion and `--dry-run`. Added clearly invented demo input at `docs/examples/synthetic_marksheet_policy.json`.
- Added unit coverage for chunk limits/normalization, persistence/idempotency, immutable versions, version lifecycle, obsolete handling, invalid source/embedding values, and rejection of authoritative content in this stage.
- Neon migration check in a temporary schema found `policy_sources`, `policy_chunks`, and `public.vector(3072)`; that schema was dropped afterward and the shared extension remained at `0.8.6`.
- One synthetic end-to-end Gemini/Neon ingestion stored one chunk with a 3072-dimensional vector in a temporary schema; the schema and data were dropped afterward. No real applicant data or external policies were used.
- **Acceptance:** `python -m pytest services/agent/tests -q -p no:cacheprovider --basetemp=.pytest-tmp` — 59 passed, 6 dependency deprecation warnings (2026-10-22). `python -m services.agent.app.policy_cli docs/examples/synthetic_marksheet_policy.json --dry-run` — `dry_run=ok`, one chunk, max 497 characters. `python -m compileall -q services/agent/app/policies.py services/agent/app/policy_cli.py` and `git diff --check` completed without errors (Git only reported line-ending normalization warnings).
- Disposable Neon migration check verified both policy tables and `public.vector(3072)`, then dropped the temporary schema. The additive migration was also applied through the existing migration runner to the approved dev database's `public` schema; both tables are present and pgvector is `0.8.6`.
- One synthetic Gemini-to-Neon ingestion stored one chunk with 3072 dimensions in a disposable schema; the schema and test data were dropped afterward. No applicant records or external policy text were used.
- **Stage B result:** PASS. The owner subsequently authorized sequential implementation through the remaining stages; Stage C has now passed acceptance.
- **Groq note:** Stage D implements the requested text-only Groq fallback after Tesseract/Gemini. The supplied model does not take images, so empty OCR cannot be repaired by this fallback. Keep usage on the owner's free-tier account.

### Stage C — Grounded retrieval acceptance (2026-10-22)

- Added `services/agent/app/retrieval.py` with same-model query embeddings, exact pgvector cosine ranking, workflow/document type/organization/jurisdiction/effective-date filters, active-version filtering, top-k and a fail-closed configurable threshold. Retrieval returns source/version/chunk, excerpt, section when present, relevance, model metadata, and abstention reason.
- Added a Gemini answer path whose evidence is treated as untrusted data. The answer must cite only retrieved passage IDs; malformed output, fabricated citations, provider errors, or insufficient matches abstain while retaining retrieved evidence for review. Retrieval and generated explanations do not alter deterministic validations or case decisions.
- Added `services/agent/app/processing/schemas.py` and an additive `typed_payload` field to the existing processing response. The current typed registry is `marksheet.v1`; unsupported categories are rejected/abstained instead of being coerced into marksheet fields. Existing result fields remain for compatibility.
- Added deterministic synthetic fixtures for positive queries, no-evidence queries, superseded/current versions, and embedded prompt-injection text. `eval/rag/generate_fixtures.py` writes fixture data and labels under ignored `eval/data/rag/`; `eval/rag/run_eval.py` writes actual run output under ignored `eval/results/rag/`.
- The database keeps exact cosine search over `vector(3072)` rather than an approximate index: pgvector documents `vector` ANN index support up to 2,000 dimensions, while the chosen embedding is 3,072 dimensions. Exact search is suitable for the present small synthetic corpus; scale characteristics need a later measured review. [pgvector docs](https://github.com/pgvector/pgvector).
- The initial relevance cutoff is `0.55`, an unvalidated engineering setting, not a semantic accuracy guarantee. The retrieval evaluation uses deterministic fixture vectors to test filtering, version lifecycle, abstention, and citation mechanics; it does not measure Gemini semantic retrieval quality.
- **Focused tests:** `python -m pytest services/agent/tests/test_retrieval.py services/agent/tests/test_policies.py services/agent/tests/test_policy_cli.py -q -p no:cacheprovider --basetemp=.pytest-tmp` — 22 passed.
- **Full agent acceptance:** `python -m pytest services/agent/tests -q -p no:cacheprovider --basetemp=.pytest-tmp` — 69 passed, 6 dependency deprecation warnings in 57.75s.
- **Synthetic Neon RAG evaluation:** `python -m eval.rag.run_eval` — 3 positive queries; precision@3 `0.667`; recall@3 `1.000`; both no-evidence cases abstained; all cited IDs were valid; superseded version excluded. Output: ignored `eval/results/rag/summary.json`. This is a small mechanics-only evaluation, not real-world or semantic quality.
- **Stage C result:** PASS. **Stage D result:** PASS. **Stage E result:** PASS. **Stage F result:** PASS. Stage G documentation/release-candidate checks are in progress.

### Stage G follow-up: document-specific result contract

- The upload UI now requires a category for each file and sends it as `X-Document-Type`; the API persists that category and the worker passes it to the Python pipeline.
- Each per-file API response separates `application_id`/`document_id`, category, page count, processing state, timestamps, and evidence references from the result payload. Completed files keep individual typed data, validations, provenance, OCR evidence, and decisions. Case status aggregates all jobs, so a verified file cannot mark an in-progress or review-needed case verified.
- `marksheet.v1` remains the only supported typed schema and now includes academic identifiers, exam/session, subjects, marks, totals, result, grade, and division. Birth certificates, identity cards, unknown types, and other unsupported categories preserve OCR/page references and return `needs_review` without marksheet extraction or rules. Strong OCR title conflicts with the selected category also route to human classification. No authenticity or fraud verdict is produced.
- **Acceptance:** `python -m pytest services/agent/tests eval/test_run_eval.py -q -p no:cacheprovider --basetemp=.pytest-tmp` — 93 passed, 6 dependency deprecation warnings. `cd apps/api && npm test` — 5 passed; `npm run build` — passed. `cd apps/web && npm test` — 2 passed; `npm run build` — passed. `node --test eval/simulator/run.test.js` — 8 passed.
- Stage G remains in progress: a clean setup from a fresh environment and owner review of release-candidate limits have not been completed. No commit or deployment was made.

