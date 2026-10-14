# DocFlow Agent

DocFlow Agent is planned as a live marksheet review workflow, exercised with synthetic applicants and documents only. The React UI and Express application API stay in TypeScript; a Python agent service handles PDF processing, OCR, extraction, validation, and background jobs. The traffic simulator remains Node.js.

**Status:** Phases 1-2 are complete: reproducible synthetic PDFs and a Python agent PDF extraction service are available. The end-to-end job pipeline, database integration, UI workflow, simulator, and deployment are later phases. Use synthetic documents only.

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

The agent exposes `GET /health` and `POST /extract` at `http://127.0.0.1:4100` (interactive docs: `/docs`). PDF uploads are limited to 2 MB and 5 pages. Text pages return selectable text; image-only pages return PNG page data. The upload is processed in memory and is not persisted.

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
