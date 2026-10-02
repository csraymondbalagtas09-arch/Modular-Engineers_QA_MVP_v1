'use client';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import {
  ClipboardCheck,
  FileText,
  Layers,
  LockKeyhole,
  MessagesSquare,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AskView } from '@/components/qa/ask-view';
import { DocumentsView } from '@/components/qa/documents-view';
import { EvidenceSheet } from '@/components/qa/evidence-sheet';
import { ReviewView } from '@/components/qa/review-view';
import { api, formatIssueDate, isClosed } from '@/components/qa/shared';
import type { Answer, AppState, Citation, DocumentRecord, PageRecord } from '@/lib/types';

export default function Workspace() {
  const [data, setData] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('ask');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<Answer[] | null>(null);
  const [source, setSource] = useState<Citation | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState('open');

  async function refresh() {
    try {
      const s = await api<AppState>('state');
      setData(s);
      setError('');
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function ask(q = question) {
    if (!q.trim() || asking) return;
    setAsking(true);
    setQuestion(q);
    setTab('ask');
    try {
      const a = await api<Answer>('ask', { question: q.trim() });
      setAnswer(a);
      await refresh();
      return a;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  async function runEvaluation() {
    setEvaluating(true);
    try {
      const v = await api<{ results: Answer[] }>('evaluate', {});
      setEvaluation(v.results);
      await refresh();
      toast.success('All eight questions ran through the evidence engine.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEvaluating(false);
    }
  }

  async function openDocument(d: DocumentRecord, n = 1) {
    try {
      const p = await api<PageRecord>(`page?id=${d.id}-p${n}`);
      setSource({
        id: p.id,
        documentId: d.id,
        filename: d.filename,
        title: d.title,
        page: p.page,
        sheet: p.sheet,
        sheetRevision: p.sheetRevision,
        packageRevision: d.revision,
        status: d.status,
        quote: '',
        url: `${d.url}#page=${p.page}`,
        preview: p.preview,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function openFinding(id: string) {
    setSelectedId(id);
    setTab('review');
    setFilter('all');
  }

  async function sendToReview(a: Answer) {
    if (a.findingIds.length) return openFinding(a.findingIds[0]);
    try {
      const f = await api<{ id: string }>('flag', { answerId: a.id });
      await refresh();
      openFinding(f.id);
      toast.success('Question added to engineer review.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function showAnswer(a: Answer) {
    setAnswer(a);
    setQuestion(a.question);
  }

  useWebMcpTool(async (q: string) => {
    const a = await api<Answer>('ask', { question: q });
    setQuestion(q);
    setAnswer(a);
    setTab('ask');
    await refresh();
    return a;
  });

  const openCount = data ? data.findings.filter((f) => !isClosed(f.status)).length : null;
  const reviewedCount = data ? data.findings.filter((f) => isClosed(f.status)).length : null;
  const currentPackage = data?.documents.find((d) => d.type === 'Structure' && d.status === 'current');
  const initial = (data?.reviewer || 'R').trim().charAt(0).toUpperCase();

  return (
    <div className="workspace">
      <Toaster position="bottom-right" richColors />
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <strong>
            MODULAR<span>ENGINEERING QA</span>
          </strong>
        </div>
        <div className="privacy">
          <LockKeyhole size={15} />
          <span>Private assessment workspace</span>
          <span className="header-divider" />
          <span className="avatar" title={data?.reviewer || 'Reviewer'}>
            {initial}
          </span>
        </div>
      </header>
      <main>
        <div className="project-heading">
          <div>
            <div className="eyebrow">
              PROJECT A <span className="eyebrow-slash">/</span> DOCUMENT ASSURANCE
            </div>
            <h1>Project review</h1>
            <p>Multi dwelling · Architectural & structural coordination</p>
          </div>
          <div className="package">
            <Layers size={22} />
            <div>
              Current structural package
              <strong>
                {currentPackage ? (
                  <>
                    Rev {currentPackage.revision} <span>·</span> {formatIssueDate(currentPackage.issueDate)}
                  </>
                ) : (
                  '—'
                )}
              </strong>
            </div>
          </div>
        </div>

        <div className="summary-strip">
          <div>
            <FileText size={18} />
            <strong>{data ? data.documents.length : '—'}</strong>
            <span>documents</span>
            <small>{data ? `${data.pageCount} indexed pages` : 'Loading'}</small>
          </div>
          <div>
            <TriangleAlert size={18} />
            <strong>{openCount ?? '—'}</strong>
            <span>need review</span>
            <small>Evidence gaps & conflicts</small>
          </div>
          <div>
            <ClipboardCheck size={18} />
            <strong>{reviewedCount ?? '—'}</strong>
            <span>reviewed</span>
            <small>Decisions preserved</small>
          </div>
          <div className="engine-status">
            <ShieldCheck size={18} />
            <span>{data?.mode || 'Evidence retrieval'}</span>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line" className="main-tabs">
            <TabsTrigger value="ask">
              <MessagesSquare />
              Ask the documents
            </TabsTrigger>
            <TabsTrigger value="docs">
              <FileText />
              Document register
            </TabsTrigger>
            <TabsTrigger value="review">
              <ClipboardCheck />
              Engineer review <span className="tab-count">{openCount ?? '—'}</span>
            </TabsTrigger>
          </TabsList>

          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={20} />
              <div>
                <strong>Review data unavailable</strong>
                <p>{error}</p>
              </div>
              <button className="secondary" onClick={() => refresh()}>
                Retry
              </button>
            </div>
          )}

          <TabsContent value="ask">
            <AskView
              data={data}
              question={question}
              setQuestion={setQuestion}
              answer={answer}
              showAnswer={showAnswer}
              asking={asking}
              ask={(q) => void ask(q)}
              evaluation={evaluation}
              evaluating={evaluating}
              runEvaluation={runEvaluation}
              openSource={setSource}
              sendToReview={sendToReview}
            />
          </TabsContent>
          <TabsContent value="docs">
            <DocumentsView data={data} openDocument={openDocument} />
          </TabsContent>
          <TabsContent value="review">
            <ReviewView
              data={data}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              filter={filter}
              setFilter={setFilter}
              openSource={setSource}
              refresh={refresh}
            />
          </TabsContent>
        </Tabs>
      </main>
      <footer>
        Modular Engineers · Technical assessment
        <span>AI findings are advisory. Engineering approval remains with the engineer.</span>
      </footer>
      <EvidenceSheet
        source={source}
        documents={data?.documents || []}
        onClose={() => setSource(null)}
        openDocument={openDocument}
      />
    </div>
  );
}

/**
 * Registers an optional browser WebMCP tool so an assistant in the browser can ask the
 * documents through the same authenticated API. It records a question; it cannot review.
 */
function useWebMcpTool(execute: (question: string) => Promise<Answer>) {
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: 'ask_engineering_documents',
      title: 'Ask engineering documents',
      description:
        'Run a project question, save it to question history, and show the cited answer in the workspace. This records a question but does not approve engineering findings.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string', minLength: 1, maxLength: 2000 } },
        required: ['question'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input: any) => {
        if (!input || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 2000)
          throw new Error('Provide a question of 1–2,000 characters.');
        return execute(input.question);
      },
    };
    try {
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
    } catch {
      // WebMCP is optional; ignore browsers without it.
    }
    return () => lifecycle.abort();
    // Registered once; `execute` uses state setters that are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
