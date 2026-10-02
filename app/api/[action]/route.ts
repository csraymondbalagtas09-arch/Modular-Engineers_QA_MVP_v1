/**
 * Authenticated API for the workspace.
 *
 *   GET  /api/state     documents, findings, question history and decisions
 *   GET  /api/page?id=  extracted text of one source page
 *   GET  /api/export    full review record as JSON
 *   POST /api/ask       answer a question and save it
 *   POST /api/evaluate  run the eight assessment questions
 *   POST /api/flag      send a saved answer to engineer review
 *   POST /api/review    record a review decision
 */
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { answerQuestion, getPage } from '@/lib/engine';
import { isModelConfigured, modelAssist } from '@/lib/model';
import { questions } from '@/lib/questions';
import { REVIEW_STATUSES, flagAnswer, reviewFinding, saveAnswer, state } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 20_000;

class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function actor() {
  const user = await getChatGPTUser();
  if (user) return user.email || user.userId;
  // Compile-time development mode only. Never used by the production build.
  if (import.meta.env.DEV) return 'Local assessment reviewer';
  return null;
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Reads a JSON body with a hard size limit (does not trust Content-Length alone). */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES)
    throw new RequestError('Request too large', 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new RequestError('Request too large', 413);
  try {
    const body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new RequestError('The request body must be a JSON object.', 400);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const user = await actor();
    if (!user) return json({ error: 'Sign in to access this private project.' }, 401);
    const { action } = await params;

    if (action === 'state') {
      const s = await state(user);
      if (isModelConfigured(env as any)) s.mode = 'Model connection configured';
      return json(s);
    }
    if (action === 'page') {
      const page = getPage(new URL(request.url).searchParams.get('id') || '');
      return page ? json(page) : json({ error: 'Page not found' }, 404);
    }
    if (action === 'export') {
      const s = await state(user, true);
      return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), ...s }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="engineering-qa-review.json"',
          'Cache-Control': 'no-store',
        },
      });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('Review read failed', e);
    return json({ error: 'The review data could not be loaded. Please retry.' }, 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const user = await actor();
    if (!user) return json({ error: 'Sign in before recording questions or decisions.' }, 401);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      return json({ error: 'Cross-origin writes are not allowed.' }, 403);
    const { action } = await params;
    const body = await readBody(request);

    if (action === 'ask') {
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question || question.length > 2000)
        return json({ error: 'Enter a question between 1 and 2,000 characters.' }, 400);
      const answer = await modelAssist(answerQuestion(question), env as any);
      return json(await saveAnswer(answer, user));
    }

    if (action === 'evaluate') {
      const runId = crypto.randomUUID();
      const results = [];
      for (const q of questions) results.push(await saveAnswer(answerQuestion(q.question), user, runId));
      return json({ runId, results });
    }

    if (action === 'flag') {
      if (typeof body.answerId !== 'string') return json({ error: 'A saved question is required.' }, 400);
      return json(await flagAnswer(body.answerId, user));
    }

    if (action === 'review') {
      const { findingId, version, status, comment } = body;
      if (
        typeof findingId !== 'string' ||
        !Number.isInteger(version) ||
        typeof status !== 'string' ||
        !(REVIEW_STATUSES as readonly string[]).includes(status) ||
        typeof comment !== 'string' ||
        !comment.trim() ||
        comment.length > 3000
      )
        return json({ error: 'Choose a review action and add a reason (up to 3,000 characters).' }, 400);
      const result = await reviewFinding(findingId, version as number, status, comment.trim(), user);
      return result.conflict
        ? json({ error: 'This finding changed since you opened it. Reload and review the latest decision.' }, 409)
        : json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof RequestError) return json({ error: e.message }, e.status);
    console.error('Review write failed', e);
    const message = e instanceof Error ? e.message : '';
    if (/not found|before recording/i.test(message)) return json({ error: message }, 400);
    return json({ error: 'Your changes could not be saved. Your input has been preserved; please retry.' }, 503);
  }
}
