/**
 * Storage and review-workflow tests against a real SQLite database using the actual
 * migration. Run: node scripts/test-storage.cjs   (Node 22.13+, built-in node:sqlite)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    filename,
  );

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-qa-test-'));
const file = path.join(dir, 'review.sqlite');
let sqlite = new DatabaseSync(file);
sqlite.exec(fs.readFileSync(path.join(root, 'drizzle/0000_puzzling_magneto.sql'), 'utf8'));

// Minimal D1-compatible wrapper around node:sqlite.
const DB = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) || null;
      },
      async run() {
        const r = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
    };
  },
  async batch(statements) {
    return Promise.all(statements.map((s) => s.all()));
  },
};
const originalLoad = Module._load;
Module._load = function (name, ...rest) {
  if (name === 'cloudflare:workers') return { env: { DB } };
  return originalLoad.call(this, name, ...rest);
};

(async () => {
  const { state, saveAnswer, reviewFinding, flagAnswer, allowedTransitions } = require('../lib/storage.ts');
  const { answerQuestion, runChecks } = require('../lib/engine.ts');
  const standing = runChecks().length;
  const reviewer = 'Test reviewer';

  let s = await state(reviewer);
  assert.equal(s.findings.length, standing);
  const f = s.findings.find((x) => x.category === 'Dimension conflict');

  assert.deepEqual(allowedTransitions('AI Flagged'), ['Engineer Review']);
  await assert.rejects(() => reviewFinding(f.id, 0, 'Accept', 'Premature acceptance', reviewer), /Start or reopen/);
  assert.equal(
    (await reviewFinding(f.id, 0, 'Engineer Review', 'Comparing the two schedules', reviewer)).conflict,
    false,
  );
  assert.equal((await reviewFinding(f.id, 0, 'Reject', 'Stale version', 'Other reviewer')).conflict, true);
  assert.equal(
    (await reviewFinding(f.id, 1, 'Needs Correction', 'Engineer must reconcile 200 mm and 150 mm', reviewer)).conflict,
    false,
  );

  // Persistence after reopening the database.
  sqlite.close();
  sqlite = new DatabaseSync(file);
  s = await state(reviewer);
  const reviewed = s.findings.find((x) => x.id === f.id);
  assert.equal(reviewed.status, 'Needs Correction');
  assert.equal(reviewed.evidenceChangedSinceDecision, undefined);
  assert.equal(s.decisions.length, 2);
  const snapshot = s.decisions.find((d) => d.version === 2).evidenceSnapshot;
  assert.equal(snapshot.status, 'Needs Correction');
  assert.equal(snapshot.citations.length, f.citations.length);

  // Evidence drift: simulate a re-ingested corpus by altering the stored snapshot.
  const changed = { ...snapshot, citations: snapshot.citations.slice(1) };
  sqlite
    .prepare('UPDATE decisions SET snapshot = ? WHERE finding_id = ? AND version = 2')
    .run(JSON.stringify(changed), f.id);
  s = await state(reviewer);
  assert.equal(s.findings.find((x) => x.id === f.id).evidenceChangedSinceDecision, true);
  sqlite
    .prepare('UPDATE decisions SET snapshot = ? WHERE finding_id = ? AND version = 2')
    .run(JSON.stringify(snapshot), f.id);

  // Saved questions and escalation.
  const saved = await saveAnswer(answerQuestion('What is the unknown beam capacity?'), reviewer, 'run-1');
  assert.equal(saved.runId, 'run-1');
  await flagAnswer(saved.id, reviewer);
  await flagAnswer(saved.id, reviewer); // idempotent
  s = await state(reviewer);
  assert.equal(s.findings.length, standing + 1);
  assert.equal(s.history.length, 1);

  // Reopen a completed decision.
  assert.equal(
    (await reviewFinding(f.id, 2, 'Engineer Review', 'Reopened after clarification', reviewer)).conflict,
    false,
  );

  // A duplicate version that slips past the guard is reported as a conflict, not a server error.
  sqlite
    .prepare(
      'INSERT INTO decisions (id,finding_id,version,status,comment,reviewer,created_at,snapshot) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run('race', 'race-finding', 1, 'Engineer Review', 'x', reviewer, new Date().toISOString(), '{}');
  const { env } = require('cloudflare:workers');
  const raced = await env.DB.prepare(
    'INSERT INTO decisions (id,finding_id,version,status,comment,reviewer,created_at,snapshot) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind('race2', 'race-finding', 1, 'Engineer Review', 'x', reviewer, new Date().toISOString(), '{}')
    .run()
    .catch((e) => e);
  assert.match(String(raced), /UNIQUE/);

  // State must not forget a finding once the global event count exceeds 500.
  for (let i = 0; i < 501; i++)
    sqlite
      .prepare(
        'INSERT INTO decisions (id,finding_id,version,status,comment,reviewer,created_at,snapshot) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        'bulk' + i,
        'other-finding',
        i + 1,
        'Engineer Review',
        'test',
        reviewer,
        new Date().toISOString(),
        JSON.stringify(f),
      );
  s = await state(reviewer, true);
  assert.equal(s.findings.find((x) => x.id === f.id).version, 3);
  assert.equal(s.decisions.length, 505);

  console.log(
    'PASS: real SQLite schema, valid transitions, stale-version protection, persistence, decision snapshots, evidence-drift flag, saved questions, idempotent escalation, reopening, unique-index conflicts, and history beyond 500 events.',
  );
  sqlite.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
