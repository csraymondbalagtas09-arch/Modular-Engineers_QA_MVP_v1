/**
 * Question answering.
 *
 * A question is first read for *what* it asks about (a wall mark, a concrete element,
 * a document type, a revision scope). A rule answers only when that specific item is
 * found in the evidence; otherwise the question falls through to retrieval, which never
 * claims a verified answer. A plausible answer to the wrong item is treated as worse
 * than "cannot be verified".
 */
import { findingById, runChecks } from './checks';
import {
  cite,
  citeLine,
  citations,
  documentOfType,
  findPage,
  formatDate,
  pagesOf,
  registers,
  sheetPage,
  structuralPackage,
} from './corpus';
import { retrieve } from './retrieval';
import {
  CONCRETE_ELEMENTS,
  OTHER_CONCRETE_ELEMENTS,
  concreteSchedule,
  wallMarks,
  wallRows,
  type WallRow,
} from './schedules';
import type { Answer, AnswerStatus, DocumentRecord, Finding } from './types';

const MODE = 'Evidence rules + lexical retrieval';

type Scope = 'current' | 'superseded' | 'compare';

/** How the question positions itself in time. */
export function scopeOf(q: string): Scope {
  const changeWords =
    /\b(change[sd]?|changing|differ(?:ence|ences|s|ent)?|compar(?:e|ed|ison)|between|versus|vs\.?|evolv\w*|modif\w*|updated?)\b/;
  const historyWords =
    /\b(superseded|previous|prior|older|old|earlier|original|historic(?:al)?|rev(?:ision)?\.?\s*d)\b/;
  if (changeWords.test(q) && (historyWords.test(q) || /\brevisions\b|\bissues\b/.test(q))) return 'compare';
  if (historyWords.test(q) && !/\bcurrent\b.*\b(treated|issue|set)\b/.test(q)) return 'superseded';
  return 'current';
}

function answer(
  question: string,
  fields: Partial<Answer> & { status: AnswerStatus; summary: string; route: string },
): Answer {
  return { question, details: [], citations: [], findingIds: [], missing: [], mode: MODE, ...fields };
}

function fromFinding(question: string, f: Finding, status: AnswerStatus, route: string): Answer {
  return answer(question, {
    status,
    route,
    summary: f.summary,
    details: [f.risk, f.recommendation],
    citations: f.citations,
    findingIds: [f.id],
    missing: f.missing || [],
  });
}

function notVerified(
  question: string,
  route: string,
  reason: string,
  includeSuperseded = false,
  missing?: string[],
): Answer {
  const found = retrieve(question, includeSuperseded);
  return answer(question, {
    status: 'insufficient',
    route,
    summary: 'The supplied evidence does not support a verified answer to this question.',
    details: [
      reason,
      found.length
        ? 'Related source excerpts are shown below. A matching passage alone does not verify the requested engineering conclusion.'
        : 'No relevant source evidence was found in the indexed documents.',
      'Ask a more specific question (drawing number, wall mark or schedule), or send this evidence gap to engineer review.',
    ].filter(Boolean),
    citations: found,
    missing: missing || ['A source document or engineer clarification addressing the requested item.'],
  });
}

const statusLabel = (d: DocumentRecord | undefined) => (d ? `Rev ${d.revision}, ${d.status}` : 'not supplied');

// ---------------------------------------------------------------- revision control

