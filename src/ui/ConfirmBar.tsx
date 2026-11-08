import { useMemo, useState } from 'react';
import { matchColumns } from '../core/columns';
import type { KeyDetection, NormalizeOptions, Table } from '../core/types';

interface Props {
  before: Table;
  after: Table;
  detection: KeyDetection | null;
  keyChoice: string[] | null | undefined;
  onKey: (k: string[] | null) => void;
  normalize: NormalizeOptions;
  onNormalize: (n: NormalizeOptions) => void;
  hasHeader: boolean;
  onHeader: (v: boolean) => void;
}

const NONE = '__none__';

type BoolKey = 'trim' | 'ignoreCase' | 'numeric' | 'nullEqual' | 'dates';

const TOGGLES: { k: BoolKey; label: string; hint: string }[] = [
  { k: 'trim', label: 'Trim whitespace', hint: '"Acme " equals "Acme"' },
  { k: 'ignoreCase', label: 'Ignore case', hint: '"ACME" equals "acme"' },
  { k: 'numeric', label: 'Compare numbers numerically', hint: '"1,000.00" equals "1000"' },
  { k: 'nullEqual', label: 'Empty = null', hint: 'Empty, NULL, N/A, - and None are equal' },
  { k: 'dates', label: 'Compare dates', hint: '"2024-01-05", "1/5/2024" and "5 Jan 2024" are the same day' },
];

export function ConfirmBar({ before, after, detection, keyChoice, onKey, normalize, onNormalize, hasHeader, onHeader }: Props) {
  const shared = useMemo(() => matchColumns(before, after).filter((c) => c.status === 'both').map((c) => c.name), [before, after]);
  const candidates = new Set(detection?.candidates.map((c) => c.column));
  const keys = keyChoice ?? [];
  // Keep the typed text so partial input like "0." isn't wiped while typing.
  const [tolText, setTolText] = useState(normalize.tolerance ? String(normalize.tolerance) : '');
  const needsPick = detection && keyChoice === undefined;

  const setPart = (i: number, v: string) => {
    if (v === NONE) return onKey(i === 0 ? null : keys.filter((_, j) => j !== i));
    const next = [...keys];
    next[i] = v;
    onKey(next.filter((k, j) => next.indexOf(k) === j));
  };

  const options = (current: string, allowNone: boolean) => (
    <>
      {allowNone && <option value={NONE}>{keys.length > 1 ? '— remove —' : 'No key: align rows by order'}</option>}
      {keyChoice === undefined && current === '' && <option value="">Choose a key column…</option>}
      {shared.map((c) => (
        <option key={c} value={c} disabled={keys.includes(c) && c !== current}>
          {c}
          {candidates.has(c) ? '' : ' (not unique)'}
        </option>
      ))}
    </>
  );

  return (
    <section className="confirm" aria-label="Comparison settings">
      {needsPick && (
        <div className="banner warn" role="alert">
          <strong>Which column identifies a row?</strong> {detection.reason}
          <div className="pick">
            {detection.candidates.slice(0, 4).map((c) => (
              <button key={c.column} className="chip" onClick={() => onKey([c.column])}>
                Match by <code>{c.column}</code>
              </button>
            ))}
            <button className="chip" onClick={() => onKey(null)}>
              Align rows without a key
            </button>
          </div>
        </div>
      )}

      <div className="confirm-row">
        <div className="keypick">
          <span className="lbl">{keyChoice === null ? 'Aligning rows' : 'Matching rows by'}</span>
          <select aria-label="Key column" value={keys[0] ?? (keyChoice === null ? NONE : '')} onChange={(e) => setPart(0, e.target.value)}>
            {options(keys[0] ?? '', true)}
          </select>
          {keys.slice(1).map((k, i) => (
            <span key={i + 1} className="keypart">
              +
              <select aria-label={`Key column ${i + 2}`} value={k} onChange={(e) => setPart(i + 1, e.target.value)}>
                {options(k, true)}
              </select>
            </span>
          ))}
          {keys.length > 0 && keys.length < 3 && (
            <button className="link small" onClick={() => onKey([...keys, shared.find((c) => !keys.includes(c)) ?? keys[0]])} disabled={shared.length <= keys.length}>
              + add column
            </button>
          )}
          {keyChoice === null && detection?.confidence === 'none' && <span className="muted small">No column is unique in both files.</span>}
        </div>

        <div className="toggles" role="group" aria-label="Normalization">
          {TOGGLES.map((t) => (
            <label key={t.k} className="switch" title={t.hint}>
              <input type="checkbox" checked={normalize[t.k]} onChange={(e) => onNormalize({ ...normalize, [t.k]: e.target.checked })} />
              {t.label}
            </label>
          ))}
          {normalize.dates && (
            <select
              aria-label="Date order"
              title="How to read dates like 03/04/2024"
              value={normalize.dateOrder}
              onChange={(e) => onNormalize({ ...normalize, dateOrder: e.target.value as NormalizeOptions['dateOrder'] })}
            >
              <option value="MDY">M/D/Y (US)</option>
              <option value="DMY">D/M/Y</option>
            </select>
          )}
          <span className="tolerance" title="Numbers this close count as equal">
            <label htmlFor="tol">Number tolerance ±</label>
            <input
              id="tol"
              type="number"
              min={0}
              step="any"
              placeholder="0"
              value={tolText}
              onChange={(e) => {
                setTolText(e.target.value);
                const v = Number(e.target.value);
                onNormalize({ ...normalize, tolerance: Number.isFinite(v) && v > 0 ? v : 0 });
              }}
            />
            <select
              aria-label="Tolerance unit"
              value={normalize.toleranceMode}
              onChange={(e) => onNormalize({ ...normalize, toleranceMode: e.target.value as NormalizeOptions['toleranceMode'] })}
            >
              <option value="abs">absolute</option>
              <option value="pct">%</option>
            </select>
          </span>
          <label className="switch" title="Turn off if the first row is data, not column names">
            <input type="checkbox" checked={hasHeader} onChange={(e) => onHeader(e.target.checked)} />
            First row is headers
          </label>
        </div>
      </div>
    </section>
  );
}
