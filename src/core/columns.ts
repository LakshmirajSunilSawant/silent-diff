import type { DiffColumn, Table } from './types';

/**
 * Match columns by header name, not position. Exact names match first, then
 * case- and whitespace-insensitive names. Order follows After, with removed
 * Before columns placed next to their old neighbours.
 */
export function matchColumns(before: Table, after: Table, renames: Record<string, string> = {}): DiffColumn[] {
  const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const bUsed = new Set<number>();
  const aToB = new Map<number, number>();
  const renamed = new Set<number>();

  // Renames the user accepted (Before name → After name) are matched first.
  for (const [from, to] of Object.entries(renames)) {
    const bi = before.headers.indexOf(from);
    const ai = after.headers.indexOf(to);
    if (bi < 0 || ai < 0 || bUsed.has(bi) || aToB.has(ai)) continue;
    // Skip if the name still exists on both sides; then it is not a rename.
    if (after.headers.includes(from) || before.headers.includes(to)) continue;
    aToB.set(ai, bi);
    bUsed.add(bi);
    renamed.add(ai);
  }

  const bExact = new Map<string, number>();
  before.headers.forEach((h, i) => bExact.set(h, i));
  after.headers.forEach((h, ai) => {
    if (aToB.has(ai)) return;
    const bi = bExact.get(h);
    if (bi !== undefined && !bUsed.has(bi)) {
      aToB.set(ai, bi);
      bUsed.add(bi);
    }
  });
  const bFold = new Map<string, number>();
  before.headers.forEach((h, i) => {
    if (!bUsed.has(i) && !bFold.has(fold(h))) bFold.set(fold(h), i);
  });
  after.headers.forEach((h, ai) => {
    if (aToB.has(ai)) return;
    const bi = bFold.get(fold(h));
    if (bi !== undefined && !bUsed.has(bi)) {
      aToB.set(ai, bi);
      bUsed.add(bi);
    }
  });

  const cols: DiffColumn[] = after.headers.map((name, ai) => {
    const bi = aToB.get(ai);
    if (bi === undefined) return { name, status: 'added', bi: -1, ai };
    return renamed.has(ai) ? { name, status: 'both', bi, ai, renamedFrom: before.headers[bi] } : { name, status: 'both', bi, ai };
  });

  // Insert each removed column right after the column that preceded it in Before.
  before.headers.forEach((name, bi) => {
    if (bUsed.has(bi)) return;
    const col: DiffColumn = { name, status: 'removed', bi, ai: -1 };
    let pos = 0;
    for (let k = cols.length - 1; k >= 0; k--) {
      if (cols[k].bi !== -1 && cols[k].bi < bi) {
        pos = k + 1;
        break;
      }
    }
    cols.splice(pos, 0, col);
  });
  return cols;
}