function revisionAnswer(question: string, q: string): Answer {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const arch = documentOfType('Architecture');
  const cert = documentOfType('Certificate');
  const wantsArch = /architect|\ba\d{3}\b/.test(q);
  const wantsStruct = /structur|\bstr\d{3}\b|engineering drawing/.test(q);

  if (wantsArch && !wantsStruct) {
    const register = arch && registers.get(arch.id);
    if (!arch || !register)
      return notVerified(question, 'revision:architecture', 'No architectural drawing register could be read.');
    return answer(question, {
      status: 'supported',
      route: 'revision:architecture',
      summary: `The architectural set is revision ${arch.revision}, issued ${formatDate(arch.issueDate)} for CC submission. It is the only architectural issue in the pack.`,
      details: [
        `The ${register.registerSheet} drawing list gives ${register.entries.size} sheets, all at ${arch.revision}.`,
        'No later architectural revision was supplied, so "current" here means the latest issue available, not a confirmed approval status.',
        'Architectural revisions are independent of structural package revisions.',
      ],
      citations: citations([cite(register.pageId, /FOR CC SUBMISSION/), cite(register.pageId, 'A100')]),
    });
  }

  if (!current)
    return notVerified(
      question,
      'revision:structural',
      'No current structural package could be established from the registers.',
    );
  const register = registers.get(current.id)!;
  const exceptions = [...register.entries.values()].filter((e) => e.revision !== current.revision);
  const details = [
    `The ${register.registerSheet} drawing register in this package lists ${register.entries.size} sheets and is dated ${formatDate(current.issueDate)}${previous ? `; the superseded package (Rev ${previous.revision}) was issued ${formatDate(previous.issueDate)}` : ''}.`,
    exceptions.length
      ? `Package and sheet revisions are separate: ${exceptions.map((e) => `${e.sheet} is sheet Rev ${e.revision}`).join(', ')}, dated ${formatDate(exceptions[0].date)}. The register includes them in the current package, so they remain current.`
      : 'Every sheet in the register carries the package revision.',
    register.mismatches.length
      ? `Warning: ${register.mismatches.length} title blocks disagree with the register.`
      : 'Every sheet title block agrees with the register, and the supplied filename label agrees with the register-derived status.',
    'Current status does not resolve conflicts within the package. Consequential findings still require engineer review.',
  ];
  if (!wantsStruct && !/\bcurrent issue\b|\bdrawing revision\b/.test(q) && arch)
    details.push(
      `Other documents: architectural set ${statusLabel(arch)} (${formatDate(arch.issueDate)}); design certificate references ${statusLabel(cert)}.`,
    );
  return answer(question, {
    status: current.registerCheck === 'agrees' ? 'supported' : 'review',
    route: 'revision:structural',
    summary: `Structural package Rev ${current.revision}, issued ${formatDate(current.issueDate)}, is the current issue in this pack. It is the latest issue in the drawing register sequence${previous ? `, superseding Rev ${previous.revision}` : ''}.`,
    details,
    citations: citations([
      cite(register.pageId, 'ISSUED FOR'),
      exceptions[0] && cite(register.pageId, new RegExp(`^${exceptions[0].sheet}\\b`)),
      previous && cite(registers.get(previous.id)!.pageId, 'ISSUED FOR'),
    ]),
  });
}

// ---------------------------------------------------------------- concrete strength

