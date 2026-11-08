import { matchColumns } from './columns';
import type { KeyCandidate, KeyDetection, Table } from './types';

const STRONG_NAMES = new Set(['id', 'key', 'email', 'sku', 'code', 'uuid', 'guid', 'email address', 'e-mail']);

function nameScore(name: string): number {
  const n = name.trim().toLowerCase();
  if (STRONG_NAMES.has(n)) return 3;
  if (/(^|[\s_-])(id|uuid|guid|sku)$/.test(n) || /id$/.test(n.replace(/[\s_-]/g, '')) || n.includes('email')) return 2;
  if (/(^|[\s_-])(key|code|number|no|num|ref|reference)([\s_-]|$)/.test(n)) return 1;
  return 0;
}

interface ColStats {
  filled: number;
  unique: number;
  values: Set<string>;
  rowIndex: boolean;
}

function stats(col: string[]): ColStats {
  const values = new Set<string>();
  let nonEmpty = 0;
  let rowIndex = col.length > 1;
  for (let r = 0; r < col.length; r++) {
    const v = col[r].trim();
    if (!v) continue;
    nonEmpty++;
    values.add(v);
    if (rowIndex && v !== String(r + 1) && v !== String(r)) rowIndex = false;
  }
  return {
    filled: col.length ? nonEmpty / col.length : 1,
    unique: nonEmpty ? values.size / nonEmpty : 1,
    values,
    rowIndex,
  };
}

/** Score every column present in both files and pick the one a human would match rows by. */
export function detectKey(before: Table, after: Table): KeyDetection {
  const shared = matchColumns(before, after).filter((c) => c.status === 'both');
  if (!shared.length) return { key: null, confidence: 'none', reason: 'These files share no columns.', candidates: [] };

  const scored: (KeyCandidate & { perfect: boolean; near: boolean; rowIndex: boolean; name: number })[] = [];
  for (const col of shared) {
    const sb = stats(before.columns[col.bi]);
    const sa = stats(after.columns[col.ai]);
    const filled = Math.min(sb.filled, sa.filled);
    const unique = Math.min(sb.unique, sa.unique);
    const [small, big] = sb.values.size <= sa.values.size ? [sb.values, sa.values] : [sa.values, sb.values];
    let common = 0;
    for (const v of small) if (big.has(v)) common++;
    const overlap = small.size ? common / small.size : 1;
    const perfect = filled === 1 && unique === 1;
    const near = !perfect && filled >= 0.8 && unique >= 0.95;
    const name = nameScore(col.name);
    // A 1..n column is only suspicious when it isn't named like an ID.
    const rowIndex = sb.rowIndex && sa.rowIndex && name < 2;
    const score = (perfect ? 10 : near ? 5 : 0) + name + overlap * 2 - (rowIndex ? 6 : 0);
    if (perfect || near) scored.push({ column: col.name, score, filled, unique, overlap, perfect, near, rowIndex, name });
  }
  scored.sort((x, y) => y.score - x.score || shared.findIndex((c) => c.name === x.column) - shared.findIndex((c) => c.name === y.column));
  const candidates: KeyCandidate[] = scored.map(({ column, score, filled, unique, overlap }) => ({ column, score, filled, unique, overlap }));

  const best = scored[0];
  if (!best) {
    return { key: null, confidence: 'none', reason: 'No column is unique in both files, so rows are aligned by position and content.', candidates };
  }
  if (!best.perfect) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    return {
      key: best.column,
      confidence: 'low',
      reason: `"${best.column}" is the closest match but is only ${pct(best.filled)} filled and ${pct(best.unique)} unique. Pick a key or align rows without one.`,
      candidates,
    };
  }
  if (best.rowIndex) {
    return { key: best.column, confidence: 'low', reason: `"${best.column}" looks like a row number, which changes when rows are sorted.`, candidates };
  }
  if (best.overlap < 0.5) {
    return {
      key: best.column,
      confidence: 'low',
      reason: `Only ${Math.round(best.overlap * 100)}% of "${best.column}" values appear in both files. Check this is the right key.`,
      candidates,
    };
  }
  const betterNamed = scored.find((c) => c.near && c.name >= 2 && best.name < 2);
  if (betterNamed) {
    return {
      key: best.column,
      confidence: 'low',
      reason: `"${betterNamed.column}" looks like the key but has blank or repeated values. Pick a key or align rows without one.`,
      candidates,
    };
  }
  if (best.name === 0 && best.overlap < 0.9) {
    return { key: best.column, confidence: 'low', reason: `"${best.column}" is unique, but its values changed a lot between files.`, candidates };
  }
  return { key: best.column, confidence: 'high', reason: `"${best.column}" is unique and filled in both files.`, candidates };
}
