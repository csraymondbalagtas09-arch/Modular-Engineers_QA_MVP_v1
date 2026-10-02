# Modular — Engineering QA Mini MVP

Private assessment prototype by Raymond Balagtas for the Modular Engineers Founding AI Software Engineer assessment. It opens the supplied project with three views: **Ask the documents**, **Document register** and **Engineer review**. The supplied PDFs are restricted to this assessment.

## Documents in this repository

| Document | Contents |
|---|---|
| `README.md` | What works, setup, run and test instructions |
| `docs/technical-explanation.md` | The eight requested topics: ingestion, citations, revision control, conflicts/missing information, retrieval, hallucination mitigation, human review, security |
| `docs/architecture.md` | Flow diagram, modules, data model |
| `docs/candidate-answers.md` | Completed Candidate Test Questions (actual prototype output) |
| `docs/candidate-question-results.json` | The same answers as JSON |
| `docs/validation.md` | Checks actually performed, and what was not |
| `docs/walkthrough.md` | Script for the 5–10 minute video |

## What works

- **Ingestion:** seven PDFs, 135 pages, 2,004 page-bounded chunks, 48 wall-schedule rows. Each file has a SHA-256 fingerprint; each page keeps its drawing number and sheet revision.
- **Revision control from the documents:** package revision, issue date and current/superseded status are read from each drawing register (STR000, A000) and cross-checked against every title block and the supplied filename label. Any disagreement is marked ambiguous and flagged.
- **Cited answers:** every answer cites file, PDF page, drawing number and revision; schedule values quote the exact source row.
- **Subject-specific answering:** a rule answers only when the specific item asked about (wall mark, concrete element, document type, revision) is found. Reworded or off-target questions fall back to "cannot be verified".
- **Eight standing findings:**
  - GW1 thickness conflict, carried over from Rev D
  - 2W2 reinforcement conflict
  - GW2 "N12-00" reinforcement anomaly
  - residual Dincel legend
  - certificate cites a later geotechnical report
  - certificate has no issue date
  - missing Ritek product and connection evidence
  - architecture–structure wall-type mapping
- **Engineer review:** AI Flagged → Engineer Review → Accept / Reject / Needs Correction. Reasons are required, decisions are append-only with evidence snapshots, and stale saves are rejected. A finding is flagged if its evidence changes after a decision.
- **Audit export** of all questions, answers, findings and decisions as JSON.
- **No external AI** by default. An optional, validated model step exists for questions the rules cannot answer.

## Scope and limitations

This is **deterministic evidence rules plus BM25 lexical retrieval**, not a live chatbot. Several checks target this pack's document types and schedule layouts; they are not a general engineering QA system. Native PDF text only (no OCR), no geometry comparison, no design verification or standards certification. Documents are loaded with the ingestion script, not uploaded in the browser. The optional model adapter is covered by a validator test but has not been run against a live provider.

## Run locally

Prerequisites: Node ≥ 22.13 and pnpm. Python 3.11+ with PyMuPDF only if re-ingesting PDFs.

```sh
pnpm install --frozen-lockfile
pnpm run build
```

Apply the migration to the local database once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_puzzling_magneto.sql
```

Then run `pnpm dev` and open the localhost address it prints. Locally, `/signin-with-chatgpt?return_to=/` signs in a simulated development user; production builds remove that fallback and require the hosting platform's identity headers. `pnpm start` runs the built Worker without simulated sign-in. Keep local previews on the loopback interface. See `docs/local-runtime.md` for runtime notes.

## Verify

```sh
node scripts/test-engine.cjs      # 43 engine checks; regenerates docs/candidate-answers.md
node scripts/test-storage.cjs     # review workflow against real SQLite (Node 22.13+)
node node_modules/typescript/bin/tsc --noEmit
pnpm run lint
pnpm run build
```

In the UI: run all eight questions, ask a reworded question (e.g. "What concrete strength is used for the slab on ground?"), open two citations, start Engineer Review on GW1, record a decision, reload and check the decision history.

## Re-ingest the supplied pack

```sh
python -m pip install -r requirements.txt
python scripts/ingest_pack.py --input /absolute/path/to/assessment-pack
node scripts/test-engine.cjs
```

The script reads the seven numbered PDFs, copies originals into `public/project-files`, writes page previews and `lib/data/pack.json`. The status labels it writes are provisional; revision status is re-derived from the drawing registers at runtime.

**Confidentiality:** this repository contains the restricted originals, previews and extracted text. Do not make it public. For a public code-only copy, remove `public/project-files`, `public/evidence`, `lib/data/pack.json` and the generated `docs/candidate-*` files.

## Optional model configuration

Copy `.env.example` to `.env`. All three settings are required; leaving them empty keeps offline evidence mode.

- `MODEL_API_URL`: an HTTPS chat-completions endpoint
- `MODEL_API_TOKEN`: server-side credential (never sent to the browser)
- `MODEL_NAME`: provider model identifier

The model is only called when the rules cannot answer. It receives only the question and retrieved excerpts. Output is rejected unless it cites only those excerpts and every number appears in them; accepted output is marked for engineer confirmation. Confirm provider data retention and permission to send project documents before enabling it.

## External services

Hosting and storage use the Sites platform (Cloudflare Workers + D1). No embedding, vector database or model provider is needed to run the prototype.

## Code map

- `scripts/ingest_pack.py`: PDF ingestion
- `lib/register.ts`: revision control from drawing registers
- `lib/schedules.ts`: wall and concrete schedule readings
- `lib/checks.ts`: standing QA findings
- `lib/retrieval.ts`: BM25 retrieval
- `lib/answers.ts`: question routing and cited answers
- `lib/model.ts`: optional validated model step
- `lib/storage.ts`: review storage and workflow rules
- `app/api/[action]/route.ts`: authenticated API
- `app/workspace.tsx`, `components/qa/`: user interface