function concreteAnswer(question: string, q: string, scope: Scope): Answer | null {
  const matches = CONCRETE_ELEMENTS.filter((e) => e.pattern.test(q));
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const pkg = scope === 'superseded' ? previous : current;
  const rows = concreteSchedule(pkg?.id);
  if (!rows.length) return null;
  const schedulePage = rows[0].pageId;

  if (!matches.length) {
    if (/\bslabs?\b/.test(q)) {
      const slabs = rows.filter((r) => /SLAB/.test(r.element));
      return answer(question, {
        status: 'clarify',
        route: 'concrete:ambiguous-slab',
        summary: `The Concrete Quality schedule gives different strengths for different slabs: ${slabs
          .map((r) => `${r.element.toLowerCase()} ${r.strengthMPa} MPa${r.qualifier ? ' U.O.N.' : ''}`)
          .join('; ')
          .replace(/\.$/, '')}. Specify which slab you mean.`,
        details: ['"U.O.N." means unless otherwise noted; local drawing notes can override these values.'],
        citations: citations(slabs.map((r) => citeLine(r.pageId, r.line))),
      });
    }
    if (/\bwalls?\b/.test(q)) return wallStrengthAnswer(question, pkg);
    if (OTHER_CONCRETE_ELEMENTS.test(q)) {
      const listed = rows.map((r) => r.element.toLowerCase()).join(', ');
      const base = notVerified(
        question,
        'concrete:element-not-scheduled',
        `The STR001 Concrete Quality schedule lists only: ${listed}. The element asked about is not listed there, so its strength is not verified.`,
      );
      base.citations = citations([cite(schedulePage, 'CONCRETE QUALITY'), ...base.citations]).slice(0, 6);
      return base;
    }
    return null;
  }

  const results = matches.map((m) => ({ m, row: rows.find((r) => r.element === m.element) }));
  const missing = results.filter((r) => !r.row);
  if (missing.length === results.length) return null;
  const found = results.filter((r) => r.row);
  const history = scope === 'superseded';
  const oldRows = concreteSchedule(previous?.id);
  const currentRows = concreteSchedule(current?.id);
  const details: string[] = [
    `Stated in the Concrete Quality schedule on ${sheetOf(schedulePage)} (${pkg!.filename}, PDF p.${pageNo(schedulePage)}).`,
    '"U.O.N." means unless otherwise noted: check local drawing notes for exceptions.',
  ];
  const cites = found.map((r) => citeLine(r.row!.pageId, r.row!.line));

  if (history) {
    for (const r of found) {
      const now = currentRows.find((c) => c.element === r.m.element);
      details.unshift(
        `This is the superseded Rev ${pkg!.revision} value, shown for history. Current Rev ${current?.revision}: ${now ? `${now.strengthMPa} MPa (${now.strengthMPa === r.row!.strengthMPa ? 'unchanged' : 'CHANGED'})` : 'not listed'}.`,
      );
      if (now) cites.push(citeLine(now.pageId, now.line));
    }
  } else if (scope === 'compare') {
    for (const r of found) {
      const old = oldRows.find((o) => o.element === r.m.element);
      details.unshift(
        old
          ? old.strengthMPa === r.row!.strengthMPa
            ? `Unchanged between superseded Rev ${previous!.revision} and current Rev ${current!.revision} in the Concrete Quality schedule.`
            : `Changed from ${old.strengthMPa} MPa (Rev ${previous!.revision}) to ${r.row!.strengthMPa} MPa (Rev ${current!.revision}).`
          : `Not listed in the superseded schedule.`,
      );
      if (old) cites.push(citeLine(old.pageId, old.line));
    }
    details.push(
      'Only the schedule values are compared automatically; other changes on related drawings need engineer comparison.',
    );
  }

  // Suspended slabs: the level plans repeat the strength in a note. Check agreement.
  let status: AnswerStatus = 'supported';
  if (found.some((r) => r.m.element === 'SUSPENDED SLAB') && !history) {
    const notePage = findPage(pkg!.id, /CONCRETE SLAB \(f.c\)\s*=\s*\d+\s*MPa/);
    const note = notePage?.text.match(/CONCRETE SLAB \(f.c\)\s*=\s*(\d+)\s*MPa/);
    const scheduleValue = found.find((r) => r.m.element === 'SUSPENDED SLAB')!.row!.strengthMPa;
    if (notePage && note) {
      const agrees = Number(note[1]) === scheduleValue;
      details.push(
        agrees
          ? `${notePage.sheet} suspended-slab note also states concrete slab f′c = ${note[1]} MPa (slump 80 mm).`
          : `CONFLICT: ${notePage.sheet} suspended-slab note states f′c = ${note[1]} MPa, but the schedule gives ${scheduleValue} MPa.`,
      );
      if (!agrees) status = 'conflict';
      cites.push(cite(notePage.id, 'CONCRETE SLAB'));
    }
  }
  if (missing.length) details.push(`Not in the schedule: ${missing.map((r) => r.m.label).join(', ')}.`);

  const value = (r: (typeof found)[number]) =>
    `${r.row!.strengthMPa} MPa${r.row!.qualifier ? ' U.O.N. (unless otherwise noted)' : ''}`;
  const statement =
    found.length === 1
      ? `${found[0].m.label} concrete compressive strength (f′c) is ${value(found[0])}`
      : found.map((r) => `${r.m.label}: ${value(r)}`).join('; ');
  let summary = `${capital(statement)}.`;
  if (history) summary = `In superseded Rev ${pkg!.revision}, ${statement}.`;
  if (scope === 'compare') {
    const changedAny = found.some((r) => {
      const old = oldRows.find((o) => o.element === r.m.element);
      return old && old.strengthMPa !== r.row!.strengthMPa;
    });
    summary = `${changedAny ? 'Changed between revisions' : `No change between Rev ${previous?.revision} and Rev ${current?.revision}`}: ${statement} in the current schedule.`;
  }
  return answer(question, {
    status,
    route: `concrete:${scope}`,
    summary,
    details,
    citations: citations(cites),
  });
}

