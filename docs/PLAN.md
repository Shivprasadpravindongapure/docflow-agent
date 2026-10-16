# DocFlow Agent: Project Overview

## Goal

Build a document submission and human-review workflow that can be exercised end to end using synthetic applicants and synthetic documents only. The owner has requested a future target scope covering marksheets, caste/category certificates, EWS certificates, fee receipts, nationality certificates, domicile certificates, and income certificates. This is a planning decision, not implementation authorization: the current supported V1 remains marksheets only until each additional category has approved field definitions, validation rules, synthetic fixtures, and acceptance criteria.

“Live” means processing requests through the running application; it never authorizes real student/applicant data in this repository's development, testing, or evaluation.

## Agreed architecture

- **Web:** React, Vite, TypeScript, Tailwind.
- **Application API and database access:** Node.js, Express, TypeScript, PostgreSQL/Neon.
- **Processing agent and worker:** Python/FastAPI in `services/agent`. It handles PDF text extraction/page rendering, OCR, schema-constrained extraction, deterministic validation, and queued document processing. Rules and human reviewers determine outcomes; the LLM does not make the final decision.
- **Synthetic PDF generator:** Python/reportlab under `eval/pdf`.
- **Live traffic simulator:** Node.js under `eval/simulator`.
- **Data and metrics:** generated synthetic inputs under ignored `eval/data/`; run outputs under `eval/results/`.

## Python agent service contract

`GET /health` returns `{"status":"ok","service":"agent"}`. `POST /extract` accepts a synthetic PDF upload up to 2 MB and at most 5 pages. It returns page count, text per page where selectable text exists, and PNG page images for image-only/scanned pages. `POST /process` accepts a synthetic PDF, PNG, or JPEG and application fields, runs OCR or reads selectable PDF text, extracts supported marksheet fields, applies deterministic rules, and returns explainable field evidence, a review state, and stage timings. Uploads are processed in memory. This processing route is unauthenticated and local-only; do not expose it or send it real student records. Keep authentication and applicant-facing APIs in Express.

## Data and decision safeguards

- Use synthetic names, numbers, images, and PDFs only; do not load real student records.
- Keep generated files and answer keys under `eval/data/`, which must remain gitignored.
- Mark planted mismatches in the answer key and report valid and mismatched documents separately.
- Every validation flag includes `field`, `expected`, `extracted`, and `reason`.
- Rule-based checks can report extracted values and consistency with applicant-provided information; they cannot establish that an issuer created a document or that it is genuine.
- Never expose a percentage as a probability of authenticity or fraud. Any future extraction/validation metric must be measured on the synthetic evaluation set, state exactly what it measures, and must not be described as real-world accuracy.
- Return explainable processing states such as `verified`, `needs_review`, or `missing`; the system does not auto-reject, detect fraud, or make final eligibility decisions. A human reviewer is responsible for consequential decisions.
- Report only measurements from committed evaluation output files; label synthetic metrics as synthetic and avoid claiming real-world accuracy.
- Use environment variables for credentials; never commit secrets or generated data.
- Stay on free-tier services; ask before adding any paid service.
- Keep the processing API private and authenticated before deployment; add role-based authorization, private storage, encryption, retention/deletion rules, audit controls, backup/restore checks, and operational monitoring before considering any real-world pilot outside this synthetic-only repository.

## Delivery plan

The authoritative phase-by-phase task list, file scope, acceptance commands, and stop points are in [tasks.md](tasks.md). Phases 1 through 5 are complete. Phase 6's simulator implementation and mocked tests exist, but the live 100-document acceptance run is pending. The proposed next phases are:

1. Finish Phase 6 with a measured synthetic run.
2. Build Phase 7 applicant multi-document submission/status and reviewer screens. Keep actual supported processing marksheet-only until category-specific scope is approved.
3. Use Phase 8 for security/privacy controls and deployment readiness; do not deploy publicly while unauthenticated processing routes or missing safeguards remain.
4. Use Phase 9 for category-by-category synthetic fixtures/rules, evaluation, and final documentation. Additional document categories in the requested target scope must not be treated as implemented by this plan update.

Work strictly one phase at a time. The owner approved only this planning/documentation update, not implementation of the next phase. At every phase boundary, stop and report actual command output; do not proceed until separately authorized.

## Repository alignment note

The applicant-facing Express API remains TypeScript; Python processing lives in `services/agent`. Do not create a separate `services/pdf` service. The Node simulator is in `eval/simulator`; its live acceptance run remains pending. The referenced `docs/DocFlow-Python-PDF-Plan.pdf` was not found in the repository during planning; the tasks were derived from the plan text supplied by the owner. Add the original PDF before treating it as a checked-in source document.
