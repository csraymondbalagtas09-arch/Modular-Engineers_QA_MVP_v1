/**
 * Structured readings of the schedules that questions most often depend on:
 * the wall schedules (wall mark → system, thickness, reinforcement, f'c) and the
 * STR001 Concrete Quality schedule (element → f'c).
 *
 * Values are read from the extracted row text of each page, so every value keeps the
 * page it came from and the exact source row for citation.
 */
import { facts, findPage, getDocument } from './corpus';
import type { Fact } from './types';

export type WallRow = Fact & {
  verticalReinforcement?: string;
  horizontalReinforcement?: string;
  strengthMPa?: number;
};

const REINF = String.raw`(N\d+-\d+\s*E\.F\.)`;

/** Wall-schedule rows for a document, with reinforcement and f'c read from the row. */
export function wallRows(documentId: string | undefined): WallRow[] {
  if (!documentId) return [];
  return facts
    .filter((f) => f.documentId === documentId)
    .map((f) => {
      const m = f.evidence.match(
        new RegExp(`\\b${f.entity}\\s+(?:RITEK|CONCRETE) WALL\\s+\\d+\\s+${REINF}\\s+${REINF}\\s+(\\d+)\\s*MPa`),
      );
      // Rows such as "N12-00 E.F." do not match the reinforcement pattern cleanly; keep
      // the raw token so the anomaly stays visible instead of silently dropping it.
      const raw = f.evidence.match(
        new RegExp(
          `\\b${f.entity}\\s+(?:RITEK|CONCRETE) WALL\\s+\\d+\\s+(\\S+\\s*E\\.F\\.)\\s+(\\S+\\s*E\\.F\\.)\\s+(\\d+)\\s*MPa`,
        ),
      );
      const row = m || raw;
      return {
        ...f,
        verticalReinforcement: row?.[1].replace(/\s+/g, ' '),
        horizontalReinforcement: row?.[2].replace(/\s+/g, ' '),
        strengthMPa: row ? Number(row[3]) : undefined,
      };
    });
}

/** Wall schedule entries whose reinforcement token does not look like bar-spacing (e.g. "N12-00"). */
export function isImplausibleReinforcement(value?: string) {
  if (!value) return false;
  const m = value.match(/^N(\d+)-(\d+)/);
  return !m || Number(m[2]) < 50;
}

export function wallMarks(rows: WallRow[]) {
  return [...new Set(rows.map((r) => r.entity))].sort((a, b) => markOrder(a) - markOrder(b));
}

function markOrder(mark: string) {
  if (mark.startsWith('G')) return Number(mark.slice(2));
  const [level, n] = mark.split('W').map(Number);
  return level * 100 + n;
}

export type ConcreteRow = { element: string; strengthMPa: number; qualifier: string; line: string; pageId: string };

/** Rows of the Concrete Quality schedule (STR001) in a structural package. */
export function concreteSchedule(documentId: string | undefined): ConcreteRow[] {
  const page = findPage(documentId, /CONCRETE QUALITY/);
  if (!page || !getDocument(page.documentId)) return [];
  const lines = page.text.split('\n');
  const start = lines.findIndex((l) => /CONCRETE QUALITY/.test(l));
  const end = lines.findIndex((l, i) => i > start && /COVER SCHEDULE/.test(l));
  const rows: ConcreteRow[] = [];
  // Extracted rows interleave with neighbouring title-block text, so scan until the next schedule.
  for (const line of lines.slice(start + 1, end > start ? end : start + 40)) {
    // Element names are capitalised words before the slump column, e.g.
    // "SLAB ON GROUND 80mm 20mm A 25MPa U.O.N." (first word ≥3 letters skips "DD.MM.YY").
    const m = line.match(/\b([A-Z]{3,}(?:\s[A-Z]{2,})*)\s+\d+mm\s+\d+mm\s+\S+\s+(\d+)\s*MPa\s*(U\.O\.N\.)?/);
    if (m)
      rows.push({
        element: m[1],
        strengthMPa: Number(m[2]),
        qualifier: m[3] || '',
        line: line.trim(),
        pageId: page.id,
      });
  }
  return rows;
}

/** Plain-language names that map a question to a Concrete Quality schedule element. */
export const CONCRETE_ELEMENTS: { element: string; pattern: RegExp; label: string }[] = [
  {
    element: 'SUSPENDED SLAB',
    pattern: /suspended|elevated slab|upper[- ]floor slab|transfer slab/,
    label: 'suspended slab',
  },
  {
    element: 'SLAB ON GROUND',
    pattern: /slab[- ]on[- ]ground|on[- ]ground|ground[- ](?:floor[- ])?slab|ground[- ]bearing|\bsog\b/,
    label: 'slab on ground',
  },
  { element: 'FOOTING', pattern: /footing|\bpad\b|strip footing/, label: 'footing' },
  { element: 'PIERS', pattern: /\bpiers?\b|piering/, label: 'pier' },
  { element: 'BEAMS', pattern: /\bbeams?\b/, label: 'beam' },
];

/** Elements that are *not* in the Concrete Quality schedule but may be asked about. */
export const OTHER_CONCRETE_ELEMENTS = /column|wall|core|stair|lift|retaining|kerb|driveway|topping|blinding|pile/;
