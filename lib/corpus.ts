/**
 * The ingested document pack and citation helpers.
 *
 * Citations are always assembled from trusted page records here, never from generated
 * text, so an answer cannot point at a file or page that does not exist.
 */
import pack from './data/pack.json';
import { resolveDocuments } from './register';
import type { Chunk, Citation, DocumentRecord, Fact, PageRecord } from './types';

type Pack = { documents: DocumentRecord[]; pages: PageRecord[]; facts: Fact[]; chunks: Chunk[] };
const data = pack as unknown as Pack;

export const pages = data.pages;
export const facts = data.facts;
export const chunks = data.chunks;

const resolved = resolveDocuments(data.documents, pages);
export const documents = resolved.documents;
export const registers = resolved.registers;
export const revisionIssues = resolved.issues;

const docMap = new Map(documents.map((d) => [d.id, d]));
const pageMap = new Map(pages.map((p) => [p.id, p]));

export const getDocument = (id: string) => docMap.get(id);
export const getPage = (id: string) => pageMap.get(id);

/** First structural package with the given status (current / superseded). */
export function structuralPackage(status: 'current' | 'superseded') {
  const matches = documents.filter((d) => d.type === 'Structure' && d.status === status);
  return matches.sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
}
export const documentOfType = (type: string) => documents.find((d) => d.type === type);

export function pagesOf(documentId: string | undefined) {
  return documentId ? pages.filter((p) => p.documentId === documentId) : [];
}

export function sheetPage(documentId: string | undefined, sheet: string) {
  return pagesOf(documentId).find((p) => p.sheet === sheet);
}

/** First page in a document whose text matches the pattern. */
export function findPage(documentId: string | undefined, pattern: RegExp) {
  return pagesOf(documentId).find((p) => pattern.test(p.text));
}

/**
 * Builds a citation for a page. When `needle` is given, the quote is the matching line
 * with one line of context before and two after; otherwise the page opening.
 */
export function cite(pageId: string, needle?: string | RegExp): Citation | undefined {
  const page = pageMap.get(pageId);
  const doc = page && docMap.get(page.documentId);
  if (!page || !doc) return undefined;
  const lines = page.text.split('\n');
  const test = (line: string) =>
    typeof needle === 'string' ? line.toLowerCase().includes(needle.toLowerCase()) : !!needle?.test(line);
  const i = needle ? lines.findIndex(test) : -1;
  const quote = i >= 0 ? lines.slice(Math.max(0, i - 1), i + 3).join('\n') : page.text.slice(0, 1100);
  return {
    id: page.id,
    documentId: doc.id,
    filename: doc.filename,
    title: doc.title,
    page: page.page,
    sheet: page.sheet,
    sheetRevision: page.sheetRevision,
    packageRevision: doc.revision,
    status: doc.status,
    quote,
    url: `${doc.url}#page=${page.page}`,
    preview: page.preview,
  };
}

/** A citation whose quote is an exact source line (for schedule rows). */
export function citeLine(pageId: string, line: string): Citation | undefined {
  const citation = cite(pageId);
  return citation && { ...citation, quote: line };
}

/** Drops missing citations and duplicate pages while keeping order. */
export function citations(list: (Citation | undefined)[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of list) {
    if (!c || seen.has(c.id + c.quote)) continue;
    seen.add(c.id + c.quote);
    out.push(c);
  }
  return out;
}

const MONTHS = 'January February March April May June July August September October November December'.split(' ');

export function formatDate(iso: string) {
  if (!iso) return 'no date stated';
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
