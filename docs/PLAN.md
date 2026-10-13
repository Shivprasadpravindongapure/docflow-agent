--
title: "DocFlow Agent: Complete Project Guide"
subtitle: "Problem, solution, tech stack, implementation, GitHub workflow, and agent prompts"
---
 
# 1. Overview
 
DocFlow Agent is an AI agent that verifies academic marksheets against an application form. It extracts fields with OCR and an LLM, checks them with explicit rules, flags mismatches with reasons, and keeps an audit trail so a staff member makes the final decision.
 
It is built by one person, uses only free tiers, and is designed to be deployed live and measured honestly.
 
**Important:** Use synthetic documents only. Never put real student records in the repo or in a cloud LLM.
 
# 2. The problem
 
Admissions and exam cells check each application's documents by hand. A reviewer opens each file, reads the fields, compares them with the form, and emails the student about anything missing.
 
| Pain point | Effect |
|---|---|
| Manual reading | 5 to 10 minutes per document (estimate; measure your own baseline) |
| Inconsistency | Different reviewers make different calls |
| No audit trail | Hard to explain why a file was accepted or rejected |
| Backlog | Peak admission weeks create long queues |
 
# 3. The solution
 
1. The applicant submits the form and uploads documents.
2. The agent preprocesses the image, runs OCR, and extracts fields with an LLM using a fixed JSON schema.
3. Rules compare the extracted fields with the form (fuzzy name match, exact roll number and DOB, valid marks range).
4. Each document gets one of three outcomes: verified, needs review, or missing. The agent never auto-rejects.
5. A reviewer sees the document, the extracted values beside the form values, the reasons for each flag, and approves or rejects.
6. Every step is written to an audit log.
## What makes it different from a generic tool
 
Commercial products such as DocuExprt already exist in this space. DocFlow's angle is:
- A self-hostable, open version for small colleges with no budget.
- Every flag explained with the field, expected value, extracted value, and reason.
- A published, reproducible evaluation on a synthetic test set.
Do not claim the idea is unprecedented. Claim the implementation and the measured results.
 
# 4. Scope
 
**Version 1 includes:** one document type (marksheet), applicant and reviewer roles, upload, extraction, validation, review queue, audit log, live deployment, evaluation.
 
**Version 1 excludes:** fraud or tamper detection, DigiLocker integration, multi-tenant SaaS, WebSockets, payments, more document types.
 
# 5. Tech stack
 
| Layer | Choice | Reason |
|---|---|---|
| Frontend | React (Vite), TypeScript, Tailwind CSS | Common in job listings |
| API | Node.js, Express, TypeScript | Auth, uploads, routes |
| Auth | JWT, bcrypt | Standard and simple |
| Agent | Node.js, Express, TypeScript | Good for OCR and LLM work |
| OCR | tesseract.js (Node wrapper for Tesseract) | Light enough for free hosting |
| Preprocessing | sharp (greyscale, normalize, threshold) | Replaces OpenCV/Pillow |
| LLM | Gemini API (free tier) with JSON schema output | Structured extraction |
| Validation | Plain TypeScript rules, string-similarity for names | Easy to test and explain |
| Database | PostgreSQL on Neon (free) | Relational data and audit log |
| Jobs | Database job table, `SELECT ... FOR UPDATE SKIP LOCKED` | No Redis needed |
| Files | Small files stored as bytea in Postgres | No second service |
| Testing | Vitest, supertest, one Playwright test | Covers each layer |
| Containers | Docker, Docker Compose | One-command local run |
| Hosting | Render (API and agent, free), Vercel (web, free) | Zero cost |
| CI | GitHub Actions | Free for public repos |
 
## Free-tier limits to know
 
| Service | Limit |
|---|---|
| Render free web service | Sleeps after about 15 minutes idle; first request can take 30 to 60 seconds. No separate free background worker, so the worker runs inside the API service. |
| Neon free Postgres | Small storage and compute quota; fine for test data |
| Gemini free tier | Rate limits and daily quotas; check the current limits before a demo |
| Vercel Hobby | Fine for a portfolio site; personal, non-commercial use |
| GitHub Actions | Free minutes for public repos |
 
