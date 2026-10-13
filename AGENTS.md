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
