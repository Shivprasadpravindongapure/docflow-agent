# DocFlow Agent: Project Overview

## Goal

Build a live marksheet submission and review workflow that can be exercised end to end with synthetic applicants and synthetic documents. Processing is synchronous/asynchronous as appropriate for the service, but “live” never means using real student data for development, testing, or evaluation.

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
- The system returns `verified`, `needs_review`, or `missing`; it never auto-rejects.
- Report only measurements from committed evaluation output files; label synthetic metrics as synthetic and avoid claiming real-world accuracy.
- Use environment variables for credentials; never commit secrets or generated data.
- Stay on free-tier services; ask before adding any paid service.

## Delivery plan

The authoritative phase-by-phase task list, file scope, acceptance commands, and stop points are in [tasks.md](tasks.md). Complete phases 1 through 9 in order, one phase per owner approval. No feature phase begins until the owner approves the plan. At every phase boundary, stop and report the real command output; do not proceed until told “next phase.”

## Repository alignment note

The applicant-facing Express API remains TypeScript; Python processing lives in `services/agent`. The repository's previous Python evaluation utility is not the planned Node traffic simulator; the simulator remains a future phase. Do not create a separate `services/pdf` service. The referenced `docs/DocFlow-Python-PDF-Plan.pdf` was not found in the repository during planning; the tasks were derived from the plan text supplied by the owner. Add the original PDF before treating it as a checked-in source document.
