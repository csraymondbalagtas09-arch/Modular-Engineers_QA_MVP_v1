/**
 * Revision control from the documents themselves.
 *
 * Each drawing package carries a drawing register (STR000 / A000) listing every
 * sheet with its revision and date. This module reads those registers, derives the
 * package revision and issue date, cross-checks every sheet's title-block revision
 * against the register, and decides which package in a family is current.
 *
 * The filename label supplied with the assessment ("CURRENT" / "SUPERSEDED") is kept
 * only as a cross-check. If the register evidence and the label disagree, or two
 * packages cannot be ordered, the document is marked `ambiguous` and a finding is
 * raised instead of guessing (QA checklist: "If revision status is ambiguous, flag
 * the item for engineer review rather than guessing").
 */
import type { DocumentRecord, DocumentStatus, PageRecord } from './types';

export type RegisterEntry = { sheet: string; revision: string; date: string };

export type PackageRegister = {
  documentId: string;
  pageId: string;
  registerSheet: string;
  revision: string;
  issueDate: string;
  entries: Map<string, RegisterEntry>;
  /** Sheets whose title-block revision differs from the register. */
  mismatches: { sheet: string; register: string; titleBlock: string; pageId: string }[];
  /** Pages whose sheet number is not listed in the register. */
  unregistered: { sheet: string; pageId: string }[];
  /** Register entries with no matching page in the PDF. */
  missingPages: string[];
  declaredTotal?: number;
};

export type RevisionIssue = {
  id: string;
  documentId: string;
  title: string;
  summary: string;
  pageIds: string[];
};

export type ResolvedDocuments = {
  documents: DocumentRecord[];
  registers: Map<string, PackageRegister>;
  issues: RevisionIssue[];
};

const DRAWING_TYPES = new Set(['Structure', 'Architecture']);
const REFERENCE_TYPES = new Set(['Brief', 'Policy', 'Questions']);

