# Project Decisions

| Decision | Status | Date | Notes |
|---|---|---|---|
| Use a Python agent service in `services/agent` for document processing and worker duties, including PDF handling; keep the application API, simulator, and web application TypeScript. | Accepted by owner | 2026-10-14 | The Python agent handles PDF text extraction/rendering, OCR, extraction, validation, and job processing. The Express API owns applicant-facing routes and authentication. |
| Write the live-traffic simulator in Node.js/TypeScript. | Accepted by owner | 2026-10-14 | The simulator sends synthetic applications/documents through the live API and records measured timings. Credentials come from environment variables. |
| Use live end-to-end workflow tests with synthetic records only. | Accepted by owner | 2026-10-14 | Real student documents are out of scope for this repository's development, testing, and evaluation. |

## Decision changes

- 2026-10-14: Replaced the initially planned separate Python PDF-only utility and TypeScript processing worker with one Python document-processing agent. This change was requested and confirmed by the owner. A standalone `services/pdf` service is not part of the target architecture.
