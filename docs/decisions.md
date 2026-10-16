# Project Decisions

| Decision | Status | Date | Notes |
|---|---|---|---|
| Use a Python agent service in `services/agent` for document processing and worker duties, including PDF handling; keep the application API, simulator, and web application TypeScript. | Accepted by owner | 2026-10-14 | The Python agent handles PDF text extraction/rendering, OCR, extraction, validation, and job processing. The Express API owns applicant-facing routes and authentication. |
| Write the live-traffic simulator in Node.js/TypeScript. | Accepted by owner | 2026-10-14 | The simulator sends synthetic applications/documents through the live API and records measured timings. Credentials come from environment variables. |
| Use live end-to-end workflow tests with synthetic records only. | Accepted by owner | 2026-10-14 | Real student documents are out of scope for this repository's development, testing, and evaluation. |
| Plan a future multi-document applicant/reviewer workflow covering marksheets, caste/category, EWS, fee receipt, nationality, domicile, and income documents. | Accepted for planning only | 2026-10-16 | This does not change current implementation scope or authorize code changes. V1 remains marksheets-only until additional categories are separately scoped with fields, rules, synthetic fixtures, and acceptance tests. Keep all repository development, testing, and evaluation synthetic-only. No authenticity/fraud verdict, automatic rejection, or unvalidated confidence percentage. |

## Decision changes

- 2026-10-14: Replaced the initially planned separate Python PDF-only utility and TypeScript processing worker with one Python document-processing agent. This change was requested and confirmed by the owner. A standalone `services/pdf` service is not part of the target architecture.
- 2026-10-16: Recorded the owner's requested future multi-category workflow as a planning target only. Current marksheet-only behavior and synthetic-only development/testing/evaluation safeguards remain in force; this update does not authorize implementation.
