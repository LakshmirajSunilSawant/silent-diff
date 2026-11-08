// Performance benchmark against the PRD targets: 10k × 20 in < 3 s, 100k × 20 in < 15 s.
// Run with: npm run bench
import { diffTables } from '../src/core/diff';
import { detectKey } from '../src/core/key';
import { parseDelimited } from '../src/core/parse';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function makeCsv(rows: number, cols: number, withId: boolean, seed: number, edits: number): [string, string] {
  const r = rng(seed);
  const header = Array.from({ length: cols }, (_, c) => (withId && c === 0 ? 'id' : `col${c}`));
  const data: string[][] = [];
  for (let i = 0; i < rows; i++) {
    data.push(header.map((_, c) => (withId && c === 0 ? `ID-${i}` : `v${Math.floor(r() * 1000)}-${c}`)));
  }
  const after = data.map((row) => [...row]);
  for (let e = 0; e < edits; e++) {
    const i = Math.floor(r() * after.length);
    const kind = r();
    if (kind < 0.6) after[i][1 + Math.floor(r() * (cols - 1))] = 'EDITED';
    else if (kind < 0.8) after.splice(i, 1);
    else after.splice(i, 0, header.map((_, c) => (withId && c === 0 ? `NEW-${e}` : `n${e}`)));
  }
  const toText = (d: string[][]) => [header.join(','), ...d.map((row) => row.join(','))].join('\n');
  return [toText(data), toText(after)];
}

function bench(label: string, rows: number, withId: boolean, edits: number, target: number) {
  const [b, a] = makeCsv(rows, 20, withId, 1, edits);
  const t0 = performance.now();
  const before = parseDelimited(b, 'b.csv');
  const after = parseDelimited(a, 'a.csv');
  const t1 = performance.now();
  const det = detectKey(before, after);
  const res = diffTables(before, after, { key: withId && det.key ? [det.key] : null });
  const t2 = performance.now();
  const total = (t2 - t0) / 1000;
  const s = res.summary;
  console.log(
    `${label.padEnd(28)} parse ${((t1 - t0) / 1000).toFixed(2)}s  diff ${((t2 - t1) / 1000).toFixed(2)}s  total ${total.toFixed(2)}s  ` +
      `[+${s.added} −${s.deleted} ~${s.modified}${res.approximate ? ' approx' : ''}]  ${total < target ? 'PASS' : 'FAIL'} (< ${target}s)`,
  );
}

bench('10k × 20 keyed', 10_000, true, 500, 3);
bench('10k × 20 keyless', 10_000, false, 500, 3);
bench('100k × 20 keyed', 100_000, true, 5_000, 15);
bench('100k × 20 keyless', 100_000, false, 2_000, 15);
