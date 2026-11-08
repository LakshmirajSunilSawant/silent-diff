export type Edit = { t: 'eq' | 'del' | 'ins'; b: number; a: number };

/**
 * Myers' O((N+M)·D) shortest edit script between two integer sequences.
 * Returns null when the edit distance exceeds maxD, so callers can fall back.
 * Common prefix and suffix are stripped first, which keeps typical diffs cheap.
 */
export function myersDiff(bSeq: ArrayLike<number>, aSeq: ArrayLike<number>, maxD: number): Edit[] | null {
  const n0 = bSeq.length;
  const m0 = aSeq.length;
  let pre = 0;
  while (pre < n0 && pre < m0 && bSeq[pre] === aSeq[pre]) pre++;
  let suf = 0;
  while (suf < n0 - pre && suf < m0 - pre && bSeq[n0 - 1 - suf] === aSeq[m0 - 1 - suf]) suf++;

  const out: Edit[] = [];
  for (let i = 0; i < pre; i++) out.push({ t: 'eq', b: i, a: i });
  const mid = core(bSeq, aSeq, pre, n0 - suf, pre, m0 - suf, maxD);
  if (!mid) return null;
  for (const e of mid) out.push(e);
  for (let i = suf; i > 0; i--) out.push({ t: 'eq', b: n0 - i, a: m0 - i });
  return out;
}

function core(B: ArrayLike<number>, A: ArrayLike<number>, b0: number, b1: number, a0: number, a1: number, maxD: number): Edit[] | null {
  const N = b1 - b0;
  const M = a1 - a0;
  if (N === 0 || M === 0) {
    const r: Edit[] = [];
    for (let i = 0; i < N; i++) r.push({ t: 'del', b: b0 + i, a: -1 });
    for (let j = 0; j < M; j++) r.push({ t: 'ins', b: -1, a: a0 + j });
    return r;
  }
  const max = N + M;
  const limit = Math.min(max, maxD);
  const off = max + 1;
  const V = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;

  outer: for (let d = 0; d <= limit; d++) {
    trace.push(V.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && B[b0 + x] === A[a0 + y]) {
        x++;
        y++;
      }
      V[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break outer;
      }
    }
  }
  if (found < 0) return null;

  const rev: Edit[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[k - 1 + d] < v[k + 1 + d]) ? k + 1 : k - 1;
    const prevX = v[prevK + d];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      rev.push({ t: 'eq', b: b0 + x, a: a0 + y });
    }
    if (x === prevX) rev.push({ t: 'ins', b: -1, a: a0 + prevY });
    else rev.push({ t: 'del', b: b0 + prevX, a: -1 });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    rev.push({ t: 'eq', b: b0 + x, a: a0 + y });
  }
  return rev.reverse();
}
