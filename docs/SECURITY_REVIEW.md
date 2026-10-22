# DocFlow security review (synthetic development scope)

**Reviewed:** 2026-10-22. **Scope:** current local/development architecture only. This review does not approve deployment or real applicant data.

## Data and trust boundaries

- Assets include account credentials and sessions, application form values, uploaded documents, OCR/extraction output, policy source text/embeddings, verification findings, and audit/reviewer records.
- Browser requests use bearer sessions held in browser memory and terminate at the Express API. The API scopes applicant case reads/writes by `applications.user_id`; reviewer routes require `users.role='reviewer'`.
- Express talks to PostgreSQL using `DATABASE_URL`. The Python worker reads locally stored uploads and writes jobs/results to the same database.
- The owner-scoped Express assistant route sends extracted payloads and deterministic validations to the private FastAPI route. The service route requires the shared `DOCFLOW_INTERNAL_TOKEN`; it does not accept browser authorization as service authorization.
- Gemini receives document images/OCR where the existing extraction fallback requires it. Groq receives only OCR text and is called only after Gemini when that text exists. Policy embeddings and generation use Gemini. Keep only synthetic inputs in these remote calls.

## Controls verified in this stage

- API session token hashes are stored in PostgreSQL; plain session tokens are not persisted. The browser keeps bearer tokens in memory.
- Applicant application/result/document/audit access checks case ownership. An API integration test verifies a different user cannot start an assistant run for another case.
- Reviewer queue/detail/review routes require the persisted reviewer role. New accounts default to applicant; a development database administrator must deliberately promote reviewers.
- Upload API limits requests to 2 MB, accepts PDF/PNG/JPEG only, checks basic signatures, writes files under the ignored upload directory, and serves them only after owner checks.
- Agent calls use one fixed internal route, a shared secret, a 27-second API timeout, a 25-second planner/tool budget, a six-call limit, and no retries to Groq.
- Run/finding/trace records are inserted transactionally with foreign keys. Tool traces omit document contents and field values. Audit records keep run ID/status/count rather than the user's question or OCR text.
- API error logs and worker failure records now store exception class names instead of raw error messages. The SSE stream emits status metadata only.
- `.env` and generated `eval/data` are ignored; no real applicant data is permitted in test fixtures.

## Known gaps and operating limits

- Do not expose the FastAPI `/process` or `/extract` routes publicly. They retain the local synthetic development contract; the worker uses the Python pipeline directly. No deployment is authorized.
- Reviewer role is global. The repository has no organization/tenant membership model or organization-scoped policy access yet; reviewer privileges must be limited to trusted local synthetic accounts.
- No login throttling, MFA, password reset, reviewer administration UI, user-requested document deletion, retention scheduler, tested backup/restore, or incident monitoring is implemented.
- Local upload files are not encrypted by this repository. Cloud database encryption behavior and local backup handling were not independently assessed. No real records may be used.
- Basic file signatures are not malware scanning. PDFs are bounded/parsed in the processing service, but hostile-file scanning and sandbox isolation are not implemented.
- The shared service token is stored in ignored local `.env` for this development setup. Production secret distribution/rotation and private networking are not designed here.
- The live 100-document run used local Tesseract/rules and API/worker services with Gemini/Groq disabled. Its synthetic metrics do not describe model quality or real-world accuracy.
- This is a code/configuration review and test record, not a penetration test, legal review, compliance assessment, or production readiness certification.

## Safe operating position

Continue with synthetic data on local services only. Keep FastAPI on loopback, promote only synthetic reviewer accounts, protect `.env`, and do not publish the services or upload real student/applicant documents. Resolve tenant separation, retention/deletion, storage protection, authentication operations, and service networking before considering a controlled pilot.