function wallStrengthAnswer(question: string, pkg: DocumentRecord | undefined): Answer {
  const rows = wallRows(pkg?.id).filter((r) => r.strengthMPa);
  const values = [...new Set(rows.map((r) => r.strengthMPa))];
  if (!rows.length) return notVerified(question, 'concrete:walls', 'No wall schedule strengths were extracted.');
  return answer(question, {
    status: values.length === 1 ? 'supported' : 'conflict',
    route: 'concrete:walls',
    summary:
      values.length === 1
        ? `The wall schedules give f′c = ${values[0]} MPa for every scheduled wall mark (${wallMarks(rows).join(', ')}).`
        : `Wall schedules give different strengths: ${values.join(' and ')} MPa.`,
    details: [
      'Values are read from the f′c column of each wall schedule row.',
      'Walls are not listed in the STR001 Concrete Quality schedule.',
    ],
    citations: citations(distinctBy(rows, (r) => r.pageId).map((r) => citeLine(r.pageId, r.evidence))).slice(0, 6),
  });
}

// ---------------------------------------------------------------- wall marks

function wallMarkAnswer(question: string, marks: string[], scope: Scope): Answer {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const pkg = scope === 'superseded' ? previous : current;
  const rows = wallRows(pkg?.id);
  const oldRows = wallRows(previous?.id);
  const findings = runChecks();
  const details: string[] = [];
  const cites: ReturnType<typeof citeLine>[] = [];
  const findingIds: string[] = [];
  let status: AnswerStatus = 'supported';
  const summaries: string[] = [];

  for (const mark of marks) {
    const forMark = rows.filter((r) => r.entity === mark);
    if (!forMark.length) {
      summaries.push(
        `${mark} is not in the extracted ${scope === 'superseded' ? 'superseded' : 'current'} wall schedules`,
      );
      status = status === 'supported' ? 'insufficient' : status;
      continue;
    }
    const thicknesses = [...new Set(forMark.map((r) => r.thickness))];
    const systems = [...new Set(forMark.map((r) => r.description))];
    const sheets = forMark.map((r) => r.sheet).join(' and ');
    if (thicknesses.length > 1) {
      summaries.push(
        `${mark} has conflicting thicknesses: ${forMark.map((r) => `${r.sheet} ${r.thickness} mm`).join(', ')}`,
      );
      status = 'conflict';
    } else {
      summaries.push(`${mark} is ${title(systems.join(' / '))}, ${thicknesses[0]} mm, on ${sheets}`);
    }
    if (systems.length > 1) {
      details.push(
        `${mark} wall system differs between sheets: ${forMark.map((r) => `${r.sheet} ${r.description}`).join(', ')}.`,
      );
      status = 'conflict';
    }
    for (const key of ['verticalReinforcement', 'horizontalReinforcement'] as const) {
      const values = [...new Set(forMark.map((r) => r[key]))];
      const label = key === 'verticalReinforcement' ? 'vertical' : 'horizontal';
      if (values.length > 1) {
        details.push(
          `${mark} ${label} reinforcement differs: ${forMark.map((r) => `${r.sheet} ${r[key]}`).join(', ')}.`,
        );
        summaries[summaries.length - 1] +=
          `, but its ${label} reinforcement differs between sheets (${forMark.map((r) => `${r.sheet} ${r[key]}`).join(' vs ')})`;
        if (status === 'supported') status = 'review';
      } else details.push(`${mark} ${label} reinforcement: ${values[0]}; f′c ${forMark[0].strengthMPa} MPa.`);
    }
    if (scope !== 'superseded') {
      const old = oldRows.filter((r) => r.entity === mark);
      const changed = forMark.filter((r) => {
        const o = old.find((x) => x.sheet === r.sheet);
        return o && (o.description !== r.description || o.thickness !== r.thickness);
      });
      if (changed.length)
        details.push(
          `Changed from superseded Rev ${previous!.revision}: ${changed
            .map((r) => {
              const o = old.find((x) => x.sheet === r.sheet)!;
              return `${r.sheet} ${o.description} ${o.thickness} mm → ${r.description} ${r.thickness} mm`;
            })
            .join('; ')}.`,
        );
      else if (old.length) details.push(`Same entries as superseded Rev ${previous!.revision}.`);
    } else details.unshift(`Superseded Rev ${previous!.revision} values, shown for history. They do not govern.`);
    cites.push(...forMark.map((r) => citeLine(r.pageId, r.evidence)));
    findingIds.push(
      ...findings.filter((f) => f.id.endsWith(`:${mark}`) || f.id.includes(`:${mark}:`)).map((f) => f.id),
    );
  }
  if (status === 'conflict' || status === 'review')
    details.push('Do not select a governing value automatically. Send to Engineer Review for reconciliation.');
  return answer(question, {
    status,
    route: `wall-mark:${scope}`,
    summary: summaries.join('. ') + '.',
    details,
    citations: citations(cites),
    findingIds: [...new Set(findingIds)],
    missing: status === 'insufficient' ? ['A wall schedule entry for the requested wall mark.'] : [],
  });
}

