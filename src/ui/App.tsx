import { useCallback, useEffect, useRef, useState } from 'react';
import { DiffWorker } from '../client';
import { MAX_BYTES } from '../core/parse';
import type { Side } from '../core/protocol';
import { DEFAULT_NORMALIZE, type DiffResult, type KeyDetection, type NormalizeOptions, type Table } from '../core/types';
import { exportCsv, exportXlsx, type Palette } from '../export';
import { sampleFiles } from '../samples';
import { ConfirmBar } from './ConfirmBar';
import { DiffView } from './DiffView';
import { DropZones } from './DropZones';

export interface FileSlot {
  name: string;
  size: number;
  table?: Table;
  error?: string;
  loading: boolean;
}

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('silent-diff:' + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem('silent-diff:' + key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function App() {
  const worker = useRef<DiffWorker>();
  if (!worker.current) worker.current = new DiffWorker();

  const [slots, setSlots] = useState<Record<Side, FileSlot | null>>({ before: null, after: null });
  const [hasHeader, setHasHeader] = useState(true);
  const [normalize, setNormalize] = useState<NormalizeOptions>(() => loadPref('normalize', DEFAULT_NORMALIZE));
  const [palette, setPalette] = useState<Palette>(() => loadPref('palette', 'default'));
  const [detection, setDetection] = useState<KeyDetection | null>(null);
  /** undefined: waiting for the user to pick; null: align without a key. */
  const [key, setKey] = useState<string[] | null | undefined>(undefined);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const diffSeq = useRef(0);

  useEffect(() => savePref('normalize', normalize), [normalize]);
  useEffect(() => {
    savePref('palette', palette);
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  const before = slots.before?.table;
  const after = slots.after?.table;

  const resetDiff = () => {
    setDetection(null);
    setKey(undefined);
    setResult(null);
  };

  const loadFile = useCallback(
    async (side: Side, file: File) => {
      setError(null);
      resetDiff();
      if (file.size > MAX_BYTES) {
        setSlots((s) => ({
          ...s,
          [side]: { name: file.name, size: file.size, loading: false, error: 'This file is over 200 MB. Use the command-line version (npm run cli) for files this big.' },
        }));
        return;
      }
      setSlots((s) => ({ ...s, [side]: { name: file.name, size: file.size, loading: true } }));
      try {
        const buffer = await file.arrayBuffer();
        const res = await worker.current!.send<'parsed'>({ type: 'parse', side, name: file.name, buffer, hasHeader }, [buffer]);
        setSlots((s) => ({ ...s, [side]: { name: file.name, size: file.size, loading: false, table: res.table } }));
      } catch (e) {
        await worker.current!.send({ type: 'clear', side });
        setSlots((s) => ({ ...s, [side]: { name: file.name, size: file.size, loading: false, error: (e as Error).message } }));
      }
    },
    [hasHeader],
  );

  const clearFile = async (side: Side) => {
    await worker.current!.send({ type: 'clear', side });
    setSlots((s) => ({ ...s, [side]: null }));
    resetDiff();
  };

  const swap = async () => {
    await worker.current!.send({ type: 'swap' });
    setSlots((s) => ({ before: s.after, after: s.before }));
    resetDiff();
  };

  const toggleHeader = async (v: boolean) => {
    setHasHeader(v);
    resetDiff();
    const res = await worker.current!.send<'reparsed'>({ type: 'reparse', hasHeader: v });
    setSlots((s) => ({
      before: s.before && res.before ? { ...s.before, table: res.before } : s.before,
      after: s.after && res.after ? { ...s.after, table: res.after } : s.after,
    }));
  };

  // Both files parsed → detect the key. Diff right away only when confident.
  useEffect(() => {
    if (!before || !after || detection) return;
    let cancelled = false;
    setBusy('Finding the key column…');
    worker.current!
      .send<'detected'>({ type: 'detect' })
      .then(({ detection: d }) => {
        if (cancelled) return;
        setDetection(d);
        if (d.confidence === 'high') setKey([d.key!]);
        else if (d.confidence === 'none') setKey(null);
        else setKey(undefined);
      })
      .catch((e) => setError(e.message))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [before, after, detection]);

  // Re-run only the diff when the key or normalization changes; parsed files stay in the worker.
  useEffect(() => {
    if (!before || !after || !detection || key === undefined) return;
    const seq = ++diffSeq.current;
    setBusy('Comparing…');
    worker.current!
      .send<'diffed'>({ type: 'diff', key, normalize })
      .then(({ result: r }) => {
        if (seq === diffSeq.current) setResult(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => seq === diffSeq.current && setBusy(null));
  }, [before, after, detection, key, normalize]);

  const loadSamples = async () => {
    const { before: b, after: a } = sampleFiles();
    await Promise.all([loadFile('before', b), loadFile('after', a)]);
  };

  const doExport = async (kind: 'xlsx' | 'csv') => {
    if (!result || !before || !after) return;
    setExporting(true);
    try {
      if (kind === 'xlsx') await exportXlsx(result, before, after, palette);
      else exportCsv(result, before, after);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const bothLoaded = !!before && !!after;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <i className="l-add" />
            <i className="l-mod" />
            <i className="l-del" />
          </span>
          <h1>Silent-Diff</h1>
          <span className="tagline">See exactly what changed between two spreadsheets.</span>
        </div>
        <div className="top-actions">
          <label className="switch" title="Use blue and orange instead of green and red">
            <input type="checkbox" checked={palette === 'colorblind'} onChange={(e) => setPalette(e.target.checked ? 'colorblind' : 'default')} />
            Color-blind palette
          </label>
        </div>
      </header>

      <main>
        <DropZones slots={slots} onFile={loadFile} onClear={clearFile} onSwap={swap} onSamples={loadSamples} compact={bothLoaded} />

        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {bothLoaded && (
          <ConfirmBar
            before={before}
            after={after}
            detection={detection}
            keyChoice={key}
            onKey={setKey}
            normalize={normalize}
            onNormalize={setNormalize}
            hasHeader={hasHeader}
            onHeader={toggleHeader}
          />
        )}

        {busy && (
          <div className="busy" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> {busy}
          </div>
        )}

        {bothLoaded && result && key !== undefined && (
          <DiffView result={result} before={before} after={after} onExport={doExport} exporting={exporting} stale={!!busy} />
        )}
      </main>

      <footer className="foot">
        <span>🔒 All processing happens in this browser tab. Files are never uploaded, and the app works offline once loaded.</span>
      </footer>
    </div>
  );
}
