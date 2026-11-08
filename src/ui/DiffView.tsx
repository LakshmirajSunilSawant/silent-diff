import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeNormalize } from '../core/normalize';
import type { DiffOp, DiffResult, OpType, Table } from '../core/types';
import { cellValue, oldValue } from '../export';

interface Props {
  result: DiffResult;
  before: Table;
  after: Table;
  onExport: (kind: 'xlsx' | 'csv') => void;
  exporting: boolean;
  stale: boolean;
}

type Line = { kind: 'op'; i: number } | { kind: 'gap'; from: number; to: number };
type ChangeType = Exclude<OpType, 'unchanged'>;

const CONTEXT = 3;
const ROW_H = 30;
const HEAD_H = 50;
const MARK_W = 84;
const ALL_TYPES: ChangeType[] = ['added', 'deleted', 'modified'];

const SYMBOL: Record<OpType, string> = { added: '+', deleted: '−', modified: '~', unchanged: '' };
const SR_LABEL: Record<OpType, string> = { added: 'Added row', deleted: 'Deleted row', modified: 'Modified row', unchanged: 'Unchanged row' };

const fmt = (n: number) => n.toLocaleString();
const fmtNet = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function DiffView({ result, before, after, onExport, exporting, stale }: Props) {
  const r = result;
  const s = r.summary;
  const [types, setTypes] = useState<Set<ChangeType>>(new Set(ALL_TYPES));
  const [colFilter, setColFilter] = useState(-1);
  const [showOld, setShowOld] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLSelectElement>(null);

  // New diff → reset view state that refers to old op indices.
  useEffect(() => {
    setExpanded(new Set());
    setCursor(-1);
    setColFilter((c) => (c >= 0 && r.columns[c]?.status === 'both' ? c : -1));
  }, [r]);

  // Key columns first so they can stick to the left edge.
  const displayCols = useMemo(() => {
    const keyIdx = (r.key ?? []).map((k) => r.columns.findIndex((c) => c.name === k && c.status === 'both'));
    return [...keyIdx, ...r.columns.map((_, i) => i).filter((i) => !keyIdx.includes(i))];
  }, [r]);
  const keyCount = r.key?.length ?? 0;

  const widths = useMemo(() => {
    return displayCols.map((ci) => {
      const c = r.columns[ci];
      let len = c.name.length + (c.status !== 'both' ? 6 : 0);
      const t = c.ai >= 0 ? after : before;
      const col = t.columns[c.ai >= 0 ? c.ai : c.bi];
      for (let i = 0; i < Math.min(col.length, 300); i++) len = Math.max(len, col[i].length);
      const w = Math.max(90, Math.min(300, len * 8 + 28));
      // Room for "old → new" when old values are shown inline.
      return showOld && (s.perColumn.find((p) => p.column === c.name)?.changed ?? 0) > 0 ? Math.min(460, w * 2) : w;
    });
  }, [r, s, displayCols, before, after, showOld]);
  const stickyLeft = useMemo(() => {
    const out: number[] = [];
    let x = MARK_W;
    for (let i = 0; i < keyCount; i++) {
      out.push(x);
      x += widths[i];
    }
    return out;
  }, [widths, keyCount]);
  const totalW = MARK_W + widths.reduce((a, b) => a + b, 0);

  const perCol = useMemo(() => new Map(s.perColumn.map((p) => [p.column, p])), [s]);
  const filterActive = types.size < 3 || colFilter >= 0;

  const lines = useMemo<Line[]>(() => {
    const ops = r.ops;
    if (filterActive) {
      const out: Line[] = [];
      ops.forEach((op, i) => {
        if (op.type === 'unchanged' || !types.has(op.type)) return;
        if (colFilter >= 0 && !(op.type === 'modified' && op.changed!.includes(colFilter))) return;
        out.push({ kind: 'op', i });
      });
      return out;
    }
    const keep = new Uint8Array(ops.length);
    ops.forEach((op, i) => {
      if (op.type === 'unchanged') return;
      for (let j = Math.max(0, i - CONTEXT); j <= Math.min(ops.length - 1, i + CONTEXT); j++) keep[j] = 1;
    });
    const out: Line[] = [];
    for (let i = 0; i < ops.length; ) {
      if (keep[i]) {
        out.push({ kind: 'op', i: i++ });
        continue;
      }
      let j = i;
      while (j < ops.length && !keep[j]) j++;
      // A bar that hides one or two rows saves nothing, so only collapse longer runs.
      if (expanded.has(i) || j - i < 3) for (let k = i; k < j; k++) out.push({ kind: 'op', i: k });
      else out.push({ kind: 'gap', from: i, to: j });
      i = j;
    }
    return out;
  }, [r, filterActive, types, colFilter, expanded]);

  const changeLines = useMemo(
    () => lines.flatMap((l, idx) => (l.kind === 'op' && r.ops[l.i].type !== 'unchanged' ? [idx] : [])),
    [lines, r],
  );

  const virt = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    scrollPaddingStart: HEAD_H,
  });

  const jump = useCallback(
    (dir: 1 | -1) => {
      if (!changeLines.length) return;
      let target: number;
      if (dir === 1) target = changeLines.find((l) => l > cursor) ?? changeLines[0];
      else target = [...changeLines].reverse().find((l) => l < cursor) ?? changeLines[changeLines.length - 1];
      setCursor(target);
      virt.scrollToIndex(target, { align: 'center' });
    },
    [changeLines, cursor, virt],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.key === 'n') jump(1);
      else if (e.key === 'p') jump(-1);
      else if (e.key === 'f') {
        e.preventDefault();
        filterRef.current?.focus();
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jump]);

  const toggleType = (t: ChangeType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const noRowChanges = s.added + s.deleted + s.modified === 0;
  const identical = noRowChanges && !s.columnsAdded.length && !s.columnsRemoved.length;
  const changedCols = s.perColumn.filter((c) => c.changed > 0).sort((a, b) => b.changed - a.changed);
  const filterCols = r.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.status === 'both' && (perCol.get(c.name)?.changed ?? 0) > 0);

  return (
    <section className={`review ${stale ? 'stale' : ''}`} aria-label="Differences">
      <div className="summary" aria-live="polite">
        <div className="summary-line">
          {identical ? (
            <strong>No differences found</strong>
          ) : (
            <>
              <span className="count c-add"><b>+{fmt(s.added)}</b> added</span>
              <span className="count c-del"><b>−{fmt(s.deleted)}</b> deleted</span>
              <span className="count c-mod"><b>~{fmt(s.modified)}</b> modified</span>
              <span className="muted">rows</span>
              {s.columnsAdded.length > 0 && (
                <span className="count c-add">· {s.columnsAdded.length} column{s.columnsAdded.length > 1 ? 's' : ''} added ({s.columnsAdded.join(', ')})</span>
              )}
              {s.columnsRemoved.length > 0 && (
                <span className="count c-del">· {s.columnsRemoved.length} column{s.columnsRemoved.length > 1 ? 's' : ''} removed ({s.columnsRemoved.join(', ')})</span>
              )}
            </>
          )}
          {s.reordered && <span className="note">↕ Rows were reordered{noRowChanges ? '' : ' (order changes are not counted as edits)'}</span>}
        </div>
        <div className="muted small">
          {fmt(s.unchanged)} unchanged · {r.key ? <>matched by <code>{r.key.join(' + ')}</code></> : 'aligned without a key'} · {describeNormalize(r.normalize)} · {r.elapsedMs} ms
          {r.approximate && <span className="tag">approximate</span>}
        </div>
        {changedCols.length > 0 && (
          <div className="percol" aria-label="Changes per column">
            {changedCols.map((c) => {
              const idx = r.columns.findIndex((col) => col.name === c.column && col.status === 'both');
              return (
                <button key={c.column} className={`chip ${colFilter === idx ? 'on' : ''}`} onClick={() => setColFilter(colFilter === idx ? -1 : idx)} title="Show only changes in this column">
                  <span className="chip-name">{c.column}</span> {fmt(c.changed)} changed
                  {c.netChange !== undefined && c.netChange !== 0 && <span className="net"> · net {fmtNet(c.netChange)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Issues result={r} before={before} after={after} />

      {identical ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">✓</div>
          <p>
            <strong>No differences found.</strong> Both files have the same {fmt(s.unchanged)} rows.
          </p>
          <p className="muted small">Compared with: {describeNormalize(r.normalize)}.</p>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="filters" role="group" aria-label="Filter by change type">
              {ALL_TYPES.map((t) => (
                <label key={t} className={`ftype f-${t}`}>
                  <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />
                  <span aria-hidden="true">{SYMBOL[t]}</span> {t[0].toUpperCase() + t.slice(1)}
                </label>
              ))}
              <select ref={filterRef} value={colFilter} onChange={(e) => setColFilter(Number(e.target.value))} aria-label="Filter by column (f)">
                <option value={-1}>All columns</option>
                {filterCols.map(({ c, i }) => (
                  <option key={i} value={i}>
                    Changes in “{c.name}”
                  </option>
                ))}
              </select>
              <label className="switch">
                <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />
                Show old values inline
              </label>
            </div>
            <div className="nav">
              <button onClick={() => jump(-1)} disabled={!changeLines.length} title="Previous change (p)">
                ↑ Prev
              </button>
              <button onClick={() => jump(1)} disabled={!changeLines.length} title="Next change (n)">
                ↓ Next
              </button>
              <button className="primary" onClick={() => onExport('xlsx')} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export .xlsx'}
              </button>
              <button onClick={() => onExport('csv')} disabled={exporting}>
                Export .csv
              </button>
            </div>
          </div>

          <div className="grid-scroll" ref={scrollRef} role="grid" aria-rowcount={lines.length + 1} aria-colcount={displayCols.length + 1} tabIndex={0}>
            <div style={{ width: totalW, height: virt.getTotalSize() + HEAD_H, position: 'relative' }}>
              <div className="grid-head" role="row" style={{ width: totalW, height: HEAD_H }}>
                <div className="hcell mark sticky" role="columnheader" style={{ width: MARK_W, left: 0 }}>
                  Change
                </div>
                {displayCols.map((ci, k) => {
                  const c = r.columns[ci];
                  const n = perCol.get(c.name)?.changed ?? 0;
                  return (
                    <div
                      key={ci}
                      role="columnheader"
                      className={`hcell h-${c.status} ${k < keyCount ? 'sticky key' : ''}`}
                      style={{ width: widths[k], left: k < keyCount ? stickyLeft[k] : undefined }}
                      title={c.name}
                    >
                      <span className="hname">{c.name}</span>
                      <span className="hmeta">
                        {k < keyCount && <span className="badge b-key">key</span>}
                        {c.status === 'added' && <span className="badge b-add">+ new column</span>}
                        {c.status === 'removed' && <span className="badge b-del">− removed</span>}
                        {n > 0 && <span className="badge b-mod">{fmt(n)} changed</span>}
                      </span>
                    </div>
                  );
                })}
              </div>

              {virt.getVirtualItems().map((item) => {
                const line = lines[item.index];
                const top = item.start + HEAD_H;
                if (line.kind === 'gap') {
                  const n = line.to - line.from;
                  return (
                    <div key={`g${line.from}`} className="grid-row gap" role="row" style={{ top, height: ROW_H, width: totalW }}>
                      <button className="gap-btn" onClick={() => setExpanded((p) => new Set(p).add(line.from))} aria-label={`Show ${n} unchanged rows`}>
                        <span className="gap-label">⋯ {fmt(n)} unchanged row{n > 1 ? 's' : ''} · click to show</span>
                      </button>
                    </div>
                  );
                }
                const op = r.ops[line.i];
                return (
                  <Row
                    key={line.i}
                    op={op}
                    top={top}
                    width={totalW}
                    result={r}
                    before={before}
                    after={after}
                    displayCols={displayCols}
                    widths={widths}
                    stickyLeft={stickyLeft}
                    keyCount={keyCount}
                    showOld={showOld}
                    cursor={item.index === cursor}
                    rowIndex={item.index + 2}
                  />
                );
              })}
            </div>
          </div>
          <p className="muted small hint">
            Keyboard: <kbd>n</kbd> next change · <kbd>p</kbd> previous · <kbd>f</kbd> column filter. Hover a yellow cell to see its old value.
            {filterActive && lines.length === 0 && ' No rows match the current filter.'}
          </p>
        </>
      )}
    </section>
  );
}

interface RowProps {
  op: DiffOp;
  top: number;
  width: number;
  result: DiffResult;
  before: Table;
  after: Table;
  displayCols: number[];
  widths: number[];
  stickyLeft: number[];
  keyCount: number;
  showOld: boolean;
  cursor: boolean;
  rowIndex: number;
}

function Row({ op, top, width, result, before, after, displayCols, widths, stickyLeft, keyCount, showOld, cursor, rowIndex }: RowProps) {
  const changed = op.type === 'modified' ? new Set(op.changed) : null;
  const where =
    op.type === 'added'
      ? `After row ${op.a + 1}`
      : op.type === 'deleted'
        ? `Before row ${op.b + 1}`
        : op.b === op.a
          ? `Row ${op.a + 1}`
          : `Before row ${op.b + 1}, After row ${op.a + 1}`;
  return (
    <div className={`grid-row r-${op.type} ${cursor ? 'cursor' : ''}`} role="row" aria-rowindex={rowIndex} style={{ top, height: ROW_H, width }}>
      <div className="cell mark sticky" role="rowheader" style={{ width: MARK_W, left: 0 }} title={where}>
        <span className="sym" aria-hidden="true">
          {SYMBOL[op.type]}
        </span>
        <span className="sr-only">{SR_LABEL[op.type]}, </span>
        <span className="rownum">{(op.a >= 0 ? op.a : op.b) + 1}</span>
      </div>
      {displayCols.map((ci, k) => {
        const col = result.columns[ci];
        const v = cellValue(col, op, before, after);
        const isChanged = changed?.has(ci) ?? false;
        const cls = `cell c-${col.status} ${k < keyCount ? 'sticky key' : ''} ${isChanged ? 'changed' : ''}`;
        const style = { width: widths[k], left: k < keyCount ? stickyLeft[k] : undefined };
        if (isChanged) {
          const old = oldValue(col, op, before);
          return (
            <div key={ci} role="gridcell" className={cls} style={style} title={`Before: ${old || '(empty)'}\nAfter: ${v || '(empty)'}`} aria-label={`${col.name} changed from ${old || 'empty'} to ${v || 'empty'}`}>
              {showOld && (
                <>
                  <del className="old">{old || '∅'}</del>
                  <span className="arrow" aria-hidden="true">→</span>
                </>
              )}
              {v === '' ? <span className="emptyval">(empty)</span> : v}
            </div>
          );
        }
        return (
          <div key={ci} role="gridcell" className={cls} style={style} title={v.length > 30 || v.includes('\n') ? v : undefined}>
            {v}
          </div>
        );
      })}
    </div>
  );
}

function Issues({ result: r, before, after }: { result: DiffResult; before: Table; after: Table }) {
  const items: React.ReactNode[] = [];
  for (const w of r.warnings) items.push(w);
  for (const w of before.warnings) items.push(`Before: ${w}`);
  for (const w of after.warnings) items.push(`After: ${w}`);
  if (r.summary.looksLikeFormatting) {
    items.push(
      <>
        <strong>These changes look like formatting.</strong> Most changed cells differ only by case, whitespace, number format or null-like
        values. Try the normalization toggles above.
      </>,
    );
  }
  const emptyN = r.emptyKeys.beforeRows.length + r.emptyKeys.afterRows.length;
  if (emptyN) {
    items.push(
      `${fmt(emptyN)} row(s) have an empty key and could not be matched (Before rows ${list(r.emptyKeys.beforeRows)}${
        r.emptyKeys.afterRows.length ? `; After rows ${list(r.emptyKeys.afterRows)}` : ''
      }).`,
    );
  }
  if (!items.length && !r.duplicates.length) return null;
  return (
    <div className="issues">
      {items.map((it, i) => (
        <div key={i} className="banner warn">
          {it}
        </div>
      ))}
      {r.duplicates.length > 0 && (
        <details className="banner warn" open={r.duplicates.length <= 5}>
          <summary>
            <strong>
              {fmt(r.duplicates.length)} duplicate key{r.duplicates.length > 1 ? 's' : ''}
            </strong>{' '}
            — these rows were not matched instead of guessing. Pick a different or composite key to include them.
          </summary>
          <ul className="dups">
            {r.duplicates.slice(0, 50).map((d) => (
              <li key={d.key}>
                <code>{d.key}</code>: Before rows {list(d.beforeRows) || '—'}; After rows {list(d.afterRows) || '—'}
              </li>
            ))}
            {r.duplicates.length > 50 && <li>…and {fmt(r.duplicates.length - 50)} more</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

function list(rows: number[]) {
  const shown = rows.slice(0, 8).map((r) => r + 1);
  return shown.join(', ') + (rows.length > 8 ? `, … (${rows.length} total)` : '');
}