Do not add a payment method to any service unless you have confirmed the free tier doesn't require one.
 
# 6. Architecture
 
```
  Browser (React on Vercel)
          |  HTTPS + JWT
          v
  Express API (Render)  -----------------------+
          |                                    |
          | SQL                                | inserts job
          v                                    v
  PostgreSQL (Neon) <----- polls jobs ----- Worker (Node.js, Render)
  applications, documents,                     |
  extractions, validations,                    v
  jobs, reviews, audit_log           OCR (Tesseract) -> LLM (Gemini)
                                              -> Validator (rules)
                                              -> Decision + audit log
```
 
## Pipeline for one document
 
```
upload -> store bytea -> job queued
  -> preprocess (deskew, threshold)
  -> OCR (text + boxes)
  -> extract (LLM, JSON schema, mocked in tests)
  -> validate (rules per field)
  -> decide (verified | needs_review | missing)
  -> log every step to audit_log
  -> reviewer approves or rejects
```
 
## Key design rules
 
1. The LLM never makes the final decision. Rules and a human do.
2. Every flag records field, expected value, extracted value, and reason.
3. Every LLM call logs the model name, prompt version, and token count.
4. Failed jobs retry up to 3 times, then go to a failed state for manual review.
# 7. Data model
 
| Table | Key columns |
|---|---|
| users | id, name, email, password_hash, role |
| applications | id, applicant_id, form_fields (JSON), status |
| documents | id, application_id, type, file_bytes (bytea), status |
| extractions | id, document_id, fields (JSON), ocr_text, model, prompt_version |
| validations | id, document_id, field, expected, extracted, result, reason |
| jobs | id, document_id, stage, status, attempts, locked_until |
| reviews | id, document_id, reviewer_id, decision, note |
| audit_log | id, entity_type, entity_id, action, actor, details (JSON), created_at |
 
# 8. API (version 1)
 
| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register | Create an applicant account |
| POST | /auth/login | Return a JWT |
| POST | /applications | Create an application with form fields |
| POST | /applications/:id/documents | Upload a document (PDF or PNG, max 2 MB) |
| GET | /applications/:id | Status and results |
| GET | /review/queue | Reviewer: documents needing review |
| POST | /review/:documentId | Reviewer: approve or reject with a note |
| GET | /audit/:documentId | Audit trail for one document |
| GET | /health | Health check |
 
# 9. Example: one document end to end
 
**Application form (applicant input)**
 
```json
{ "name": "Ramesh Kumar Patil", "roll_number": "BE2024-0457",
  "dob": "2005-03-14", "board": "State Board", "year": 2024 }
```
 
**OCR output (excerpt)**
 
```
STATE BOARD OF SECONDARY EDUCATION - MARKSHEET
Name: Ramesh Kumar Patil
Roll No: BE2024-0457     DOB: 14/03/2005
Year: 2024
Total: 412 / 500          Result: PASS
```
 
**Extraction (LLM, JSON schema)**
 
```json
{ "name": "Ramesh Kumar Patil", "roll_number": "BE2024-0457",
  "dob": "2005-03-14", "board": "State Board", "year": 2024,
  "total": 412, "result": "PASS" }
```
 
**Validation output**
 
| Field | Expected | Extracted | Result | Reason |
|---|---|---|---|---|
| name | Ramesh Kumar Patil | Ramesh Kumar Patil | pass | fuzzy score 1.00 |
| roll_number | BE2024-0457 | BE2024-0457 | pass | exact match |
| dob | 2005-03-14 | 2005-03-14 | pass | exact match after normalization |
| year | 2024 | 2024 | pass | exact match |
| total | (not in form) | 412 | pass | integer within 0 to 500 |
 
**Decision:** verified. No reviewer action needed.
 
**Mismatch example:** if the form says `Ramesh Kumar Patil` but the marksheet says `Ramesh K. Pati1` (OCR error), the name fuzzy score falls below 0.9, so the result is `needs_review` with the reason "name similarity 0.82 below threshold 0.90". The reviewer sees both values and decides.
 
# 10. Implementation flow (what to build, in order)
 