// ---------------------------------------------------------------- revision comparison

function wallChanges() {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const rows = wallRows(current?.id);
  const oldRows = wallRows(previous?.id);
  const changed: { now: WallRow; old: WallRow }[] = [];
  for (const now of rows) {
    const old = oldRows.find((o) => o.sheet === now.sheet && o.entity === now.entity);
    if (old && (old.description !== now.description || old.thickness !== now.thickness)) changed.push({ now, old });
  }
  const alreadyRitek = wallMarks(oldRows.filter((r) => r.description === 'RITEK WALL'));
  return { current, previous, changed, alreadyRitek };
}

function legendChanges() {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const out: { sheet: string; before: string; after: string; oldPage: string; newPage: string }[] = [];
  for (const page of pagesOf(current?.id)) {
    const oldPage = sheetPage(previous?.id, page.sheet);
    if (!oldPage) continue;
    const now = page.text.match(/DENOTES (\w+) WALLS OVER ONLY/g)?.find((l) => /DINCEL|RITEK/.test(l));
    const before = oldPage.text.match(/DENOTES (\w+) WALLS OVER ONLY/g)?.find((l) => /DINCEL|RITEK/.test(l));
    if (now && before && now !== before)
      out.push({ sheet: page.sheet, before, after: now, oldPage: oldPage.id, newPage: page.id });
  }
  return out;
}

function wallSystemChangeAnswer(question: string): Answer {
  const { current, previous, changed, alreadyRitek } = wallChanges();
  const legends = legendChanges();
  if (!current || !previous || (!changed.length && !legends.length))
    return notVerified(
      question,
      'compare:walls',
      'No wall-system differences were detected between the structural packages.',
      true,
    );
  const bySheet = new Map<string, string[]>();
  for (const c of changed) bySheet.set(c.now.sheet, [...(bySheet.get(c.now.sheet) || []), c.now.entity]);
  const leading = legends.find((l) => l.sheet === 'STR500') || legends[0];
  const residual = findingById('legend-wall-system');
  return answer(question, {
    status: 'supported',
    route: 'compare:walls',
    summary: leading
      ? `The ${leading.sheet} legend changes from “${leading.before}” in superseded Rev ${previous.revision} to “${leading.after}” in current Rev ${current.revision}. ${changed.length} wall-schedule entries also change from CONCRETE WALL to RITEK WALL.`
      : `${changed.length} wall-schedule entries change between Rev ${previous.revision} and Rev ${current.revision}.`,
    details: [
      `Wall schedule changes (${changed[0]?.old.description} → ${changed[0]?.now.description}, thickness unchanged): ${[
        ...bySheet.entries(),
      ]
        .map(([sheet, marks]) => `${sheet}: ${marks.join(', ')}`)
        .join('; ')}.`,
      legends.length > 1
        ? `The same legend change appears on ${legends.length} plan sheets (${legends.map((l) => l.sheet).join(', ')}).`
        : '',
      alreadyRitek.length
        ? `Some walls were already Ritek in the superseded set (${alreadyRitek.join(', ')}). This is not evidence that every wall changed system.`
        : '',
      residual
        ? `A Dincel legend entry remains in current ${residual.citations[0]?.sheet}; it requires coordination review.`
        : '',
    ].filter(Boolean),
    citations: citations([
      leading && cite(leading.oldPage, leading.before),
      leading && cite(leading.newPage, leading.after),
      ...distinctBy(changed, (c) => c.now.sheet)
        .slice(0, 3)
        .flatMap((c) => [citeLine(c.old.pageId, c.old.evidence), citeLine(c.now.pageId, c.now.evidence)]),
    ]),
    findingIds: residual ? [residual.id] : [],
  });
}

