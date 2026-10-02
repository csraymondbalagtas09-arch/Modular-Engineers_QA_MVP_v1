'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Check, CheckCircle2, Download, History, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AppState, Citation, Finding } from '@/lib/types';
import { Badge, CitationList, api, formatDateTime, isClosed, reviewKind } from './shared';

type Props = {
  data: AppState | null;
  selectedId: string;
  setSelectedId: (id: string) => void;
  filter: string;
  setFilter: (f: string) => void;
  openSource: (c: Citation) => void;
  refresh: () => Promise<unknown>;
};

export function ReviewView({ data, selectedId, setSelectedId, filter, setFilter, openSource, refresh }: Props) {
  const findings = data?.findings || [];
  const visible = findings.filter(
    (f) => filter === 'all' || (filter === 'open' ? !isClosed(f.status) : isClosed(f.status)),
  );
  const selected = findings.find((f) => f.id === selectedId) || visible[0] || findings[0];

  return (
    <>
      <div className="view-heading">
        <div>
          <h2>Engineer review</h2>
          <p>Resolve the finding with evidence. Every decision remains in the audit trail.</p>
        </div>
        <a className="secondary" href="/api/export" download>
          <Download size={16} />
          Export review record
        </a>
      </div>
      <div className="review-layout">
        <aside className="finding-list">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="review-filters">
              <TabsTrigger value="open">Needs review</TabsTrigger>
              <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          {visible.length ? (
            visible.map((f) => (
              <button
                key={f.id}
                className={'finding-card ' + (selected?.id === f.id ? 'selected' : '')}
                onClick={() => setSelectedId(f.id)}
              >
                <div className="section-top">
                  <span className="finding-category">{f.category}</span>
                  <span className={'severity ' + f.severity}>{f.severity}</span>
                </div>
                <h3>{f.title}</h3>
                <div className="finding-meta">
                  <Badge kind={reviewKind(f.status)}>{f.status}</Badge>
                  <span>{f.citations.length} sources</span>
                </div>
              </button>
            ))
          ) : (
            <div className="panel empty-state">
              <CheckCircle2 size={28} />
              <h3>No findings in this view</h3>
              <p>Choose another filter to inspect the review record.</p>
            </div>
          )}
        </aside>
        {selected ? (
          // Keyed by version so the form resets after each recorded decision.
          <FindingDetail
            key={`${selected.id}:${selected.version}`}
            finding={selected}
            data={data!}
            openSource={openSource}
            refresh={refresh}
          />
        ) : (
          <section className="panel">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-24 w-full mt-5" />
          </section>
        )}
      </div>
    </>
  );
}

function FindingDetail({
  finding,
  data,
  openSource,
  refresh,
}: {
  finding: Finding;
  data: AppState;
  openSource: (c: Citation) => void;
  refresh: () => Promise<unknown>;
}) {
  const decisionOpen = finding.status === 'Engineer Review';
  const [comment, setComment] = useState('');
  const [action, setAction] = useState(decisionOpen ? 'Accept' : 'Engineer Review');
  const [saving, setSaving] = useState(false);
  const history = data.decisions.filter((d) => d.findingId === finding.id);

  async function save() {
    if (!comment.trim()) return;
    setSaving(true);
    try {
      await api('review', { findingId: finding.id, version: finding.version, status: action, comment });
      await refresh();
      toast.success('Review decision recorded.');
    } catch (e) {
      const message = (e as Error).message;
      toast.error(message);
      if (message.includes('changed')) await refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel finding-detail">
      <div className="section-top">
        <div className="eyebrow">FINDING · {finding.category.toUpperCase()}</div>
        <Badge kind={reviewKind(finding.status)}>{finding.status}</Badge>
      </div>
      <h2>{finding.title}</h2>
      {finding.evidenceChangedSinceDecision && (
        <div className="error-banner" role="status">
          <TriangleAlert size={18} />
          <div>
            <strong>Evidence changed since the last decision</strong>
            <p>
              The cited evidence differs from the snapshot stored with the latest decision. Reopen the review to confirm
              it still applies.
            </p>
          </div>
        </div>
      )}
      <p className="finding-summary">{finding.summary}</p>
      <div className="risk-box">
        <h3>
          <TriangleAlert size={17} />
          Risk / uncertainty
        </h3>
        <p>{finding.risk}</p>
      </div>
      <div className="recommendation">
        <h3>Recommended action</h3>
        <p>{finding.recommendation}</p>
      </div>
      {finding.missing && finding.missing.length > 0 && (
        <div className="missing-box">
          <h3>Evidence to request</h3>
          <ul>
            {finding.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="subheading">
        <h3>Evidence to inspect</h3>
        <span>{finding.citations.length} sources</span>
      </div>
      <CitationList items={finding.citations} onOpen={openSource} />

      <div className="review-action">
        <div className="subheading">
          <h3>Record your review</h3>
          <span>v{finding.version}</span>
        </div>
        <p>
          Reviewing as <strong>{data.reviewer}</strong>
        </p>
        <label className="field-label" htmlFor="decision">
          Action
        </label>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger id="decision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {decisionOpen ? (
              <>
                <SelectItem value="Accept">Accept finding</SelectItem>
                <SelectItem value="Reject">Reject finding</SelectItem>
                <SelectItem value="Needs Correction">Needs correction</SelectItem>
              </>
            ) : (
              <SelectItem value="Engineer Review">
                {finding.status === 'AI Flagged' ? 'Start engineer review' : 'Reopen engineer review'}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <label className="field-label" htmlFor="comment">
          Review notes <span>Required</span>
        </label>
        <textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={3000}
          placeholder="Record what you checked and why this action is appropriate."
        />
        <div className="review-action-footer">
          <span>Accepting a finding does not certify the engineering design.</span>
          <button className="primary" onClick={save} disabled={saving || !comment.trim()}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
            Save review
          </button>
        </div>
      </div>

      <div className="audit-section">
        <div className="subheading">
          <h3>
            <History size={17} />
            Decision history
          </h3>
        </div>
        {history.length ? (
          history.map((d) => (
            <div className="audit-event" key={d.id}>
              <div>
                <Badge kind={reviewKind(d.status)}>{d.status}</Badge>
                <span>{formatDateTime(d.createdAt)}</span>
              </div>
              <p>{d.comment}</p>
              <small>
                {d.reviewer} · revision {d.version}
              </small>
            </div>
          ))
        ) : (
          <p className="empty-small">
            No reviewer actions yet. Original evidence is preserved when a decision is recorded.
          </p>
        )}
        <div className="finding-origin">{finding.origin}</div>
      </div>
    </section>
  );
}
