# DocFlow Agent

DocFlow Agent is planned as a live marksheet review workflow, exercised with synthetic applicants and documents only. The React UI and Express application API stay in TypeScript; a Python agent service handles PDF processing, OCR, extraction, validation, and background jobs. The traffic simulator remains Node.js.

**Status:** Phases 1-3 are complete: reproducible synthetic PDFs and a Python agent that extracts, OCRs, and validates synthetic marksheets are available. Database integration, authenticated applicant APIs, UI workflow, simulator, and deployment are later phases. Use synthetic documents only.

## Stack

- Web: React, Vite, TypeScript, Tailwind CSS
- Application API: Node.js, Express, TypeScript
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

The TypeScript API can be started separately:

```powershell
cd apps/api
npm install
npm run dev
```

The React UI is in `apps/web`; its applicant/reviewer flow is planned for a later phase.

Run the PDF service and Python tests:

```powershell
python -m pytest
```

Phase-specific evaluation output is written to the ignored `eval/results/` directory. Only report metrics emitted by an actual evaluation/simulator run.

## React UI

The web client remains in `apps/web` and is not yet connected to the Python API:

```powershell
cd apps/web
npm install
npm run dev
```

## Current milestone and next work

See [docs/PLAN.md](docs/PLAN.md), [docs/tasks.md](docs/tasks.md), and [docs/decisions.md](docs/decisions.md) for the agreed architecture, decisions, and nine-phase delivery plan.