| Phase | Weeks | Output |
|---|---|---|
| 0. Setup | 1 | Accounts, tools, GitHub repo, planning files |
| 1. Data | 1 to 2 | Synthetic marksheet generator, answer key |
| 2. Agent core | 2 to 3 | OCR, extraction, validator, pipeline, eval script |
| 3. Manual baseline | 3 | Your own timing data from friends, saved to CSV |
| 4. Backend | 4 to 5 | Express API, Postgres schema, uploads, job worker |
| 5. Frontend | 6 | Applicant and reviewer screens |
| 6. Packaging | 6 | Docker Compose for local run |
| 7. Deploy and CI | 7 | Render, Vercel, GitHub Actions |
| 8. Documentation | 8 | README, decisions, demo video, applications |
 
Rule for every phase: finish it, test it, commit it, then start the next one.
 
# 11. GitHub: from zero to pushed
 
## 11.1 Install and sign up (one time)
 
1. Install Git, Node.js 20 LTS, and VS Code or Cursor.
2. Create free accounts on GitHub, Vercel, Render, Neon, and Google AI Studio (for a Gemini key).
3. Verify tools:
```bash
git --version
node -v
```
 
## 11.2 Create the local project and repo
 
```bash
mkdir docflow-agent
cd docflow-agent
git init
git branch -M main
```
 
## 11.3 Create the GitHub repository
 
On github.com, click **New repository**, name it `docflow-agent`, choose **Public**, and do not add a README or .gitignore. Then connect it:
 
```bash
git remote add origin https://github.com/YOUR_USERNAME/docflow-agent.git
```
 
## 11.4 First commit and push
 
```bash
mkdir -p docs
cp /path/to/DocFlow-Agent-Complete-Guide.md docs/PLAN.md
git add .
git commit -m "chore: initial project plan"
git push -u origin main
```
 
## 11.5 Starter files (create before any code)
 
**.gitignore**
 
```gitignore
.env
.env.*
!.env.example
node_modules/
.venv/
__pycache__/
*.pyc
dist/
build/
.next/
eval/data/
uploads/
.DS_Store
.vscode/
.idea/
```
 
**.env.example**
 
```bash
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
JWT_SECRET=change-me
GEMINI_API_KEY=your-key-here
OCR_ENGINE=tesseract
RUN_WORKER=true
CORS_ORIGIN=http://localhost:5173
```
 
**AGENTS.md** (rules your coding agent reads every session)
 
```markdown
# DocFlow Agent: rules for the coding agent
 
## Project
Monorepo:
- apps/web: React (Vite) + TypeScript + Tailwind
- apps/api: Express + TypeScript + JWT + PostgreSQL (Neon)
- services/agent: Express + TypeScript + tesseract.js OCR + Gemini SDK extraction + rule validator
- eval/: synthetic test set, answer key, evaluation script
 
## Hard rules
1. Work one step at a time. Test each step before starting the next.
2. Never commit secrets. Read config from environment variables. Update .env.example when adding one.
3. Use synthetic documents only.
4. Never invent metrics. Only report numbers produced by eval/run-eval.ts (cd eval && npm run eval).
5. The LLM never makes the final decision.
6. Every validation flag stores field, expected, extracted, and reason.
7. One document type (marksheet) in version 1. No fraud detection, DigiLocker, or WebSockets.
8. Run tests before claiming a step works. Report pass or fail honestly.
9. Stay on free-tier tools. Ask before adding any paid service.
 
## Commands
- Agent tests: cd services/agent && npm test
- API tests: cd apps/api && npm test
- Web tests: cd apps/web && npm test
- Evaluation: cd eval && npm run eval
```
 
## 11.6 Daily Git workflow (every task)
 
```bash
git checkout main && git pull
git checkout -b feat/ocr-pipeline
# agent writes code, you test it
git add .
git commit -m "feat(agent): add tesseract OCR step"
git push -u origin feat/ocr-pipeline
# open a Pull Request on GitHub, review the diff, merge into main
```
 
Commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`. Small commits make mistakes easy to undo.
 
# 12. Agent prompts, step by step
 
Paste one step at a time into your coding agent. Test, commit, then continue.
 
**Step 1: Scaffold the monorepo**
 
> Read AGENTS.md and docs/PLAN.md. Create the folder structure from the plan: apps/web (Vite React, TypeScript, Tailwind), apps/api (Express, TypeScript), services/agent (Express, TypeScript, with src/ and tests/), and eval/ with an empty run-eval.ts. Add a hello route to each service. Don't implement features yet.
> Acceptance: each service starts locally and returns its hello route.
 
Commit: `chore: scaffold monorepo services`
 
**Step 2: Synthetic marksheet generator and answer key**
 
> Build eval/src/generate.ts. It creates 50 PNG marksheets with the canvas package and writes eval/data/answer_key.csv. Fields: name, roll number, DOB, board, year, subject marks, total, result. Use fake names and numbers only. Include variety: clean renders, slight rotation and noise, and about 10 deliberate mismatches marked in the answer key. Add a Vitest test that checks the CSV row count and that every image exists.
> Acceptance: the script produces 50 images and the CSV, and npm test passes.
 
Commit: `feat(eval): synthetic marksheet generator`
 
**Step 3: OCR and preprocessing**
 
> In services/agent/src/ocr.ts, add greyscale, normalize, and threshold preprocessing with sharp, and a Tesseract function via tesseract.js that returns the page text. Add Vitest tests on synthetic images.
> Acceptance: report the actual number of images where the roll number was read correctly. Don't round it.
 
Commit: `feat(agent): OCR and preprocessing`
 
**Step 4: LLM extraction with a schema**
 
> In services/agent/src/extract.ts, send OCR text to Gemini (key from GEMINI_API_KEY) and request JSON with name, roll_number, dob, board, year, total, result. Validate the response with a Zod schema. Any invalid or unsupported field becomes null with a warning. Save the prompt in prompts/extract_v1.txt. Tests must mock the Gemini SDK call with vi.mock.
> Acceptance: mocked tests pass. Then run on 10 synthetic documents and report field accuracy against the answer key.
 
Commit: `feat(agent): LLM extraction with schema`
 
**Step 5: Validator**
 
> Write pipeline/validate.py. Name uses rapidfuzz with a 0.9 threshold. Roll number and DOB must match exactly after normalization. Marks must be integers in range. Null fields are "missing". Each result includes field, expected, extracted, result, and reason. Unit test every rule.
> Acceptance: all unit tests pass.
 
Commit: `feat(agent): rule-based validator`
 
**Step 6: Pipeline and evaluation**
 
> Connect the stages in pipeline/run.py with timing per stage. The decision step returns verified, needs_review, or missing, and never rejects. Write eval/run_eval.py to run the pipeline on the synthetic set and write eval/results/summary.md with time per document, field accuracy, false flags, and missed mismatches. Don't adjust the numbers.
> Acceptance: summary.md contains numbers from this run.
 
Commit: `feat(agent): pipeline and evaluation`
 
**Step 7: Manual baseline (you do this)**
 
Ask 3 friends to check 20 to 30 synthetic documents each with the same checklist. Save their times and errors to eval/manual_baseline.csv. The agent must not create this data.
 
Commit: `docs(eval): manual baseline`
 
**Step 8: Database and Express API**
 
> Set up apps/api with Express and TypeScript. Connect to Neon using DATABASE_URL. Write migrations for the tables in section 7. Implement register, login (JWT, bcrypt), create application, upload document (PDF or PNG, max 2 MB, stored as bytea), get application, and get audit trail. Uploading inserts a job row. Add tests against a test database.
> Acceptance: tests pass, and you can register, log in, create an application, and upload a file with curl.
 
Commit: `feat(api): auth, applications, uploads, jobs`
 
**Step 9: Job worker**
 
> Add a worker loop to the agent that polls jobs every 5 seconds, claims one with SELECT ... FOR UPDATE SKIP LOCKED, runs the pipeline, writes extraction and validation rows, and updates status. Retry up to 3 times. Enable with RUN_WORKER=true. Test that two workers never claim the same job.
> Acceptance: an uploaded document is processed and its results appear in the database.
 
Commit: `feat(agent): job worker with retries`
 
**Step 10: React frontend**
 
> Build screens in apps/web: login, register, new application with upload, status page (poll every 5 seconds), reviewer queue, and document detail (image, extracted fields beside form values, validation results, audit trail, approve and reject). Read the API URL from VITE_API_URL. Keep the JWT in memory for v1 and note the tradeoff in docs/decisions.md.
> Acceptance: register, upload, watch status change, and approve as reviewer locally.
 
Commit: `feat(web): applicant and reviewer screens`
 
**Step 11: Docker Compose**
 
> Write Dockerfiles for the API and agent (the agent image installs tesseract-ocr). Write infra/docker-compose.yml for the API, worker, and web. No secrets in any file.
> Acceptance: `docker compose up` runs the app at localhost.
 
Commit: `chore(infra): docker compose`
 
**Step 12: Free deployment**
 
> Add render.yaml for the API as a free Docker web service with RUN_WORKER=true. Add /health to both services. The web app reads VITE_API_URL at build time. Write docs/DEPLOY.md with the exact steps for Neon, Render, and Vercel.
> Acceptance: /health responds on Render and the Vercel site can log in.
 
Commit: `chore(deploy): render and vercel config`
 
Manual steps:
1. Neon: create a project, copy the connection string.
2. Render: New, then Blueprint, select the repo. Set DATABASE_URL, JWT_SECRET, GEMINI_API_KEY, and CORS_ORIGIN.
3. Vercel: import the repo, set Root Directory to apps/web, set VITE_API_URL to the Render URL.
4. Test the live site from a phone on mobile data.
**Step 13: CI**
 
> Add .github/workflows/ci.yml that runs agent tests, API tests, and web tests on every push and pull request. Install Tesseract on the runner. Mock the LLM. No secrets.
> Acceptance: the green check appears in the Actions tab.
 
Commit: `ci: test workflow`
 
**Step 14: Documentation**
 
> Update README.md with a summary, screenshot or GIF, live link, Mermaid architecture diagram, local run steps, and the results copied exactly from eval/results/summary.md. Add docs/decisions.md with 5 short tradeoff notes. Don't add numbers that aren't in summary.md.
 
Commit: `docs: readme, decisions, results`
 
# 13. Evaluation and resume bullet
 
## 13.1 What to measure
 
| Metric | How |
|---|---|
| Time per document | Manual: stopwatch by 3 volunteers. Agent: timer per stage. |
| Field-level accuracy | Compare each extracted field to the answer key |
| False flags | Valid documents wrongly flagged |
| Missed mismatches | Planted errors the agent did not flag |
| Cost per document | LLM tokens and OCR time (should be zero on free tiers, but record it) |
 
## 13.2 Results table (fill from your run only)
 
| Metric | Manual | Agent |
|---|---|---|
| Time per document | _ | _ |
| Field-level accuracy | _ | _ |
| False flags | _ | _ |
| Missed mismatches | _ | _ |
 
## 13.3 Resume bullet template
 
"Built a document verification agent (React, Node.js, Express, TypeScript, PostgreSQL, Tesseract OCR, Gemini LLM) with an auditable decision trail. Reduced average review time from X minutes to Y seconds per document on a 50-document synthetic test set, with Z% field-level accuracy against a labelled answer key."
 
Fill X, Y, and Z only from measured results.
 
# 14. Risks
 
| Risk | Mitigation |
|---|---|
| Poor OCR on photos | Preprocess, and report accuracy by image quality |
| LLM invents values | JSON schema, type checks, and a check that each value appears in OCR text |
| Quota runs out | Cache LLM responses by document hash; test with mocks |
| Scope creep | Keep the non-goals list |
| Real data leaks | Synthetic data only; add a "demo with synthetic documents" note on the site |
| Key committed to GitHub | Revoke it in the provider dashboard immediately and create a new one |
| Cold starts | Note in README; open the link a minute before a demo |
 
# 15. Definition of done
 
- Upload to decision works end to end for marksheets.
- Every flag has an audit entry with its reason.
- Evaluation results are in the README with the test method.
- `docker compose up` starts the whole system.
- CI passes on GitHub.
- The live link works from a phone.
- A 2-minute demo video is linked from the README.
# 16. If time runs short
 
Cut in this order: Playwright tests, Docker, CI, the reviewer detail page's extras. Keep the pipeline, the evaluation, the audit log, and the live link. Those carry the project.
 