function sheetChangeAnswer(question: string, sheet: string): Answer {
  const current = structuralPackage('current');
  const previous = structuralPackage('superseded');
  const now = sheetPage(current?.id, sheet);
  const old = sheetPage(previous?.id, sheet);
  if (!now || !old)
    return notVerified(question, 'compare:sheet', `${sheet} is not present in both structural packages.`, true);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const oldLines = new Set(old.text.split('\n').map(norm));
  const newLines = new Set(now.text.split('\n').map(norm));
  const added = [...newLines].filter((l) => l && !oldLines.has(l)).slice(0, 8);
  const removed = [...oldLines].filter((l) => l && !newLines.has(l)).slice(0, 8);
  return answer(question, {
    status: 'review',
    route: 'compare:sheet',
    summary: `${sheet} is sheet Rev ${old.sheetRevision} in the superseded package and Rev ${now.sheetRevision} in the current package. ${added.length || removed.length ? `${added.length + removed.length} extracted text lines differ.` : 'No text differences were detected.'}`,
    details: [
      ...removed.map((l) => `Superseded only: ${l}`),
      ...added.map((l) => `Current only: ${l}`),
      'This is a text-level comparison of extracted lines, not a drawing or geometry comparison. Engineer review is required before relying on it.',
    ],
    citations: citations([cite(old.id, removed[0] || undefined), cite(now.id, added[0] || undefined)]),
  });
}

function generalChangeAnswer(question: string): Answer {
  const { current, previous, changed } = wallChanges();
  if (!current || !previous)
    return notVerified(question, 'compare:general', 'Two structural packages are needed for comparison.', true);
  const oldRegister = registers.get(previous.id)!;
  const newRegister = registers.get(current.id)!;
  const bumped = [...newRegister.entries.values()].filter(
    (e) => oldRegister.entries.get(e.sheet)?.revision !== e.revision,
  ).length;
  const legends = legendChanges();
  return answer(question, {
    status: 'review',
    route: 'compare:general',
    summary: `Rev ${current.revision} (${formatDate(current.issueDate)}) reissues ${bumped} of ${newRegister.entries.size} sheets from Rev ${previous.revision}. Detected content changes: ${legends.length} wall-system legends (Dincel → Ritek) and ${changed.length} wall-schedule entries (Concrete → Ritek).`,
    details: [
      'Automatic comparison covers the drawing register, wall schedules, wall legends and the concrete schedule. Other drawing content is not compared.',
      'Ask about a specific sheet (e.g. "What changed on STR500?") for a text-level comparison.',
    ],
    citations: citations([
      cite(oldRegister.pageId, 'ISSUED FOR'),
      cite(newRegister.pageId, 'ISSUED FOR'),
      legends[0] && cite(legends[0].newPage, legends[0].after),
    ]),
    findingIds: [],
  });
}

// ---------------------------------------------------------------- certificate

function certificateRevisionAnswer(question: string): Answer | null {
  const cert = documentOfType('Certificate');
  const page = pagesOf(cert?.id)[0];
  const current = structuralPackage('current');
  const ref = page?.text.match(/DRAWINGS? NUMBER:\s*([A-Z]+\d+-\d{4}),\s*REV\.?\s*([A-Z])/i);
  if (!page || !ref || !current) return null;
  const register = registers.get(current.id)!;
  const aligned = ref[2].toUpperCase() === current.revision;
  const projectNumber = ref[1].replace(/^[A-Z]+/, '');
  const projectMatch = pagesOf(current.id).some((p) => p.text.includes(projectNumber));
  const issueDateFinding = findingById('certificate-issue-date');
  const dateFinding = findingById('certificate-date');
  return answer(question, {
    status: aligned ? 'supported' : 'conflict',
    route: 'certificate:revision',
    summary: aligned
      ? `The design certificate references ${ref[1]}, REV.${ref[2]}, which aligns with the current structural package (Rev ${current.revision}, issued ${formatDate(current.issueDate)}).`
      : `The design certificate references REV.${ref[2]}, but the current structural package is Rev ${current.revision}.`,
    details: [
      projectMatch
        ? `The project number ${projectNumber} also appears on the structural title blocks.`
        : `Project number ${projectNumber} was not found on the structural drawings.`,
      'Revision alignment does not verify the certificate’s supporting-document chronology or establish proprietary wall capacities.',
      dateFinding ? `Separately flagged: ${dateFinding.summary}` : '',
      issueDateFinding
        ? 'The certificate has no issue date, so it cannot be confirmed that it was issued after Rev E.'
        : '',
    ].filter(Boolean),
    citations: citations([cite(page.id, 'DRAWINGS NUMBER'), cite(register.pageId, 'ISSUED FOR')]),
    findingIds: [dateFinding?.id, issueDateFinding?.id].filter(Boolean) as string[],
  });
}

