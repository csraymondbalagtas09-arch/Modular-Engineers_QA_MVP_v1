/** Status of a source document after the register check in lib/register.ts. */
export type DocumentStatus = 'current' | 'superseded' | 'reference' | 'ambiguous';

export type DocumentRecord = {
  id: string;
  filename: string;
  title: string;
  type: string;
  /** Package revision (the letter on the cover sheet), not an individual sheet revision. */
  revision: string;
  issueDate: string;
  status: DocumentStatus;
  pageCount: number;
  sha256: string;
  bytes: number;
  url: string;
  extraction: string;
  /** Documents in the same family are revisions of each other. */
  family: string;
  /** Status implied by the supplied filename/label, kept to cross-check the register. */
  declaredStatus?: string;
  /** Human-readable explanation of how status, revision and date were established. */
  statusBasis?: string;
  /** Register vs. title-block and label cross-check result. */
  registerCheck?: 'agrees' | 'differs' | 'not-applicable';
};

export type PageRecord = {
  id: string;
  documentId: string;
  page: number;
  sheet: string;
  sheetRevision: string;
  text: string;
  preview: string;
};

export type Chunk = {
  id: string;
  documentId: string;
  pageId: string;
  page: number;
  sheet: string;
  sheetRevision: string;
  text: string;
};

/** A wall-schedule row extracted during ingestion. */
export type Fact = {
  id: string;
  documentId: string;
  pageId: string;
  page: number;
  sheet: string;
  sheetRevision: string;
  entity: string;
  description: string;
  thickness: number;
  evidence: string;
  bbox: number[];
};

export type Citation = {
  id: string;
  documentId: string;
  filename: string;
  title: string;
  page: number;
  sheet: string;
  sheetRevision: string;
  packageRevision: string;
  status: string;
  quote: string;
  url: string;
  preview: string;
};

export type Finding = {
  id: string;
  title: string;
  category: string;
  severity: 'high' | 'medium';
  summary: string;
  risk: string;
  recommendation: string;
  citations: Citation[];
  missing?: string[];
  status: string;
  version: number;
  origin: string;
  /** Set when the current evidence differs from the snapshot stored with the latest decision. */
  evidenceChangedSinceDecision?: boolean;
};

/**
 * supported    – a direct answer is established by cited current evidence
 * conflict     – current sources disagree; both are shown
 * insufficient – the supplied evidence cannot verify the answer
 * review       – evidence exists but needs engineer interpretation
 * clarify      – the question is ambiguous; the evidence differs by interpretation
 */
export type AnswerStatus = 'supported' | 'conflict' | 'insufficient' | 'review' | 'clarify';

export type Answer = {
  id?: string;
  question: string;
  status: AnswerStatus;
  summary: string;
  details: string[];
  citations: Citation[];
  findingIds: string[];
  missing: string[];
  mode: string;
  /** Which rule or retrieval path produced the answer, for traceability. */
  route?: string;
  /** Shared by answers saved in one "run all questions" batch. */
  runId?: string;
  createdAt?: string;
};

export type Decision = {
  id: string;
  findingId: string;
  version: number;
  status: string;
  comment: string;
  reviewer: string;
  createdAt: string;
  evidenceSnapshot?: Finding;
};

export type AppState = {
  documents: DocumentRecord[];
  findings: Finding[];
  history: Answer[];
  decisions: Decision[];
  reviewer: string;
  mode: string;
  pageCount: number;
  chunkCount: number;
};
