# Validation performed

## Passed

- **Engine tests** (`node scripts/test-engine.cjs`, 43 checks):
  - all eight Candidate Test Questions return the expected outcome with valid file/page citations;
  - register-derived status matches the supplied labels, and issue dates and revisions are read from the registers;
  - STR202, STR262 and STR291 remain current as sheet Rev D inside package Rev E;
  - retrieval excludes superseded evidence unless history is asked for; old-revision questions answer from Rev D, labelled;
  - reworded questions: slab on ground (25 MPa), ambiguous "slab" (clarify), footings, columns (not verified), ground slab thickness (not the GW1 conflict), GW2, unknown wall mark GW9, architectural revision, reinforcing-steel manufacturer, soil testing;
  - findings: GW1 conflict with Rev D carry-over, 2W2 and GW2 reinforcement issues, certificate issue date;
  - abstention on unknown or asserted capacities; injected "500 MPa" ignored;
  - model-output validator rejects unknown citations and unsupported numbers.
- **Storage tests** (`node scripts/test-storage.cjs`, real SQLite with the actual migration): valid transitions, premature approval rejected, stale version rejected, persistence after reopening the database, decision snapshots, evidence-drift flag, question escalation (idempotent), reopening a decision, unique-index conflicts, history beyond 500 events.
- **PDF spot checks:** "N12-00 E.F." (GW2, STR270) and the 2W2 N12-300 horizontal bars were confirmed in the PDF text and page image.
- **Type check** of all application and library code under strict TypeScript, with stand-in type declarations for React, UI components and Cloudflare (the full dependency set was not installed in the review environment).
- **UI smoke test** in headless Chromium, with the real engine behind a mock API and simplified stand-ins for the UI components: asking a question, opening a citation and page text, running all eight questions (recent history de-duplicated), document register status, starting review, recording Needs Correction, decision history, form reset, and no horizontal overflow at 390 px width.

## Not performed here

- `pnpm install`, `pnpm run lint`, `pnpm run build` and the full `tsc --noEmit` with real dependencies. Run these before submission.
- The hosted preview and the real shadcn/Radix components in a browser.
- A live model provider.
- Re-running PDF ingestion (the extracted `pack.json` is unchanged).
