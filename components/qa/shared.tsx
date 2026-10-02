'use client';
import { PanelRightOpen } from 'lucide-react';
import type { AnswerStatus, Citation } from '@/lib/types';

/** Calls the workspace API and throws the server's message on failure. */
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    '/api/' + path,
    body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined,
  );
  const value: any = await response.json();
  if (!response.ok) throw new Error(value.error || 'Unable to complete this action.');
  return value;
}

export function downloadJSON(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Badge({ children, kind = 'neutral' }: { children: React.ReactNode; kind?: string }) {
  return <span className={'badge ' + kind}>{children}</span>;
}

export const answerLabels: Record<AnswerStatus, string> = {
  supported: 'Supported by sources',
  conflict: 'Conflicting evidence',
  insufficient: 'Cannot be verified',
  review: 'Engineer confirmation needed',
  clarify: 'Clarify the question',
};

export const shortAnswerLabels: Record<AnswerStatus, string> = {
  supported: 'Supported',
  conflict: 'Conflict',
  insufficient: 'Missing evidence',
  review: 'Review',
  clarify: 'Clarify',
};

export const answerKind = (s: AnswerStatus) =>
  s === 'supported' ? 'success' : s === 'conflict' ? 'danger' : s === 'clarify' ? 'info' : 'warning';

const REVIEW_KINDS: Record<string, string> = {
  Accept: 'success',
  Reject: 'neutral',
  'Needs Correction': 'danger',
  'Engineer Review': 'info',
};
export const reviewKind = (s: string) => REVIEW_KINDS[s] || 'warning';

export const isClosed = (status: string) => status === 'Accept' || status === 'Reject';

export const formatDateTime = (d: string) =>
  d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not stated';

export const formatIssueDate = (d: string) =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not stated';

function sourceLabel(c: Citation) {
  if (c.status === 'superseded') return 'Superseded source';
  if (c.status === 'reference') return 'Reference document';
  if (c.status === 'ambiguous') return 'Revision status unclear';
  return 'Current source';
}

export function CitationList({ items, onOpen }: { items: Citation[]; onOpen: (c: Citation) => void }) {
  return (
    <div className="evidence-list">
      {items.map((c, i) => (
        <button key={c.id + '-' + i} className="evidence-card" onClick={() => onOpen(c)}>
          <span className="evidence-number">{String(i + 1).padStart(2, '0')}</span>
          <span className="evidence-body">
            <strong>
              {c.sheet || c.title}
              <span>Page {c.page}</span>
            </strong>
            <span>{c.filename}</span>
            <span className="source-meta">
              {c.sheetRevision !== '—' ? 'Sheet Rev ' + c.sheetRevision + ' · ' : ''}
              {sourceLabel(c)}
            </span>
          </span>
          <PanelRightOpen size={17} />
        </button>
      ))}
    </div>
  );
}
