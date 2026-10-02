/**
 * Deterministic QA checks over the current document set.
 *
 * Every finding cites the pages it relies on and states its uncertainty. Findings are
 * advisory and start at "AI Flagged"; an engineer decides what they mean.
 */
import {
  cite,
  citeLine,
  citations,
  documentOfType,
  findPage,
  formatDate,
  getPage,
  pagesOf,
  revisionIssues,
  structuralPackage,
} from './corpus';
import { isImplausibleReinforcement, wallMarks, wallRows, type WallRow } from './schedules';
import type { Finding } from './types';

export const missingProductEvidence = [
  'Exact manufacturer product/model and specification revision, mapped to every wall mark and location.',
  'Applicable product test reports and certification with scope, configuration and limitations.',
  'Manufacturer design capacities and the loading, geometry and material assumptions supporting them.',
  'Project-specific connection details and certified connection capacities, including anchors and substrate.',
  'Engineer confirmation that the product and connection evidence applies to these wall assemblies.',
];

const base = { status: 'AI Flagged', version: 0 } as const;

const distinct = <T>(rows: WallRow[], key: (r: WallRow) => T) => [...new Map(rows.map((r) => [key(r), r])).values()];

/** Same wall mark, different thickness between current sheets. Also reports carry-over from the superseded set. */
function dimensionConflicts(): Finding[] {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const rows = wallRows(current?.id);
  const oldRows = wallRows(previous?.id);
  const out: Finding[] = [];
  for (const mark of wallMarks(rows)) {
    const forMark = rows.filter((r) => r.entity === mark);
    const values = distinct(forMark, (r) => r.thickness);
    if (values.length < 2) continue;
    const oldValues = distinct(
      oldRows.filter((r) => r.entity === mark),
      (r) => r.thickness,
    );
    const carried = oldValues.length > 1;
    out.push({
      ...base,
      id: `dimension-${current!.family}:${mark}`,
      title: `${mark} has conflicting wall thicknesses`,
      category: 'Dimension conflict',
      severity: 'high',
      summary:
        values.map((r) => `${r.sheet} specifies ${r.thickness} mm`).join('; ') +
        `. Both sheets belong to the current structural package (Rev ${current!.revision}).` +
        (carried
          ? ` The same discrepancy exists in superseded Rev ${previous!.revision} (${oldValues
              .map((r) => `${r.sheet} ${r.thickness} mm`)
              .join(', ')}), so it was carried into the current issue unresolved.`
          : ''),
      risk: 'The governing thickness cannot be established from these competing schedules. Do not select a value automatically.',
      recommendation: 'Ask the structural engineer to reconcile the schedules and issue the governing thickness.',
      citations: citations([
        ...values.map((r) => citeLine(r.pageId, r.evidence)),
        ...(carried ? oldValues.map((r) => citeLine(r.pageId, r.evidence)) : []),
      ]),
      origin: 'Rule: same wall mark, different thickness in current wall schedules',
    });
  }
  return out;
}

/** Same wall mark, different reinforcement; and reinforcement tokens that cannot be valid spacing. */
function reinforcementChecks(): Finding[] {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const rows = wallRows(current?.id);
  const oldRows = wallRows(previous?.id);
  const out: Finding[] = [];
  for (const mark of wallMarks(rows)) {
    const forMark = rows.filter((r) => r.entity === mark);
    const oldForMark = oldRows.filter((r) => r.entity === mark);
    for (const [key, label] of [
      ['verticalReinforcement', 'vertical'],
      ['horizontalReinforcement', 'horizontal'],
    ] as const) {
      const invalid = forMark.filter((r) => isImplausibleReinforcement(r[key]));
      const valid = forMark.filter((r) => !isImplausibleReinforcement(r[key]));
      const values = distinct(valid, (r) => r[key]);
      const carried = (predicate: (r: WallRow) => boolean) => oldForMark.some(predicate);
      if (invalid.length) {
        const r = invalid[0];
        const other = valid.find((v) => v[key]);
        const wasThere = carried((o) => o.sheet === r.sheet && o[key] === r[key]);
        out.push({
          ...base,
          id: `reinforcement-format-${current!.family}:${mark}:${label}`,
          title: `${mark} ${label} reinforcement reads "${r[key]}" on ${r.sheet}`,
          category: 'Detailing anomaly',
          severity: 'medium',
          summary:
            `The ${r.sheet} wall schedule gives ${mark} ${label} reinforcement as "${r[key]}", which is not a usable bar spacing.` +
            (other ? ` ${other.sheet} gives ${other[key]} for the same wall mark.` : '') +
            (wasThere ? ` The same entry appears in superseded Rev ${previous!.revision}.` : ''),
          risk: 'This is likely a drafting error (for example a missing digit), but the intended spacing cannot be inferred from the documents.',
          recommendation: `Ask the engineer to confirm the ${label} reinforcement for ${mark} and correct the schedule.`,
          citations: citations([citeLine(r.pageId, r.evidence), other && citeLine(other.pageId, other.evidence)]),
          origin: 'Rule: reinforcement spacing token outside a plausible range (confirmed against the PDF text)',
        });
      }
      if (values.length > 1) {
        const wasThere = distinct(oldForMark, (o) => o[key]).length > 1;
        out.push({
          ...base,
          id: `reinforcement-${current!.family}:${mark}:${label}`,
          title: `${mark} has conflicting ${label} reinforcement`,
          category: 'Detailing conflict',
          severity: 'high',
          summary:
            values.map((r) => `${r.sheet} specifies ${r[key]}`).join('; ') +
            ` for ${mark} ${label} reinforcement in the current package.` +
            (wasThere ? ` The same difference exists in superseded Rev ${previous!.revision}.` : ''),
          risk: 'The governing reinforcement cannot be established from competing current schedules.',
          recommendation: `Ask the engineer to confirm the governing ${label} reinforcement for ${mark} and reconcile the schedules.`,
          citations: citations(values.map((r) => citeLine(r.pageId, r.evidence))),
          origin: 'Rule: same wall mark, different reinforcement in current wall schedules',
        });
      }
    }
  }
  return out;
}

