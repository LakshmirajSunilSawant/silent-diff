import { useRef, useState } from 'react';
import type { Side } from '../core/protocol';
import type { FileSlot } from './App';

interface Props {
  slots: Record<Side, FileSlot | null>;
  onFile: (side: Side, f: File) => void;
  onClear: (side: Side) => void;
  onSwap: () => void;
  onSamples: () => void;
  compact: boolean;
}

const ACCEPT = '.csv,.tsv,.tab,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Zone({ side, slot, onFile, onClear, compact }: { side: Side; slot: FileSlot | null; onFile: Props['onFile']; onClear: Props['onClear']; compact: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const label = side === 'before' ? 'Before' : 'After';

  const pick = () => input.current?.click();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    // Two files dropped at once fill both slots, in the order given.
    if (files.length >= 2) {
      onFile('before', files[0]);
      onFile('after', files[1]);
    } else if (files[0]) onFile(side, files[0]);
  };

  const t = slot?.table;
  return (
    <div
      className={`zone ${over ? 'over' : ''} ${slot ? 'filled' : ''} ${compact ? 'compact' : ''} ${slot?.error ? 'bad' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        pick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${label} file. ${slot ? `Loaded ${slot.name}.` : ''} Press Enter to choose a file, or drop one here.`}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(side, f);
          e.target.value = '';
        }}
      />
      <div className="zone-label">{label}</div>
      {!slot && (
        <div className="zone-empty">
          <div className="zone-icon" aria-hidden="true">⇩</div>
          <div>
            Drop a file here or <span className="link">browse</span>
          </div>
          <div className="muted small">CSV, TSV or Excel (.xlsx)</div>
        </div>
      )}
      {slot && (
        <div className="zone-file">
          <div className="fname" title={slot.name}>
            {slot.name}
          </div>
          {slot.loading && <div className="muted small">Reading…</div>}
          {slot.error && <div className="err small">{slot.error}</div>}
          {t && (
            <div className="muted small">
              {t.rowCount.toLocaleString()} rows × {t.headers.length} columns · {fmtSize(slot.size)}
              {t.meta.format === 'xlsx' ? ` · sheet “${t.meta.sheetName}”` : ` · ${t.meta.encoding}, ${delimName(t.meta.delimiter)}`}
            </div>
          )}
          <div className="zone-actions">
            <button className="link" onClick={pick}>
              Replace
            </button>
            <button className="link" onClick={() => onClear(side)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function delimName(d?: string) {
  return d === '\t' ? 'tab-separated' : d === ';' ? 'semicolon-separated' : d === '|' ? 'pipe-separated' : 'comma-separated';
}

export function DropZones({ slots, onFile, onClear, onSwap, onSamples, compact }: Props) {
  return (
    <section className={`drop ${compact ? 'compact' : ''}`} aria-label="Files to compare">
      <div className="zones">
        <Zone side="before" slot={slots.before} onFile={onFile} onClear={onClear} compact={compact} />
        <button className="swap" onClick={onSwap} disabled={!slots.before && !slots.after} title="Swap Before and After" aria-label="Swap Before and After">
          ⇄
        </button>
        <Zone side="after" slot={slots.after} onFile={onFile} onClear={onClear} compact={compact} />
      </div>
      {!compact && (
        <p className="privacy">
          🔒 Files are processed in your browser and never uploaded.{' '}
          <button className="link" onClick={onSamples}>
            Try sample files
          </button>
        </p>
      )}
    </section>
  );
}