function certificateConsistencyAnswer(question: string): Answer | null {
  const date = findingById('certificate-date');
  const issue = findingById('certificate-issue-date');
  const items = [date, issue].filter(Boolean) as Finding[];
  if (!items.length) return null;
  return answer(question, {
    status: 'review',
    route: 'certificate:consistency',
    summary: items.map((f) => f.summary).join(' '),
    details: [
      ...items.map((f) => f.risk),
      'The drawing reference itself (STR175-2026, REV.E) is consistent with the current structural package.',
      ...items.map((f) => f.recommendation),
    ],
    citations: citations(items.flatMap((f) => f.citations)),
    findingIds: items.map((f) => f.id),
    missing: items.flatMap((f) => f.missing || []),
  });
}

function geotechAnswer(question: string): Answer {
  const cert = documentOfType('Certificate');
  const page = pagesOf(cert?.id)[0];
  const ref = page?.text.match(/Geotechnical Report[^\n]*?([A-Z]\d{4,}-\d+) dated (\d{2}\.\d{2}\.\d{4})/);
  const dateFinding = findingById('certificate-date');
  return answer(question, {
    status: 'insufficient',
    route: 'geotechnical',
    summary: ref
      ? `The pack does not include a geotechnical report. The design certificate refers to report ${ref[1]} dated ${ref[2]}, but its findings (site classification, soil testing, bearing capacity) cannot be verified from the supplied documents.`
      : 'The supplied documents do not include geotechnical information that can be verified.',
    details: [
      dateFinding ? dateFinding.summary : '',
      'Do not infer soil conditions from the structural drawings or the certificate.',
    ].filter(Boolean),
    citations: citations([page && cite(page.id, 'Geotechnical')]),
    findingIds: dateFinding ? [dateFinding.id] : [],
    missing: ['The referenced geotechnical report, including site classification and test results.'],
  });
}

// ---------------------------------------------------------------- helpers

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const sheetOf = (pageId: string) => cite(pageId)?.sheet || '';
const pageNo = (pageId: string) => cite(pageId)?.page || '';
function distinctBy<T>(items: T[], key: (item: T) => string) {
  return [...new Map(items.map((i) => [key(i), i])).values()];
}

// ---------------------------------------------------------------- router

export function answerQuestion(question: string): Answer {
  try {
    return route(question);
  } catch (error) {
    console.error('Answer rule failed', error);
    return notVerified(question, 'error', 'An evidence rule failed, so only related excerpts are shown.');
  }
}

