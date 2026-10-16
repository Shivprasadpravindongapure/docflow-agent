# DocFlow Agent

DocFlow Agent is planned as a live marksheet review workflow, exercised with synthetic applicants and documents only. The React UI and Express application API stay in TypeScript; a Python agent service handles PDF processing, OCR, extraction, validation, and background jobs. The traffic simulator remains Node.js.

**Status:** Phases 1-5 are complete: reproducible synthetic PDFs, a Python processing pipeline, a PostgreSQL-backed Express API and worker, and a live applicant status preview are available. Document submission/reviewer screens, simulator, and deployment are later phases. Use synthetic documents only.

## Stack

- Web: React, Vite, TypeScript, Tailwind CSS
- Application API: Node.js, Express, TypeScript, PostgreSQL (configured through `DATABASE_URL`)
- Processing agent: Python 3.11+, FastAPI, Pydantic
- OCR and image preprocessing: Tesseract OCR, pytesseract, Pillow
- Name matching: RapidFuzz
- Optional structured extraction: Gemini API (`google-genai`); local labelled-field extraction is the default
- Evaluation and tests: Python, pytest

## Local setup

The agent PDF endpoint is runnable now. The Express API and React app remain separate TypeScript services; later workflow phases will connect them to the agent.

```powershell
# Install Python agent and synthetic PDF generator dependencies
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r services/agent/requirements.txt
python -m pip install -r eval/pdf/requirements.txt

# Generate synthetic PDFs (ignored by Git)
python eval/pdf/generate_pdfs.py --seed 2027

# Start the Python agent from the repository root
python -m uvicorn services.agent.app.main:app --host 127.0.0.1 --port 4100
```

The agent exposes `GET /health`, `POST /extract`, and `POST /process` at `http://127.0.0.1:4100` (interactive docs: `/docs`). PDF uploads are limited to 2 MB and 5 pages. Text pages return selectable text; image-only pages return PNG page data. `/process` accepts a PDF, PNG, or JPEG and a JSON `application` form field; its response includes recognized text, extracted fields and warnings, per-field validation evidence, a `verified`, `needs_review`, or `missing` decision, and per-stage timings. PDFs are limited to 5 pages; all uploads are limited to 2 MB and images to 4 million pixels. Uploads are processed in memory and are not persisted.

**Synthetic/local use only:** `/process` is not authenticated. Bind the service to loopback as shown above and do not expose it to a network or submit real student records. Real-department use must wait for authenticated API integration and the later security/deployment phases. The default labelled-field extractor needs no API key. Tesseract must be installed separately and available on `PATH` for actual OCR; Gemini is optional, requires `GEMINI_API_KEY`, and sends OCR text to Google's service, so keep it disabled for anything other than authorized synthetic data.

Copy `.env.example` to `.env` and set `DATABASE_URL` to the PostgreSQL connection string for your development database. Keep `.env` private. Start the API from `apps/api`:

```powershell
cd apps/api
npm install
npm run dev
```

The API listens on `127.0.0.1:4000` by default. It allows browser requests from the local Vite origins `http://localhost:5173` and `http://127.0.0.1:5173`; set `WEB_ORIGINS` to override them. `HOST` and `PORT` can also be overridden. To process queued uploads, start the worker from the repository root in another terminal:

```powershell
python -m services.agent.app.worker
```

The Express API and Python worker read the same `DATABASE_URL`. The worker claims jobs using PostgreSQL row locks, retries processing failures up to three attempts, and stores validation evidence and audit events. Uploaded synthetic documents are stored under the ignored `uploads/` directory.

The React status preview is in `apps/web`. It signs in to the Express API, lists the signed-in user's applications, and subscribes to each application's owner-authorized Server-Sent Events stream. The browser uses `fetch` streaming rather than native `EventSource` so the bearer token can stay in an `Authorization` header instead of the URL; the token is held in memory only. The API checks the latest job once per second and emits only changed status values; reconnects use capped exponential backoff and the browser has no polling fallback. The API URL defaults to `http://127.0.0.1:4000`; set `VITE_API_BASE_URL` in `apps/web/.env.local` if the API uses a different local address. Ensure the API's `WEB_ORIGINS` includes the browser origin.

Run the PDF service and Python tests:

```powershell
python -m pytest

# API and status dashboard
cd apps/api
npm test
npm run build
cd ../web
npm test
npm run build
```

Phase-specific evaluation output is written to the ignored `eval/results/` directory. Only report metrics emitted by an actual evaluation/simulator run.

## React status preview

Start the API and worker as described above, then start the web client:

```powershell
cd apps/web
npm install
npm run dev
```

The status page is a development preview for synthetic accounts and applications. Its status stream returns only application ID, status, and update time; it does not expose document contents or validation details.

## Current milestone and next work

See [docs/PLAN.md](docs/PLAN.md), [docs/tasks.md](docs/tasks.md), and [docs/decisions.md](docs/decisions.md) for the agreed architecture, decisions, and nine-phase delivery plan.
