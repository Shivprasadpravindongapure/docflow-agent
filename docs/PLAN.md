# DocFlow Agent: Project Overview

## Goal

Build a document submission and human-review workflow that can be exercised end to end using synthetic applicants and synthetic documents only. The owner has requested a future target scope covering marksheets, birth certificates, identity cards, caste/category certificates, EWS certificates, fee receipts, nationality certificates, domicile certificates, and income certificates. This is a planning decision, not implementation authorization: marksheets remain the only supported verification category until each additional category has approved field definitions, validation rules, synthetic fixtures, and acceptance criteria.

“Live” means processing requests through the running application; it never authorizes real student/applicant data in this repository's development, testing, or evaluation.

## Agreed architecture

- **Web:** React, Vite, TypeScript, Tailwind.
- **Application API and database access:** Node.js, Express, TypeScript, PostgreSQL/Neon.
- **Processing agent and worker:** Python/FastAPI in `services/agent`. It handles PDF text extraction/page rendering, OCR, schema-constrained extraction, deterministic validation, and queued document processing. Rules and human reviewers determine outcomes; the LLM does not make the final decision.
- **Synthetic PDF generator:** Python/reportlab under `eval/pdf`.
- **Live traffic simulator:** Node.js under `eval/simulator`.
- **Data and metrics:** generated synthetic inputs under ignored `eval/data/`; run outputs under `eval/results/`.

## Python agent service contract

`GET /health` returns `{"status":"ok","service":"agent"}`. `POST /extract` accepts a synthetic PDF upload up to 2 MB and at most 5 pages. It returns page count, text per page where selectable text exists, and PNG page images for image-only/scanned pages. `POST /process` requires an explicit document type with a synthetic PDF, PNG, or JPEG and application fields. It reads selectable text and uses local OCR, returns shared page/evidence metadata separately from a versioned type-specific payload, records field provenance, and runs only the selected type's configured rules. Marksheets are currently the only supported verification category. Unsupported, unknown, or OCR-conflicting types preserve page/OCR evidence and route to `needs_review` without marksheet rules. Uploads are processed in memory. This processing route is unauthenticated and local-only; do not expose it or send it real student records. Keep authentication and applicant-facing APIs in Express.

## Data and decision safeguards

- Use synthetic names, numbers, images, and PDFs only; do not load real student records.
- Keep generated files and answer keys under `eval/data/`, which must remain gitignored.
- Mark planted mismatches in the answer key and report valid and mismatched documents separately.
- Every validation flag includes `field`, `expected`, `extracted`, and `reason`.
- Every upload has an explicit category and an independent per-file envelope/result. Shared OCR/file checks do not imply type-specific checks passed; cross-document comparisons require an explicitly authorized rule with both source references.
- Rule-based checks can report extracted values and consistency with applicant-provided information; they cannot establish that an issuer created a document or that it is genuine.
- Never expose a percentage as a probability of authenticity or fraud. Any future extraction/validation metric must be measured on the synthetic evaluation set, state exactly what it measures, and must not be described as real-world accuracy.
- Return explainable processing states such as `verified`, `needs_review`, or `missing`; the system does not auto-reject, detect fraud, or make final eligibility decisions. A human reviewer is responsible for consequential decisions.
- Report only measurements from committed evaluation output files; label synthetic metrics as synthetic and avoid claiming real-world accuracy.
- Use environment variables for credentials; never commit secrets or generated data.
- Stay on free-tier services; ask before adding any paid service.
- Keep the processing API private and authenticated before deployment; add role-based authorization, private storage, encryption, retention/deletion rules, audit controls, backup/restore checks, and operational monitoring before considering any real-world pilot outside this synthetic-only repository.

## Delivery plan

The authoritative phase-by-phase task list, file scope, acceptance commands, and stop points are in [tasks.md](tasks.md). Phases 1 through 5 and 7 are recorded complete. Phase 6's live synthetic 100-document run passed (100 completed; measurements are documented in `docs/tasks.md`). V2 Stages B-F passed recorded checks. Stage G documentation/release-candidate checks are underway.

1. Complete Stage G's clean setup and owner review of the documented V2 release-candidate scope; no public deployment.
2. Keep current document processing marksheet-only. Each additional category requires its own schema, extraction behavior, deterministic rules, synthetic fixtures, and acceptance evaluation.

Work one stage at a time and report actual command output at each stage boundary. The owner has authorized sequential work through the remaining V2 stages.

## Repository alignment note

The applicant-facing Express API remains TypeScript; Python processing lives in `services/agent`. Do not create a separate `services/pdf` service. The Node simulator is in `eval/simulator`; its live acceptance run remains pending. The referenced `docs/DocFlow-Python-PDF-Plan.pdf` was not found in the repository during planning; the tasks were derived from the plan text supplied by the owner. Add the original PDF before treating it as a checked-in source document.
