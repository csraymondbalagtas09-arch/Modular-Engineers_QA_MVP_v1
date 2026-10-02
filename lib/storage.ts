/**
 * Review storage (Cloudflare D1 / SQLite).
 *
 * - answers:   every question asked and the answer returned (with citations)
 * - findings:  questions escalated to engineer review
 * - decisions: append-only review events; each stores the finding and its evidence
 *              as they were when the decision was made
 *
 * Current review status is derived from the newest decision. Writes use an
 * INSERT … SELECT guarded by the expected version plus a unique (finding, version)
 * index, so a stale submission is rejected instead of overwriting a newer decision.
 */
import { env } from 'cloudflare:workers';
import { chunkCount, documents, pages, runChecks } from './engine';
import type { Answer, AppState, Decision, Finding } from './types';

export const REVIEW_STATUSES = ['Engineer Review', 'Accept', 'Reject', 'Needs Correction'] as const;

/** Allowed next actions for each status. Decisions require an open Engineer Review. */
export function allowedTransitions(status: string): string[] {
  if (status === 'AI Flagged') return ['Engineer Review'];
  if (status === 'Engineer Review') return ['Accept', 'Reject', 'Needs Correction'];
  return ['Engineer Review']; // reopen a completed decision
}

function db() {
  if (!env.DB) throw new Error('Review storage is unavailable. Please try again shortly.');
  return env.DB;
}

const evidenceKey = (f: Finding) => JSON.stringify(f.citations.map((c) => [c.id, c.quote]));

export async function state(reviewer: string, full = false): Promise<AppState> {
  const [answerRows, findingRows, decisionRows] = await db().batch([
    db().prepare('SELECT payload FROM answers ORDER BY created_at DESC' + (full ? '' : ' LIMIT 50')),
    db().prepare('SELECT payload FROM findings ORDER BY created_at DESC'),
    db().prepare(
      'SELECT id, finding_id AS findingId, version, status, comment, reviewer, created_at AS createdAt, snapshot FROM decisions ORDER BY created_at DESC, version DESC',
    ),
  ]);
  const history = (answerRows.results || []).map((r: any) => JSON.parse(r.payload)) as Answer[];
  const decisions = (decisionRows.results || []).map((r: any) => {
    const { snapshot, ...rest } = r;
    return { ...rest, evidenceSnapshot: JSON.parse(snapshot) };
  }) as Decision[];
  const findings = [...runChecks(), ...(findingRows.results || []).map((r: any) => JSON.parse(r.payload))] as Finding[];

  for (const finding of findings) {
    const latest = decisions.filter((d) => d.findingId === finding.id).sort((a, b) => b.version - a.version)[0];
    if (!latest) continue;
    finding.status = latest.status;
    finding.version = latest.version;
    // If documents were re-ingested and the evidence differs from what the reviewer saw,
    // surface that instead of silently carrying the old decision forward.
    if (latest.evidenceSnapshot && evidenceKey(latest.evidenceSnapshot) !== evidenceKey(finding))
      finding.evidenceChangedSinceDecision = true;
  }

  return {
    documents,
    findings,
    history,
    decisions,
    reviewer,
    mode: 'Evidence retrieval · model not connected',
    pageCount: pages.length,
    chunkCount,
  };
}

export async function saveAnswer(answer: Answer, actor: string, runId?: string) {
  const saved: Answer = {
    ...answer,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...(runId ? { runId } : {}),
  };
  await db()
    .prepare('INSERT INTO answers (id, question, payload, actor, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(saved.id, saved.question, JSON.stringify(saved), actor, saved.createdAt)
    .run();
  return saved;
}

export async function flagAnswer(answerId: string, actor: string) {
  const row = await db()
    .prepare('SELECT payload FROM answers WHERE id = ?')
    .bind(answerId)
    .first<{ payload: string }>();
  if (!row) throw new Error('Question not found');
  const a = JSON.parse(row.payload) as Answer;
  const finding: Finding = {
    id: 'question-' + answerId,
    title: a.question.slice(0, 150),
    category: a.status === 'insufficient' ? 'Missing evidence' : 'Question review',
    severity: 'medium',
    summary: a.summary,
    risk: a.details.join(' '),
    recommendation: 'Review the cited evidence and request any missing source information.',
    citations: a.citations,
    missing: a.missing,
    status: 'AI Flagged',
    version: 0,
    origin: 'Question escalated by ' + actor,
  };
  await db()
    .prepare('INSERT OR IGNORE INTO findings (id, payload, actor, created_at) VALUES (?, ?, ?, ?)')
    .bind(finding.id, JSON.stringify(finding), actor, new Date().toISOString())
    .run();
  return finding;
}

export async function reviewFinding(id: string, version: number, status: string, comment: string, reviewer: string) {
  const { findings } = await state(reviewer);
  const finding = findings.find((f) => f.id === id);
  if (!finding) throw new Error('Finding not found');
  if (finding.version !== version) return { conflict: true };
  if (!allowedTransitions(finding.status).includes(status))
    throw new Error('Start or reopen Engineer Review before recording a decision.');

  // The snapshot records the evidence the reviewer saw and the status this decision sets.
  const snapshot: Finding = { ...finding, status, version: version + 1 };
  delete snapshot.evidenceChangedSinceDecision;
  const insert = db()
    .prepare(
      `INSERT INTO decisions (id, finding_id, version, status, comment, reviewer, created_at, snapshot)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE COALESCE((SELECT MAX(version) FROM decisions WHERE finding_id = ?), 0) = ?`,
    )
    .bind(
      crypto.randomUUID(),
      id,
      version + 1,
      status,
      comment,
      reviewer,
      new Date().toISOString(),
      JSON.stringify(snapshot),
      id,
      version,
    );
  try {
    const result = await insert.run();
    return { conflict: result.meta.changes !== 1 };
  } catch (error) {
    // Two simultaneous submissions: the unique (finding, version) index rejects the second.
    if (/UNIQUE/i.test(String(error))) return { conflict: true };
    throw error;
  }
}
