import { matchColumns } from './columns';
import { myersDiff, type Edit } from './myers';
import { ALL_NORMALIZATIONS, normalizeValue, parseNumber } from './normalize';
import type {
  ColumnStat,
  DiffColumn,
  DiffOp,
  DiffResult,
  DuplicateKey,
  NormalizeOptions,
  Table,
} from './types';
import { DEFAULT_NORMALIZE } from './types';

export interface DiffOptions {
  /** Key column names (1–3), or null to align rows without a key. */
  key: string[] | null;
  normalize?: NormalizeOptions;
  /** Share of cells that must match to pair a deleted and an added row as "modified" (keyless mode). */
  similarity?: number;
  /** Total work budget for keyless alignment before falling back to a set comparison. */
  alignBudget?: number;
}

export const DEFAULT_SIMILARITY = 0.5;
const PAIR_MATRIX_CAP = 250_000;

interface Ctx {
  before: Table;
  after: Table;
  columns: DiffColumn[];
  /** Indices into columns with status 'both'. */
  shared: number[];
  nb: string[][];
  na: string[][];
  norm: NormalizeOptions;
}

export function diffTables(before: Table, after: Table, options: DiffOptions): DiffResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const norm = { ...DEFAULT_NORMALIZE, ...options.normalize };
  const columns = matchColumns(before, after);
  const shared = columns.flatMap((c, i) => (c.status === 'both' ? [i] : []));
  const nb: string[][] = [];
  const na: string[][] = [];
  for (const ci of shared) {
    const c = columns[ci];
    nb[ci] = before.columns[c.bi].map((v) => normalizeValue(v, norm));
    na[ci] = after.columns[c.ai].map((v) => normalizeValue(v, norm));
  }
  const ctx: Ctx = { before, after, columns, shared, nb, na, norm };
  const warnings: string[] = [];

  let key = options.key && options.key.length ? options.key.slice(0, 3) : null;
  if (key) {
    const missing = key.filter((k) => !columns.some((c) => c.name === k && c.status === 'both'));
    if (missing.length) {
      warnings.push(`Key column ${missing.map((m) => `"${m}"`).join(', ')} is not in both files; rows were aligned without a key.`);
      key = null;
    }
  }

  let core: Pick<DiffResult, 'ops' | 'duplicates' | 'emptyKeys' | 'approximate'> & { reordered: boolean };
  if (!shared.length) {
    warnings.push('These files share no columns, so every row shows as deleted and added.');
    core = {
      ops: [
        ...range(before.rowCount).map((b): DiffOp => ({ type: 'deleted', b, a: -1 })),
        ...range(after.rowCount).map((a): DiffOp => ({ type: 'added', b: -1, a })),
      ],
      duplicates: [],
      emptyKeys: { beforeRows: [], afterRows: [] },
      approximate: false,
      reordered: false,
    };
  } else if (key) {
    core = keyedDiff(ctx, key);
  } else {
    core = keylessDiff(ctx, options.similarity ?? DEFAULT_SIMILARITY, options.alignBudget ?? 1_000_000_000);
    if (core.approximate) warnings.push('These files are large and very different, so rows were aligned approximately.');
  }

  const summary = summarize(ctx, core.ops, core.reordered);
  summary.unmatchable =
    core.duplicates.reduce((s, d) => s + d.beforeRows.length + d.afterRows.length, 0) +
    core.emptyKeys.beforeRows.length +
    core.emptyKeys.afterRows.length;

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    mode: key ? 'keyed' : 'keyless',
    key,
    columns,
    ops: core.ops,
    summary,
    duplicates: core.duplicates,
    emptyKeys: core.emptyKeys,
    approximate: core.approximate,
    warnings,
    normalize: norm,
    elapsedMs: Math.round(t1 - t0),
  };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function compareRows(ctx: Ctx, b: number, a: number): number[] {
  const changed: number[] = [];
  for (const ci of ctx.shared) if (ctx.nb[ci][b] !== ctx.na[ci][a]) changed.push(ci);
  return changed;
}

function rowOp(ctx: Ctx, b: number, a: number): DiffOp {
  const changed = compareRows(ctx, b, a);
  return changed.length ? { type: 'modified', b, a, changed } : { type: 'unchanged', b, a };
}

// ---------------------------------------------------------------- keyed