/** Proprietary wall-system names used in "DENOTES … WALLS OVER" legends of the current set. */
function legendCheck(): Finding[] {
  const current = structuralPackage('current');
  const systems = new Map<string, { pageId: string; line: string }[]>();
  for (const page of pagesOf(current?.id)) {
    for (const line of page.text.split('\n')) {
      const m = line.match(/DENOTES (?:REINFORCED )?(DINCEL|RITEK) WALLS OVER/);
      if (m) systems.set(m[1], [...(systems.get(m[1]) || []), { pageId: page.id, line: m[0] }]);
    }
  }
  if (systems.size < 2) return [];
  const [minority] = [...systems.entries()].sort((a, b) => a[1].length - b[1].length)[0];
  const majority = [...systems.keys()].find((k) => k !== minority)!;
  const minorityPages = systems.get(minority)!;
  const majorityPages = systems.get(majority)!;
  const sheetsOf = (list: { pageId: string }[]) => [...new Set(list.map((x) => getPage(x.pageId)!.sheet))];
  return [
    {
      ...base,
      id: 'legend-wall-system',
      title: `${title(minority)} remains in a current drawing legend`,
      category: 'Coordination',
      severity: 'medium',
      summary: `${sheetsOf(minorityPages).join(', ')} legend names ${title(minority)} walls, while ${majorityPages.length} current legends (${sheetsOf(majorityPages).slice(0, 4).join(', ')}${majorityPages.length > 4 ? ', …' : ''}) name ${title(majority)} walls.`,
      risk: 'This may be an outdated legend or a distinct intended system. The supplied documents do not settle that interpretation.',
      recommendation: 'Confirm which wall system applies and reconcile the current legends and schedules.',
      citations: citations([cite(minorityPages[0].pageId, minority), cite(majorityPages[0].pageId, majority)]),
      origin: 'Rule: competing proprietary wall systems named in current legends',
    },
  ];
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Certificate chronology and completeness. */
function certificateChecks(): Finding[] {
  const cert = documentOfType('Certificate');
  const page = pagesOf(cert?.id)[0];
  const current = structuralPackage('current');
  if (!page || !current) return [];
  const out: Finding[] = [];
  const reports = [...page.text.matchAll(/([A-Z]\d{4,}-\d+) dated (\d{2})\.(\d{2})\.(\d{4})/g)];
  for (const r of reports) {
    const date = `${r[4]}-${r[3]}-${r[2]}`;
    if (date <= current.issueDate) continue;
    out.push({
      ...base,
      id: 'certificate-date',
      title: 'Certificate cites a later geotechnical report',
      category: 'Certificate QA',
      severity: 'high',
      summary: `The certificate cites report ${r[1]} dated ${formatDate(date)} (${date}); the current structural issue is ${formatDate(current.issueDate)} (${current.issueDate}).`,
      risk: 'A design cannot normally rely on a report dated after the drawings it certifies. The date may be a typo, or the report may not be the one used. This is a concern to investigate, not proof the certificate is invalid.',
      recommendation: `Obtain ${r[1]}, verify its issue date and applicability, and ask for a dated certificate or clarification.`,
      missing: [`Geotechnical report ${r[1]} (not supplied in the pack).`],
      citations: citations([
        cite(page.id, r[1]),
        cite(findPage(current.id, /DRAWING SCHEDULE/)?.id || '', 'ISSUED FOR'),
      ]),
      origin: 'Rule: supporting-report date later than the certified drawing issue',
    });
  }
  // Any date on the certificate other than those of referenced reports would be its issue date.
  const allDates = page.text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g) || [];
  const reportDates = new Set(reports.map((r) => `${r[2]}.${r[3]}.${r[4]}`));
  if (!allDates.some((d) => !reportDates.has(d)))
    out.push({
      ...base,
      id: 'certificate-issue-date',
      title: 'Design certificate has no issue date',
      category: 'Certificate QA',
      severity: 'medium',
      summary:
        'The certificate is signed but states no date of its own. The only date on it belongs to the referenced geotechnical report.',
      risk: 'Without an issue date it cannot be confirmed that the certificate was issued for, and after, the current drawing revision.',
      recommendation: 'Request a dated certificate or written confirmation of when it was issued.',
      missing: ['The certificate issue date, or a dated reissue.'],
      citations: citations([cite(page.id, 'DRAWINGS NUMBER'), cite(page.id, 'Director')]),
      origin: 'Rule: certificate text contains no date other than referenced reports',
    });
  return out;
}

