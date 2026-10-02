'use client';
import {
  BookOpen,
  ClipboardCheck,
  Clock,
  CornerDownLeft,
  Download,
  FileQuestion,
  History,
  Layers,
  LoaderCircle,
  MessagesSquare,
  Play,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { questions } from '@/lib/questions';
import type { Answer, AppState, Citation } from '@/lib/types';
import {
  Badge,
  CitationList,
  answerKind,
  answerLabels,
  downloadJSON,
  formatDateTime,
  shortAnswerLabels,
} from './shared';

type Props = {
  data: AppState | null;
  question: string;
  setQuestion: (q: string) => void;
  answer: Answer | null;
  showAnswer: (a: Answer) => void;
  asking: boolean;
  ask: (q?: string) => void;
  evaluation: Answer[] | null;
  evaluating: boolean;
  runEvaluation: () => void;
  openSource: (c: Citation) => void;
  sendToReview: (a: Answer) => void;
};

const STARTERS = [
  { index: 0, icon: Layers, text: 'Which structural revision is current?' },
  { index: 1, icon: History, text: 'What changed in the wall systems?' },
  { index: 6, icon: BookOpen, text: 'What is the suspended slab strength?' },
  { index: -1, icon: TriangleAlert, text: 'Are the wall schedules consistent?' },
];

export function AskView(props: Props) {
  const { data, answer, asking, evaluation } = props;
  // Show each question once, newest first (repeat runs of the assessment create duplicates).
  const recent = [...new Map((data?.history || []).map((a) => [a.question, a])).values()].slice(0, 5);

  return (
    <div className="ask-layout">
      <div className="ask-main">
        <QuestionPanel {...props} />
        {asking ? (
          <section className="panel answer-panel" aria-live="polite">
            <div className="loading-line">
              <LoaderCircle className="spin" size={18} />
              Retrieving evidence and checking revisions…
            </div>
            <Skeleton className="h-6 w-4/5 mt-5" />
            <Skeleton className="h-4 w-full mt-4" />
            <Skeleton className="h-4 w-3/4 mt-3" />
          </section>
        ) : answer ? (
          <AnswerPanel answer={answer} openSource={props.openSource} sendToReview={props.sendToReview} />
        ) : (
          <section className="getting-started">
            <div className="section-top">
              <h3>Useful starting points</h3>
              <span className="tiny">Questions from this project</span>
            </div>
            <div className="prompt-grid">
              {STARTERS.map(({ index, icon: Icon, text }) => (
                <button
                  key={text}
                  className="prompt-card"
                  onClick={() => props.ask(index >= 0 ? questions[index].question : text)}
                >
                  <Icon size={20} />
                  <strong>{text}</strong>
                  <span>Inspect the source evidence</span>
                </button>
              ))}
            </div>
            <div className="notice">
              <ShieldCheck size={17} />
              <span>
                Evidence retrieval and explicit QA checks are active. No external model is connected by default.
              </span>
            </div>
          </section>
        )}
        {evaluation && (
          <section className="panel evaluation-panel">
            <div className="section-top">
              <h3>Assessment run</h3>
              <button
                className="text-button"
                onClick={() =>
                  downloadJSON(
                    { runAt: new Date().toISOString(), results: evaluation },
                    'candidate-question-results.json',
                  )
                }
              >
                <Download size={15} />
                Export answers
              </button>
            </div>
            <p>All eight questions were processed. Each outcome reflects the available evidence.</p>
            {evaluation.map((a, i) => (
              <button key={i} className="evaluation-row" onClick={() => props.showAnswer(a)}>
                <span className="row-index">{i + 1}</span>
                <strong>{questions[i].title}</strong>
                <Badge kind={answerKind(a.status)}>{shortAnswerLabels[a.status]}</Badge>
              </button>
            ))}
          </section>
        )}
      </div>

      <aside className="ask-aside">
        <section className="panel assessment-panel">
          <div className="eyebrow">ASSESSMENT CHECKLIST</div>
          <h3>Eight questions. Traceable answers.</h3>
          <p>Run a question to inspect its answer and sources.</p>
          <div className="question-list">
            {questions.map((q, i) => (
              <button key={q.title} onClick={() => props.ask(q.question)} disabled={asking}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <strong>{q.title}</strong>
                <CornerDownLeft size={14} />
              </button>
            ))}
          </div>
          <button className="secondary full" disabled={props.evaluating} onClick={props.runEvaluation}>
            {props.evaluating ? <LoaderCircle size={16} className="spin" /> : <Play size={15} />}{' '}
            {props.evaluating ? 'Running assessment' : 'Run all eight questions'}
          </button>
        </section>
        <section className="history-panel">
          <div className="subheading">
            <h3>
              <Clock size={16} />
              Recent questions
            </h3>
            <span>{recent.length}</span>
          </div>
          {recent.length ? (
            recent.map((a) => (
              <button key={a.id} onClick={() => props.showAnswer(a)}>
                <strong>{a.question}</strong>
                <span>{formatDateTime(a.createdAt || '')}</span>
              </button>
            ))
          ) : (
            <p className="empty-small">Your questions and evidence will appear here.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function QuestionPanel({ question, setQuestion, asking, ask }: Props) {
  return (
    <section className="panel ask-panel">
      <div className="section-top">
        <div className="eyebrow">ASK THE PROJECT</div>
        <Badge kind="info">Current sources first</Badge>
      </div>
      <h2>Find the answer. Keep the evidence.</h2>
      <p>Ask about a specification, a wall mark, a revision change or a coordination issue.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <div className="question-box">
          <MessagesSquare size={21} />
          <textarea
            aria-label="Engineering question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What concrete strength is specified for suspended slabs?"
            rows={2}
            maxLength={2000}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                ask();
              }
            }}
          />
          <button className="primary" disabled={asking || !question.trim()}>
            {asking ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{' '}
            {asking ? 'Checking sources' : 'Ask question'}
          </button>
        </div>
      </form>
      <div className="input-caption">
        <span>Answers cite source pages. Uncertainty stays visible.</span>
        <span>⌘ / Ctrl + Enter</span>
      </div>
    </section>
  );
}

function AnswerPanel({
  answer,
  openSource,
  sendToReview,
}: {
  answer: Answer;
  openSource: (c: Citation) => void;
  sendToReview: (a: Answer) => void;
}) {
  return (
    <section className="panel answer-panel">
      <div className="section-top">
        <Badge kind={answerKind(answer.status)}>{answerLabels[answer.status]}</Badge>
        <span className="tiny">{answer.mode}</span>
      </div>
      <h2 className="answer-summary">{answer.summary}</h2>
      <ul className="answer-details">
        {answer.details.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      {answer.missing.length > 0 && (
        <div className="missing-box">
          <h3>
            <FileQuestion size={18} />
            Evidence to request
          </h3>
          <ul>
            {answer.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="subheading">
        <h3>Supporting evidence</h3>
        <span>{answer.citations.length} source pages</span>
      </div>
      {answer.citations.length ? (
        <CitationList items={answer.citations} onOpen={openSource} />
      ) : (
        <p className="empty-small">No supporting source was found.</p>
      )}
      <div className="answer-footer">
        <span>
          <ShieldCheck size={15} />
          Advisory answer · human review retained{answer.route ? ` · rule: ${answer.route}` : ''}
        </span>
        <button className="secondary" onClick={() => sendToReview(answer)}>
          <ClipboardCheck size={16} />
          {answer.findingIds.length ? 'Open related finding' : 'Send to engineer review'}
        </button>
      </div>
    </section>
  );
}
