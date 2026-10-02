'use client';
import { useState } from 'react';
import { FileText, Hash, Layers, LockKeyhole, PanelRightOpen, Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AppState, DocumentRecord } from '@/lib/types';
import { Badge, formatIssueDate } from './shared';

const statusKind = (s: string) =>
  s === 'current' ? 'success' : s === 'superseded' ? 'warning' : s === 'ambiguous' ? 'danger' : 'neutral';

export function DocumentsView({
  data,
  openDocument,
}: {
  data: AppState | null;
  openDocument: (d: DocumentRecord, page?: number) => void;
}) {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const docs = (data?.documents || []).filter(
    (d) =>
      (status === 'all' || d.status === status) &&
      (d.title + ' ' + d.filename + ' ' + d.type).toLowerCase().includes(search.toLowerCase()),
  );
  const current = data?.documents.find((d) => d.type === 'Structure' && d.status === 'current');

  return (
    <>
      <div className="view-heading">
        <div>
          <h2>Document register</h2>
          <p>
            Status is read from each package&apos;s drawing register, then cross-checked with title blocks and the
            supplied label.
          </p>
        </div>
        <Badge kind="neutral">
          <LockKeyhole size={13} />
          Assessment use only
        </Badge>
      </div>
      <div className="document-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a document"
            aria-label="Find a document"
          />
        </label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="filter-select">
            <SelectValue placeholder="Document status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All documents</SelectItem>
            <SelectItem value="current">Current sources</SelectItem>
            <SelectItem value="superseded">Superseded sources</SelectItem>
            <SelectItem value="reference">Reference documents</SelectItem>
            <SelectItem value="ambiguous">Status unclear</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="document-table panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>DOCUMENT</TableHead>
              <TableHead>TYPE</TableHead>
              <TableHead>PACKAGE REV.</TableHead>
              <TableHead>ISSUED</TableHead>
              <TableHead>STATUS</TableHead>
              <TableHead>PAGES</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <button className="document-name" onClick={() => openDocument(d)}>
                    <span className={'file-icon ' + (d.status === 'superseded' ? 'old' : '')}>
                      <FileText size={22} />
                    </span>
                    <span>
                      <strong>{d.title}</strong>
                      <small>{d.filename}</small>
                      {d.statusBasis && <small className="status-basis">{d.statusBasis}</small>}
                    </span>
                  </button>
                </TableCell>
                <TableCell>{d.type}</TableCell>
                <TableCell>
                  <span className="revision-tag">{d.revision}</span>
                </TableCell>
                <TableCell>{formatIssueDate(d.issueDate)}</TableCell>
                <TableCell>
                  <Badge kind={statusKind(d.status)}>{d.status}</Badge>
                </TableCell>
                <TableCell>{d.pageCount}</TableCell>
                <TableCell>
                  <button className="icon-button" aria-label={'Open ' + d.title} onClick={() => openDocument(d)}>
                    <PanelRightOpen size={18} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!docs.length && <p className="empty-small">No documents match this filter.</p>}
      </div>
      <div className="document-notes">
        <div>
          <Layers size={19} />
          <div>
            <strong>A current package can contain different sheet revisions.</strong>
            <p>
              Sheet revisions come from each title block and are checked against the drawing register. A sheet listed at
              an earlier revision in the current register remains current.
            </p>
            {current && (
              <button className="text-button" onClick={() => openDocument(current)}>
                Inspect the current drawing register
              </button>
            )}
          </div>
        </div>
        <div>
          <Hash size={19} />
          <div>
            <strong>Original files retained</strong>
            <p>
              Each source has a SHA-256 fingerprint, page index and preserved PDF. Superseded packages stay available
              for comparison.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