/** Architectural wall types vs structural wall schedules. */
function architectureChecks(): Finding[] {
  const arch = documentOfType('Architecture');
  const current = structuralPackage('current');
  const archPage = findPage(arch?.id, /Ritek XL\s*-\s*\d{3}/);
  if (!archPage || !current) return [];
  const types = [...new Set(archPage.text.match(/Ritek XL\s*-\s*\d{3}-?[A-Z]/g) || [])].map((t) =>
    t.replace(/Ritek XL\s*-\s*/, ''),
  );
  const archThicknesses = [...new Set(types.map((t) => Number(t.slice(0, 3))))].sort();
  const rows = wallRows(current.id).filter((r) => r.description === 'RITEK WALL');
  const structThicknesses = [...new Set(rows.map((r) => r.thickness))].sort();
  const notInStructure = archThicknesses.filter((t) => !structThicknesses.includes(t));
  // Cite the sheet carrying the most wall-schedule rows (the full schedule).
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.pageId, (counts.get(r.pageId) || 0) + 1);
  const schedulePageId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const out: Finding[] = [
    {
      ...base,
      id: 'architecture-wall-mapping',
      title: 'Confirm architectural wall types against structural marks',
      category: 'Coordination',
      severity: 'medium',
      summary:
        `Architecture (${archPage.sheet}) names Ritek XL ${types.join(', ')}. Current structural wall schedules use Ritek wall marks at ${structThicknesses.join(' mm and ')} mm without a product-to-location cross-reference.` +
        (notInStructure.length
          ? ` No ${notInStructure.join(' or ')} mm Ritek wall appears in the extracted structural wall schedules; those types may be non-structural (the architectural legend marks some as internal), but that is not stated.`
          : ''),
      risk: 'Shared use of the Ritek name establishes broad agreement only. Exact wall assemblies, thicknesses, locations and connections still require confirmation.',
      recommendation:
        'Have the engineer reconcile each architectural wall type and location with its structural mark, thickness and connection detail, and confirm which types are structural.',
      citations: citations([
        cite(archPage.id, 'Ritek XL'),
        schedulePageId ? cite(schedulePageId, 'RITEK WALL') : undefined,
      ]),
      origin: 'Scoped coordination check; geometric matching requires human review',
    },
  ];
  return out;
}

function productEvidenceCheck(): Finding {
  const arch = documentOfType('Architecture');
  const current = structuralPackage('current');
  const cert = documentOfType('Certificate');
  const archPage = findPage(arch?.id, /Ritek XL/);
  const schedule = findPage(current?.id, /WALL SCHEDULE/) || findPage(current?.id, /RITEK WALL/);
  return {
    ...base,
    id: 'ritek-product-evidence',
    title: 'Ritek product and connection capacities are unverified',
    category: 'Missing evidence',
    severity: 'high',
    summary:
      'Architectural product names and structural wall schedules are present. The supplied pack does not establish tested manufacturer capacities and certified connections for every wall.',
    risk: 'A material name, concrete grade or general design certificate cannot establish proprietary product and connection capacities.',
    recommendation:
      'Request product-specific and project-applicable technical evidence before accepting a capacity claim.',
    missing: missingProductEvidence,
    citations: citations([
      archPage && cite(archPage.id, 'Ritek'),
      schedule && cite(schedule.id, 'RITEK WALL'),
      pagesOf(cert?.id)[0] && cite(pagesOf(cert?.id)[0].id, 'DRAWINGS NUMBER'),
    ]),
    origin: 'Evidence-gap check for supplied assessment pack; not a general proof of absence',
  };
}

function revisionChecks(): Finding[] {
  return revisionIssues.map((issue) => ({
    ...base,
    id: issue.id,
    title: issue.title,
    category: 'Revision control',
    severity: 'high',
    summary: issue.summary,
    risk: 'Evidence from this document may not be the governing revision.',
    recommendation: 'Confirm the issued revision with the document controller before relying on this document.',
    citations: citations(issue.pageIds.map((id) => cite(id))),
    origin: 'Rule: drawing register, title blocks and supplied label must agree',
  }));
}

let cache: Finding[] | null = null;

/** All standing findings. Returns fresh copies because callers attach review state. */
export function runChecks(): Finding[] {
  if (!cache) {
    const all = [
      ...revisionChecks(),
      ...dimensionConflicts(),
      ...reinforcementChecks(),
      ...legendCheck(),
      ...certificateChecks(),
      productEvidenceCheck(),
      ...architectureChecks(),
    ];
    // Keep only findings that have evidence to show.
    cache = all.filter((f) => f.citations.length > 0);
  }
  return structuredClone(cache);
}

export const findingById = (id: string) => runChecks().find((f) => f.id === id);
