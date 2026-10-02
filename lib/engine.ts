/**
 * Public entry point for the evidence engine.
 *
 *   corpus.ts     ingested pack, register-derived document status, citation builder
 *   register.ts   drawing-register parsing and revision resolution
 *   schedules.ts  wall and concrete schedule readings
 *   checks.ts     standing QA findings
 *   retrieval.ts  lexical retrieval over current (or explicitly historical) evidence
 *   answers.ts    question routing and cited answers
 */
import { chunks } from './corpus';

export { documents, pages, facts, getPage, registers, revisionIssues } from './corpus';
export { runChecks, missingProductEvidence } from './checks';
export { retrieve } from './retrieval';
export { answerQuestion, scopeOf } from './answers';

export const chunkCount = chunks.length;