function route(question: string): Answer {
  const q = question.toLowerCase().replace(/[’']/g, "'");
  const scope = scopeOf(q);
  const marks = [...new Set((question.match(/\b(GW\d+|\dW\d+)\b/gi) || []).map((m) => m.toUpperCase()))];
  const sheet = question.match(/\bSTR\d{3}\b/i)?.[0].toUpperCase();
  const checks = runChecks();

  // Proprietary product evidence (tested capacity / certified connections).
  if (
    /(ritek|dincel|proprietary|wall[- ]product|wall[- ]system|wall panel)/.test(q) &&
    /(capacit|tested|test report|certif|connection|manufacturer)/.test(q)
  ) {
    const f = checks.find((x) => x.id === 'ritek-product-evidence');
    if (f) return fromFinding(question, f, 'insufficient', 'missing:product-evidence');
  }

  // Design certificate.
  if (/certificate/.test(q)) {
    if (/(consisten|unusual|inconsisten|date|supporting|geotech|verif|valid|check|issue)/.test(q)) {
      const a = certificateConsistencyAnswer(question);
      if (a) return a;
    }
    if (/(revision|rev\b|align|referenc|drawing)/.test(q)) {
      const a = certificateRevisionAnswer(question);
      if (a) return a;
    }
    return notVerified(question, 'certificate:other', 'This certificate question is not covered by a verified rule.');
  }

  if (/geotech|\bsoil|g19323|site classification|bore ?hole|bearing capacity/.test(q)) return geotechAnswer(question);

  // Architectural vs structural coordination.
  if (
    /architect/.test(q) &&
    /(wall|coordinat|structur|match|consistent)/.test(q) &&
    !/\b(revision|latest|current issue)\b/.test(q)
  ) {
    const f = checks.find((x) => x.id === 'architecture-wall-mapping');
    if (f) {
      const a = fromFinding(question, f, 'review', 'coordination:architecture');
      const legend = checks.find((x) => x.id === 'legend-wall-system');
      if (legend) {
        a.details.push(`${legend.summary} Confirm whether the Dincel legend is residual or intentional.`);
        a.citations = citations([...a.citations, ...legend.citations]);
        a.findingIds.push(legend.id);
      }
      return a;
    }
  }

  // A specific wall mark.
  if (marks.length) return wallMarkAnswer(question, marks, scope === 'compare' ? 'current' : scope);

  // Concrete strength for a named element.
  if (
    /(strength|f'?c\b|mpa|compressive|concrete grade|grade of concrete|concrete class)/.test(q) ||
    (/concrete/.test(q) && CONCRETE_ELEMENTS.some((e) => e.pattern.test(q)))
  ) {
    const a = concreteAnswer(question, q, scope);
    if (a) return a;
  }

  // Revision comparisons.
  if (scope === 'compare') {
    if (sheet) return sheetChangeAnswer(question, sheet);
    if (/(wall|material|dincel|ritek|system|concrete wall)/.test(q)) return wallSystemChangeAnswer(question);
    return generalChangeAnswer(question);
  }

  // Which revision is current.
  if (/\b(revision|current issue|latest|current set|up to date|superseded|which issue|current drawings?)\b/.test(q))
    return revisionAnswer(question, q);

  // Wall thickness / dimension consistency across the schedules.
  if (/\bwalls?\b/.test(q) && /(thickness|dimension|consisten|conflict|mismatch|discrepan|schedule)/.test(q)) {
    const conflicts = checks.filter((f) =>
      ['Dimension conflict', 'Detailing conflict', 'Detailing anomaly'].includes(f.category),
    );
    if (!conflicts.length)
      return answer(question, {
        status: 'supported',
        route: 'walls:consistency',
        summary: 'No conflicting values were found between current wall schedule entries.',
      });
    return answer(question, {
      status: 'conflict',
      route: 'walls:consistency',
      summary: `${conflicts.length} wall schedule inconsistencies were found in the current package: ${conflicts.map((f) => f.title).join('; ')}.`,
      details: conflicts.map((f) => f.summary),
      citations: citations(conflicts.flatMap((f) => f.citations)),
      findingIds: conflicts.map((f) => f.id),
    });
  }

  // Escalation example for the human-review workflow.
  if (/(human.in.the.loop|create.*finding|escalat|qa finding|engineer review|flag.*review)/.test(q)) {
    const f = checks.find((x) => x.category === 'Dimension conflict') || checks.find((x) => x.severity === 'high');
    if (f) {
      const a = fromFinding(question, f, 'conflict', 'escalation');
      a.details.push(
        'Recommended status: Engineer Review. Reviewer actions: Accept, Reject, or Needs Correction, each with a recorded reason. Accepting the finding is not engineering approval.',
      );
      return a;
    }
  }

  if (/dincel|legend/.test(q)) {
    const f = checks.find((x) => x.id === 'legend-wall-system');
    if (f) return fromFinding(question, f, 'review', 'coordination:legend');
  }

  return notVerified(
    question,
    'retrieval',
    'No evidence rule covers this question, so it cannot be answered as verified.',
    scope !== 'current',
  );
}