/** "10-09-26" or "10/09/26" → "2026-09-10". Two-digit years are read as 20xx. */
export function isoFromShortDate(value: string): string {
  const m = value.match(/^(\d{2})[-/.](\d{2})[-/.](\d{2}|\d{4})$/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

/** Reads one register page. Returns null when the page does not look like a register. */
export function parseRegister(page: PageRecord): PackageRegister | null {
  const entries = new Map<string, RegisterEntry>();
  for (const line of page.text.split('\n')) {
    // Structural register rows: "STR202 D 10-09-26" or "STR270 SECTION AND DETAILS E 10-09-26".
    // The first revision/date pair after the sheet number belongs to the register column.
    const structural = line.match(/^(STR\d{3})\b.*?\b([A-Z])\s+(\d{2}-\d{2}-\d{2})\b/);
    if (structural && !entries.has(structural[1])) {
      entries.set(structural[1], {
        sheet: structural[1],
        revision: structural[2],
        date: isoFromShortDate(structural[3]),
      });
      continue;
    }
    // Architectural register rows: "GROUND FLOOR PLAN - 1:200 5187-26-A100 1:200 CC-A A3".
    const architectural = line.match(/\d{4}-\d{2}-(A\d{3})\s+\S+\s+([A-Z]{1,3}-[A-Z0-9]{1,2})\s+A\d\b/);
    if (architectural && !entries.has(architectural[1])) {
      entries.set(architectural[1], { sheet: architectural[1], revision: architectural[2], date: '' });
    }
  }
  if (entries.size < 3) return null;

  let revision = entries.get(page.sheet)?.revision || '';
  let issueDate = entries.get(page.sheet)?.date || '';
  if (!issueDate) {
    // Architectural sets state the issue in the revision block: "CC-A 02/09/26 FOR CC SUBMISSION".
    const issue = page.text.match(
      /\b([A-Z]{1,3}-[A-Z0-9]{1,2})\s+(\d{2}\/\d{2}\/\d{2})\s+(FOR [A-Z .]+|ISSUED FOR [A-Z .]+)/,
    );
    if (issue) {
      revision = revision || issue[1];
      issueDate = isoFromShortDate(issue[2]);
    }
  }
  if (issueDate) for (const entry of entries.values()) if (!entry.date) entry.date = issueDate;
  const total = page.text.match(/TOTAL:\s*(\d+)/);

  return {
    documentId: page.documentId,
    pageId: page.id,
    registerSheet: page.sheet,
    revision,
    issueDate,
    entries,
    mismatches: [],
    unregistered: [],
    missingPages: [],
    declaredTotal: total ? Number(total[1]) : undefined,
  };
}

function findRegister(doc: DocumentRecord, pages: PageRecord[]): PackageRegister | null {
  const own = pages.filter((p) => p.documentId === doc.id);
  // Prefer the cover/register sheet (STR000, A000); fall back to any page that parses as one.
  const ordered = [...own.filter((p) => /000$/.test(p.sheet)), ...own.filter((p) => !/000$/.test(p.sheet))];
  for (const page of ordered) {
    const register = parseRegister(page);
    if (!register) continue;
    const sheets = new Set(own.map((p) => p.sheet).filter(Boolean));
    for (const p of own) {
      if (!p.sheet) continue;
      const entry = register.entries.get(p.sheet);
      if (!entry) register.unregistered.push({ sheet: p.sheet, pageId: p.id });
      else if (p.sheetRevision && p.sheetRevision !== '—' && entry.revision !== p.sheetRevision)
        register.mismatches.push({
          sheet: p.sheet,
          register: entry.revision,
          titleBlock: p.sheetRevision,
          pageId: p.id,
        });
    }
    register.missingPages = [...register.entries.keys()].filter((s) => !sheets.has(s));
    return register;
  }
  return null;
}

const formatDate = (iso: string) => {
  if (!iso) return 'no date';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

export function resolveDocuments(raw: DocumentRecord[], pages: PageRecord[]): ResolvedDocuments {
  const documents = raw.map((d) => ({ ...d, declaredStatus: d.status }));
  const registers = new Map<string, PackageRegister>();
  const issues: RevisionIssue[] = [];

  for (const doc of documents) {
    if (!DRAWING_TYPES.has(doc.type)) continue;
    const register = findRegister(doc, pages);
    if (!register) continue;
    registers.set(doc.id, register);
    if (register.revision) doc.revision = register.revision;
    if (register.issueDate) doc.issueDate = register.issueDate;
    const problems = [
      ...register.mismatches.map((m) => `${m.sheet} title block Rev ${m.titleBlock} but register Rev ${m.register}`),
      ...register.unregistered.map((u) => `${u.sheet} is not listed in the register`),
      ...register.missingPages.map((s) => `${s} is listed in the register but not found in the PDF`),
    ];
    if (problems.length)
      issues.push({
        id: `register-${doc.id}`,
        documentId: doc.id,
        title: `${doc.title}: register and sheets do not agree`,
        summary: problems.join('; ') + '.',
        pageIds: [register.pageId, ...register.mismatches.map((m) => m.pageId)],
      });
  }

  // Order revisions within each family by register issue date.
  const families = new Map<string, DocumentRecord[]>();
  for (const doc of documents) {
    if (!DRAWING_TYPES.has(doc.type)) continue;
    families.set(doc.family, [...(families.get(doc.family) || []), doc]);
  }
  for (const members of families.values()) {
    const dated = members.filter((d) => registers.get(d.id)?.issueDate);
    const latest = dated
      .map((d) => d.issueDate)
      .sort()
      .at(-1);
    const latestCount = dated.filter((d) => d.issueDate === latest).length;
    for (const doc of members) {
      const register = registers.get(doc.id);
      let status: DocumentStatus;
      let basis: string;
      if (!register || !register.issueDate) {
        status = 'ambiguous';
        basis = 'No drawing register or issue date could be read, so revision status is not established.';
      } else if (latestCount > 1 && doc.issueDate === latest) {
        status = 'ambiguous';
        basis = `Two packages in this family share the latest issue date (${formatDate(latest!)}).`;
      } else {
        status = doc.issueDate === latest ? 'current' : 'superseded';
        const others = members.filter((d) => d.id !== doc.id);
        const listed = register.entries.size;
        basis =
          `${register.registerSheet} register: package Rev ${register.revision}, issued ${formatDate(register.issueDate)}; ` +
          `${listed} sheets listed${register.declaredTotal ? ` (total stated: ${register.declaredTotal})` : ''}` +
          `${register.mismatches.length ? `; ${register.mismatches.length} title-block revision mismatches` : '; every title-block revision matches the register'}. ` +
          (others.length
            ? status === 'current'
              ? `Latest issue in this family (later than ${others.map((o) => `Rev ${o.revision} ${formatDate(o.issueDate)}`).join(', ')}).`
              : `A later package exists in this family (${others
                  .filter((o) => o.issueDate > doc.issueDate)
                  .map((o) => `Rev ${o.revision} ${formatDate(o.issueDate)}`)
                  .join(', ')}).`
            : 'Only issue of this document family in the pack; there is no later revision to compare.');
      }
      const agrees = doc.declaredStatus === status;
      doc.status = agrees ? status : 'ambiguous';
      doc.registerCheck = agrees ? 'agrees' : 'differs';
      doc.statusBasis = `${basis} Supplied label: ${doc.declaredStatus}${agrees ? ' (agrees)' : ' (DISAGREES)'}.`;
      if (!agrees)
        issues.push({
          id: `status-${doc.id}`,
          documentId: doc.id,
          title: `${doc.title}: revision status is ambiguous`,
          summary: `The drawing register indicates "${status}" but the supplied label says "${doc.declaredStatus}". ${basis}`,
          pageIds: register ? [register.pageId] : [],
        });
    }
  }

  // Certificates: current only if they reference the current package revision.
  for (const doc of documents.filter((d) => d.type === 'Certificate')) {
    const text = pages
      .filter((p) => p.documentId === doc.id)
      .map((p) => p.text)
      .join('\n');
    const ref = text.match(/DRAWINGS? NUMBER:\s*([A-Z]+)(\d+-\d{4}),\s*REV\.?\s*([A-Z])/i);
    const target = ref && documents.find((d) => d.type === 'Structure' && d.status === 'current');
    if (ref) doc.revision = ref[3].toUpperCase();
    if (ref && target && target.revision === doc.revision) {
      doc.status = 'current';
      doc.registerCheck = 'agrees';
      doc.statusBasis = `References ${ref[1]}${ref[2]} Rev ${doc.revision}, which is the current structural package. The certificate carries no issue date of its own.`;
    } else {
      doc.status = 'ambiguous';
      doc.registerCheck = 'differs';
      doc.statusBasis = ref
        ? `References Rev ${doc.revision}, which is not the current structural package revision.`
        : 'No referenced drawing revision could be read from the certificate.';
      issues.push({
        id: `status-${doc.id}`,
        documentId: doc.id,
        title: 'Certificate does not reference the current structural package',
        summary: doc.statusBasis,
        pageIds: pages.filter((p) => p.documentId === doc.id).map((p) => p.id),
      });
    }
  }

  for (const doc of documents.filter((d) => REFERENCE_TYPES.has(d.type))) {
    doc.status = 'reference';
    doc.registerCheck = 'not-applicable';
    doc.statusBasis = 'Assessment brief, policy or question file. Excluded from engineering evidence retrieval.';
  }

  return { documents, registers, issues };
}
