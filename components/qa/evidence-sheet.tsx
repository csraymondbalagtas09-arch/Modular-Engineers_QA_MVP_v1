'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, ExternalLink, Hash } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { Citation, DocumentRecord, PageRecord } from '@/lib/types';
import { Badge, api } from './shared';

/** Side panel showing a cited page: excerpt, drawing preview, extracted text and file fingerprint. */
export function EvidenceSheet({
  source,
  documents,
  onClose,
  openDocument,
}: {
  source: Citation | null;
  documents: DocumentRecord[];
  onClose: () => void;
  openDocument: (d: DocumentRecord, page?: number) => void;
}) {
  const [loaded, setLoaded] = useState<PageRecord | null>(null);
  const page = loaded && loaded.id === source?.id ? loaded : null;
  const doc = documents.find((d) => d.id === source?.documentId);

  useEffect(() => {
    if (!source) return;
    let active = true;
    api<PageRecord>('page?id=' + encodeURIComponent(source.id))
      .then((p) => {
        if (active) setLoaded(p);
      })
      .catch((e) => toast.error(e.message));
    return () => {
      active = false;
    };
  }, [source?.id]);

  return (
    <Sheet open={!!source} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="evidence-sheet">
        <SheetHeader>
          <SheetTitle>{source?.sheet || source?.title || 'Source evidence'}</SheetTitle>
          <SheetDescription className="source-filename">{source?.filename}</SheetDescription>
        </SheetHeader>
        {source && (
          <>
            <div className="source-toolbar">
              <Badge
                kind={source.status === 'superseded' ? 'warning' : source.status === 'ambiguous' ? 'danger' : 'success'}
              >
                {source.status}
              </Badge>
              <span>
                Page {source.page} · Sheet Rev {source.sheetRevision} · Package Rev {source.packageRevision}
              </span>
              <a href={source.url} target="_blank" rel="noreferrer" className="text-button">
                Open PDF
                <ExternalLink size={14} />
              </a>
            </div>
            <div className="source-page-nav">
              <button
                className="icon-button"
                aria-label="Previous PDF page"
                disabled={source.page <= 1}
                onClick={() => doc && openDocument(doc, source.page - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                PDF page {source.page} of {doc?.pageCount}
              </span>
              <button
                className="icon-button"
                aria-label="Next PDF page"
                disabled={source.page >= (doc?.pageCount || 1)}
                onClick={() => doc && openDocument(doc, source.page + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="source-scroll">
              {source.quote && (
                <div className="source-excerpt">
                  <div className="eyebrow">CITED EXCERPT</div>
                  <pre>{source.quote}</pre>
                </div>
              )}
              {source.preview ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  <img
                    className="drawing-preview"
                    src={source.preview}
                    alt={`Original ${source.sheet || source.title}, PDF page ${source.page}`}
                  />
                </a>
              ) : (
                <iframe title={`PDF page ${source.page}`} src={source.url} className="pdf-preview" />
              )}
              <details className="extracted-text">
                <summary>Inspect extracted page text</summary>
                {page ? <pre>{page.text}</pre> : <p>Loading page text…</p>}
              </details>
              <div className="source-hash">
                <Hash size={14} />
                <span>SHA-256: {doc?.sha256}</span>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
