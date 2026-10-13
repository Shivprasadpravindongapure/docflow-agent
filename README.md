# DocFlow Agent

An AI agent that verifies academic marksheets against application forms, flags mismatches with reasons, and keeps an audit trail for staff review.

Status: in development.

## Quick start

- Web: `cd apps/web && npm install && npm run dev`
- API: `cd apps/api && npm install && npm run dev`
- Agent: `cd services/agent && npm install && npm run dev`
- Evaluation: `cd eval && npm install && npm run eval`

## Synthetic evaluation data

Generate the 50-document synthetic marksheet set with `cd eval && npm run generate`. The PNGs and answer key are generated locally by `eval/src/generate.ts`; no public dataset or real student records are used.
