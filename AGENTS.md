# DocFlow Agent: rules for the coding agent

## Project architecture

- `apps/web`: React, Vite, TypeScript, and Tailwind.
- `apps/api`: Node.js, Express, and TypeScript API.
- `services/agent`: Python FastAPI processing service and worker; handles PDF extraction/rendering, OCR, extraction, validation, and job processing.
- `eval/simulator`: Node.js/TypeScript live-traffic simulator.
- `eval/pdf`: Python synthetic-PDF generator and its tests.

The Python agent must not own user authentication, applicant-facing application APIs, or the React UI. It processes synthetic documents, handles PDFs and OCR, extracts fields, applies deterministic validation, and stores explainable results. The Express API and live traffic simulator remain TypeScript; the LLM never makes the final decision.

## Hard rules

1. Work one phase at a time. Do not start a phase until the owner approves the plan or says “next phase.”
2. Use synthetic names, identifiers, and documents only. Never read, create, upload, or test with real student data.
3. Generated documents and answer keys go under `eval/data/`; never commit `eval/data/`.
4. Never invent metrics. Report only values emitted by an actual evaluation or simulator run and stored under `eval/results/`.
5. Never commit secrets. Read configuration from environment variables and use placeholders in `.env.example`.
6. The LLM never makes the final decision. Decisions are rule-based and/or made by a human reviewer.
7. Every validation flag includes `field`, `expected`, `extracted`, and `reason`.
8. Version 1 supports marksheets only. No fraud detection, DigiLocker, or WebSockets; live status uses Server-Sent Events.
9. Stay on free-tier tools. Ask before adding a paid service.
10. Run the current phase's acceptance command before claiming it works. If a test fails, fix the cause rather than weakening the test.
11. When a phase passes, update `docs/tasks.md`, report the actual command output and result, commit with a `feat:` or `chore:` message only when requested/authorized, and stop for the owner.
12. Do not claim production readiness or real-world accuracy from synthetic tests.

## Phase commands

- Synthetic PDFs: `python eval/pdf/generate_pdfs.py --seed 2027`; `pytest`
- Python agent: `python -m pytest services/agent/tests`; start on port 4100 with `python -m uvicorn services.agent.app.main:app --port 4100`
- TypeScript API: `cd apps/api && npm test`
- Web build: `cd apps/web && npm run build`
- Simulator: `node eval/simulator/run.js` (exact options documented with its implementation)
- Evaluation: use the exact command and output files recorded in `docs/tasks.md` for the completed phase.

Use the detailed phase checklist and acceptance commands in `docs/tasks.md`. The Express API is TypeScript; document-processing modules belong in `services/agent`. If any command or path differs from the checked-in project, update the plan and get approval before implementation.
