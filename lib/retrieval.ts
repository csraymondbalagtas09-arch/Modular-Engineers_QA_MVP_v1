/**
 * Lexical retrieval (BM25-style) over page-bounded text chunks.
 *
 * Current evidence only by default; superseded packages are included only when the
 * question explicitly asks about history. Brief, policy and question files are never
 * returned as engineering evidence, so a question cannot be cited as its own answer.
 */
import { chunks, cite, getDocument } from './corpus';
import type { Citation } from './types';

const STOP_WORDS = new Set(
  (
    'the a an and or to of in is are was were be should what which how where why with this that from by for as it on at ' +
    'can could please provide explain cite evidence supplied documents project information drawing drawings does do'
  ).split(' '),
);

const EXCLUDED_TYPES = new Set(['Brief', 'Questions', 'Policy']);
const K1 = 1.2;
const B = 0.75;

export function tokens(text: string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOP_WORDS.has(t) && t.length > 1);
}

const tokenSets = chunks.map((c) => tokens(c.text));
const documentFrequency = new Map<string, number>();
for (const set of tokenSets)
  for (const t of new Set(set)) documentFrequency.set(t, (documentFrequency.get(t) || 0) + 1);
const averageLength = tokenSets.reduce((n, ts) => n + ts.length, 0) / Math.max(1, chunks.length);

/** Domain synonyms so everyday wording reaches drawing terminology. */
function expand(question: string, terms: string[]) {
  const q = question.toLowerCase();
  if (/strength|compressive/.test(q)) terms.push('mpa', 'concrete');
  if (/connection|manufacturer/.test(q)) terms.push('ritek');
  if (/rebar|reinforc/.test(q)) terms.push('n12', 'reinforcement');
  if (/cover/.test(q)) terms.push('cover', 'exposure');
  if (/soil|geotech/.test(q)) terms.push('geotechnical');
  return terms;
}

export function retrieve(question: string, includeSuperseded = false, limit = 6): Citation[] {
  const terms = [...new Set(expand(question, tokens(question)))];
  const ranked = chunks
    .map((chunk, i) => {
      const doc = getDocument(chunk.documentId);
      if (!doc || EXCLUDED_TYPES.has(doc.type)) return { chunk, score: 0 };
      if (!includeSuperseded && doc.status === 'superseded') return { chunk, score: 0 };
      const ts = tokenSets[i];
      let score = 0;
      for (const term of terms) {
        const tf = ts.filter((t) => t === term).length;
        if (!tf) continue;
        const df = documentFrequency.get(term) || 0;
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
        score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * ts.length) / averageLength));
      }
      // A drawing number in the question is a strong signal.
      if (score > 0 && chunk.sheet && terms.includes(chunk.sheet.toLowerCase())) score += 12;
      return { chunk, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const usedPages = new Set<string>();
  const result: Citation[] = [];
  for (const { chunk } of ranked) {
    if (usedPages.has(chunk.pageId)) continue;
    usedPages.add(chunk.pageId);
    const citation = cite(chunk.pageId);
    if (citation) result.push({ ...citation, quote: chunk.text });
    if (result.length >= limit) break;
  }
  return result;
}