function keyedDiff(ctx: Ctx, key: string[]) {
  const keyCols = key.map((k) => ctx.columns.find((c) => c.name === k && c.status === 'both')!);
  // Keys always ignore surrounding whitespace; case follows the user's setting.
  const keyNorm: NormalizeOptions = { trim: true, ignoreCase: ctx.norm.ignoreCase, numeric: false, nullEqual: false };
  const keyOf = (t: Table, side: 'bi' | 'ai', r: number) => {
    const parts = keyCols.map((c) => normalizeValue(t.columns[c[side]][r], keyNorm));
    return parts.every((p) => p === '') ? '' : parts.join('\u0001');
  };

  const index = (t: Table, side: 'bi' | 'ai') => {
    const map = new Map<string, number[]>();
    const empty: number[] = [];
    for (let r = 0; r < t.rowCount; r++) {
      const k = keyOf(t, side, r);
      if (!k) {
        empty.push(r);
        continue;
      }
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    return { map, empty };
  };
  const bIdx = index(ctx.before, 'bi');
  const aIdx = index(ctx.after, 'ai');

  const duplicates: DuplicateKey[] = [];
  const dupKeys = new Set<string>();
  for (const [k, rows] of bIdx.map) {
    const other = aIdx.map.get(k) ?? [];
    if (rows.length > 1 || other.length > 1) dupKeys.add(k);
  }
  for (const [k, rows] of aIdx.map) if (rows.length > 1) dupKeys.add(k);
  for (const k of dupKeys) {
    duplicates.push({ key: k.split('\u0001').join(' | '), beforeRows: bIdx.map.get(k) ?? [], afterRows: aIdx.map.get(k) ?? [] });
  }
  duplicates.sort((x, y) => (x.beforeRows[0] ?? x.afterRows[0]) - (y.beforeRows[0] ?? y.afterRows[0]));

  // Walk After once, in order. Matched Before indices let us slot deleted rows near their old neighbours.
  const main: DiffOp[] = [];
  const bMatchedAt = new Int32Array(ctx.before.rowCount).fill(-1);
  let lastB = -1;
  let reordered = false;
  for (let a = 0; a < ctx.after.rowCount; a++) {
    const k = keyOf(ctx.after, 'ai', a);
    if (!k || dupKeys.has(k)) continue;
    const bRows = bIdx.map.get(k);
    if (bRows) {
      const b = bRows[0];
      if (b < lastB) reordered = true;
      lastB = b;
      bMatchedAt[b] = main.length;
      main.push(rowOp(ctx, b, a));
    } else {
      main.push({ type: 'added', b: -1, a });
    }
  }

  // Deleted rows go after the op of the nearest earlier matched Before row.
  const deletedAfter = new Map<number, DiffOp[]>();
  let anchor = -1;
  for (let b = 0; b < ctx.before.rowCount; b++) {
    if (bMatchedAt[b] >= 0) {
      anchor = bMatchedAt[b];
      continue;
    }
    const k = keyOf(ctx.before, 'bi', b);
    if (!k || dupKeys.has(k) || aIdx.map.has(k)) continue;
    const list = deletedAfter.get(anchor);
    const op: DiffOp = { type: 'deleted', b, a: -1 };
    if (list) list.push(op);
    else deletedAfter.set(anchor, [op]);
  }
  const ops: DiffOp[] = [...(deletedAfter.get(-1) ?? [])];
  main.forEach((op, i) => {
    ops.push(op);
    const d = deletedAfter.get(i);
    if (d) ops.push(...d);
  });

  return {
    ops,
    duplicates,
    emptyKeys: { beforeRows: bIdx.empty, afterRows: aIdx.empty },
    approximate: false,
    reordered,
  };
}

// ---------------------------------------------------------------- keyless

function keylessDiff(ctx: Ctx, similarity: number, budget: number) {
  const intern = new Map<string, number>();
  const hashRows = (cols: string[][], n: number) => {
    const out = new Int32Array(n);
    for (let r = 0; r < n; r++) {
      let s = '';
      for (const ci of ctx.shared) s += cols[ci][r] + '\u0001';
      let id = intern.get(s);
      if (id === undefined) {
        id = intern.size;
        intern.set(s, id);
      }
      out[r] = id;
    }
    return out;
  };
  const hb = hashRows(ctx.nb, ctx.before.rowCount);
  const ha = hashRows(ctx.na, ctx.after.rowCount);

  const total = hb.length + ha.length;
  const maxD = Math.max(50, Math.min(4000, Math.floor(budget / Math.max(1, total))));
  let script: Edit[] | null = myersDiff(hb, ha, maxD);
  let approximate = false;
  if (!script) {
    approximate = true;
    script = setAlign(hb, ha);
  }

  // Identical rows that were deleted in one place and inserted in another were moved, not changed.
  let reordered = false;
  const delQueue = new Map<number, number[]>();
  script.forEach((e, i) => {
    if (e.t !== 'del') return;
    const q = delQueue.get(hb[e.b]);
    if (q) q.push(i);
    else delQueue.set(hb[e.b], [i]);
  });
  const dead = new Uint8Array(script.length);
  for (let i = 0; i < script.length; i++) {
    const e = script[i];
    if (e.t !== 'ins') continue;
    const q = delQueue.get(ha[e.a]);
    if (q && q.length) {
      const d = q.shift()!;
      dead[d] = 1;
      script[i] = { t: 'eq', b: script[d].b, a: e.a };
      reordered = true;
    }
  }
  // An "eq" edit can also be out of order after a set-based fallback.
  if (!reordered) {
    let last = -1;
    for (const e of script) {
      if (e.t !== 'eq') continue;
      if (e.b < last) {
        reordered = true;
        break;
      }
      last = e.b;
    }
  }

  const ops: DiffOp[] = [];
  let hunkDel: number[] = [];
  let hunkIns: number[] = [];
  const flush = () => {
    if (hunkDel.length || hunkIns.length) ops.push(...pairHunk(ctx, hunkDel, hunkIns, similarity));
    hunkDel = [];
    hunkIns = [];
  };
  for (let i = 0; i < script.length; i++) {
    if (dead[i]) continue;
    const e = script[i];
    if (e.t === 'eq') {
      flush();
      // Hashes match, but compare cells anyway in case of a (vanishingly unlikely) collision.
      ops.push(rowOp(ctx, e.b, e.a));
    } else if (e.t === 'del') hunkDel.push(e.b);
    else hunkIns.push(e.a);
  }
  flush();
  const across = pairAcrossHunks(ctx, ops, similarity);
  if (across.moved) reordered = true;

  return { ops: across.ops, duplicates: [], emptyKeys: { beforeRows: [], afterRows: [] }, approximate, reordered };
}

/** Fallback for huge, very different keyless files: match identical rows as a multiset. */
function setAlign(hb: Int32Array, ha: Int32Array): Edit[] {
  const pool = new Map<number, number[]>();
  hb.forEach((h, b) => {
    const q = pool.get(h);
    if (q) q.push(b);
    else pool.set(h, [b]);
  });
  const used = new Uint8Array(hb.length);
  const out: Edit[] = [];
  const ins: Edit[] = [];
  ha.forEach((h, a) => {
    const q = pool.get(h);
    if (q && q.length) {
      const b = q.shift()!;
      used[b] = 1;
      out.push({ t: 'eq', b, a });
    } else ins.push({ t: 'ins', b: -1, a });
  });
  // Put all leftovers into one trailing hunk so they can be paired by similarity.
  const dels: Edit[] = [];
  hb.forEach((_, b) => {
    if (!used[b]) dels.push({ t: 'del', b, a: -1 });
  });
  // Interleave: eq rows in After order, then the hunk.
  return [...out, ...dels, ...ins];
}

function similarityOf(ctx: Ctx, b: number, a: number): number {
  let same = 0;
  for (const ci of ctx.shared) if (ctx.nb[ci][b] === ctx.na[ci][a]) same++;
  return same / ctx.shared.length;
}

/** Pair deleted and added rows that mostly match. Returns a map from ins index to del index. */
function similarPairs(ctx: Ctx, dels: number[], ins: number[], threshold: number): Map<number, number> {
  const pairOf = new Map<number, number>();
  if (!dels.length || !ins.length || ctx.shared.length < 2) return pairOf;
  const delUsed = new Uint8Array(dels.length);
  if (dels.length * ins.length <= PAIR_MATRIX_CAP) {
    const cand: [number, number, number][] = [];
    for (let i = 0; i < dels.length; i++) {
      for (let j = 0; j < ins.length; j++) {
        const s = similarityOf(ctx, dels[i], ins[j]);
        if (s >= threshold) cand.push([s, i, j]);
      }
    }
    // Best matches first; ties go to rows at similar positions, then earliest.
    cand.sort((x, y) => y[0] - x[0] || Math.abs(x[1] - x[2]) - Math.abs(y[1] - y[2]) || x[2] - y[2] || x[1] - y[1]);
    for (const [, i, j] of cand) {
      if (delUsed[i] || pairOf.has(j)) continue;
      delUsed[i] = 1;
      pairOf.set(j, i);
    }
  } else {
    // Too big to compare every pair: compare each added row with deleted rows at a similar relative position.
    const W = 64;
    const ratio = dels.length / ins.length;
    for (let j = 0; j < ins.length; j++) {
      const center = Math.floor(j * ratio);
      let best = -1;
      let bestSim = threshold;
      for (let i = Math.max(0, center - W); i <= Math.min(dels.length - 1, center + W); i++) {
        if (delUsed[i]) continue;
        const s = similarityOf(ctx, dels[i], ins[j]);
        if (s > bestSim || (s === bestSim && best < 0)) {
          best = i;
          bestSim = s;
        }
      }
      if (best >= 0) {
        delUsed[best] = 1;
        pairOf.set(j, best);
      }
    }
  }
  return pairOf;
}

/** Inside a run of deletes and adds, pair rows that mostly match as modifications. */
function pairHunk(ctx: Ctx, dels: number[], ins: number[], threshold: number): DiffOp[] {
  const pairOf = similarPairs(ctx, dels, ins, threshold);
  const paired = new Set(pairOf.values());
  const out: DiffOp[] = [];
  dels.forEach((b, i) => {
    if (!paired.has(i)) out.push({ type: 'deleted', b, a: -1 });
  });
  ins.forEach((a, j) => {
    const i = pairOf.get(j);
    out.push(i === undefined ? { type: 'added', b: -1, a } : rowOp(ctx, dels[i], a));
  });
  return out;
}

/**
 * A moved row can split one edit across two hunks. Pair the leftovers across the
 * whole file; a pair found here is an edited row that also moved.
 */
function pairAcrossHunks(ctx: Ctx, ops: DiffOp[], threshold: number): { ops: DiffOp[]; moved: boolean } {
  const delPos: number[] = [];
  const insPos: number[] = [];
  ops.forEach((op, i) => {
    if (op.type === 'deleted') delPos.push(i);
    else if (op.type === 'added') insPos.push(i);
  });
  if (!delPos.length || !insPos.length) return { ops, moved: false };
  const pairOf = similarPairs(ctx, delPos.map((p) => ops[p].b), insPos.map((p) => ops[p].a), threshold);
  if (!pairOf.size) return { ops, moved: false };
  const out = ops.slice();
  const drop = new Set<number>();
  for (const [j, i] of pairOf) {
    out[insPos[j]] = rowOp(ctx, ops[delPos[i]].b, ops[insPos[j]].a);
    drop.add(delPos[i]);
  }
  return { ops: out.filter((_, i) => !drop.has(i)), moved: true };
}

// ---------------------------------------------------------------- summary

function summarize(ctx: Ctx, ops: DiffOp[], reordered: boolean) {
  let added = 0;
  let deleted = 0;
  let modified = 0;
  let unchanged = 0;
  const perCol = new Map<number, number>();
  let changedCells = 0;
  let formattingOnly = 0;
  for (const op of ops) {
    if (op.type === 'added') added++;
    else if (op.type === 'deleted') deleted++;
    else if (op.type === 'unchanged') unchanged++;
    else {
      modified++;
      for (const ci of op.changed!) {
        perCol.set(ci, (perCol.get(ci) ?? 0) + 1);
        changedCells++;
        const c = ctx.columns[ci];
        const bv = ctx.before.columns[c.bi][op.b];
        const av = ctx.after.columns[c.ai][op.a];
        if (normalizeValue(bv, ALL_NORMALIZATIONS) === normalizeValue(av, ALL_NORMALIZATIONS)) formattingOnly++;
      }
    }
  }
  const allOn = ctx.norm.trim && ctx.norm.ignoreCase && ctx.norm.numeric && ctx.norm.nullEqual;

  const perColumn: ColumnStat[] = ctx.shared.map((ci) => {
    const c = ctx.columns[ci];
    const stat: ColumnStat = { column: c.name, changed: perCol.get(ci) ?? 0 };
    const sb = numericSum(ctx.before.columns[c.bi]);
    const sa = numericSum(ctx.after.columns[c.ai]);
    if (sb !== null && sa !== null) stat.netChange = roundTo(sa - sb, 10);
    return stat;
  });

  return {
    added,
    deleted,
    modified,
    unchanged,
    columnsAdded: ctx.columns.filter((c) => c.status === 'added').map((c) => c.name),
    columnsRemoved: ctx.columns.filter((c) => c.status === 'removed').map((c) => c.name),
    reordered,
    unmatchable: 0,
    perColumn,
    looksLikeFormatting: !allOn && changedCells > 0 && formattingOnly / changedCells > 0.5,
  };
}

/** Sum of a column if at least 90% of its non-empty values are numbers, otherwise null. */
function numericSum(col: string[]): number | null {
  let sum = 0;
  let nums = 0;
  let nonEmpty = 0;
  for (const v of col) {
    if (!v.trim()) continue;
    nonEmpty++;
    const n = parseNumber(v);
    if (n !== null) {
      sum += n;
      nums++;
    }
  }
  if (nonEmpty === 0) return 0;
  return nums / nonEmpty >= 0.9 ? sum : null;
}

function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
