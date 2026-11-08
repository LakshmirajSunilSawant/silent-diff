import { describe, expect, it } from 'vitest';
import { diffTables, type DiffOptions } from '../src/core/diff';
import { detectKey } from '../src/core/key';
import { decodeText, parseDelimited, parseFile } from '../src/core/parse';
import { myersDiff } from '../src/core/myers';
import { parseNumber } from '../src/core/normalize';
import type { DiffResult, Table } from '../src/core/types';

const csv = (s: string) => parseDelimited(s.replace(/^\n/, ''));

function run(b: string, a: string, opts: Partial<DiffOptions> = {}): DiffResult {
  const before = csv(b);
  const after = csv(a);
  const key = opts.key !== undefined ? opts.key : (() => {
    const d = detectKey(before, after);
    return d.key ? [d.key] : null;
  })();
  return diffTables(before, after, { ...opts, key });
}

const counts = (r: DiffResult) => {
  const { added, deleted, modified } = r.summary;
  return { added, deleted, modified };
};

const BASE = `
id,name,email,city
1,Ada,ada@x.com,London
2,Bob,bob@x.com,Paris
3,Cy,cy@x.com,Rome
4,Di,di@x.com,Oslo
`;

describe('edge case matrix', () => {
  it('identical files → no differences', () => {
    const r = run(BASE, BASE);
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 0 });
    expect(r.summary.unchanged).toBe(4);
  });

  it('re-sorted rows with a key → zero changes', () => {
    const sorted = `id,name,email,city\n4,Di,di@x.com,Oslo\n2,Bob,bob@x.com,Paris\n1,Ada,ada@x.com,London\n3,Cy,cy@x.com,Rome\n`;
    const r = run(BASE, sorted);
    expect(r.mode).toBe('keyed');
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 0 });
    expect(r.summary.reordered).toBe(true);
  });

  it('re-sorted rows without a key → one reordered note, no changes', () => {
    const b = `name,city\nAda,London\nAda,London\nBob,Paris\nCy,Rome`;
    const a = `name,city\nCy,Rome\nAda,London\nBob,Paris\nAda,London`;
    const r = run(b, a, { key: null });
    expect(r.mode).toBe('keyless');
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 0 });
    expect(r.summary.reordered).toBe(true);
  });

  it('reordered columns → zero changes', () => {
    const r = run(`name,email\nA,a@x\nB,b@x`, `email,name\nb@x,B\na@x,A`);
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 0 });
  });

  it('added column → reported, rows not modified', () => {
    const r = run(`id,name\n1,A\n2,B`, `id,name,phone\n1,A,555\n2,B,666`);
    expect(r.summary.columnsAdded).toEqual(['phone']);
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 0 });
  });

  it('removed column → reported', () => {
    const r = run(`id,name,phone\n1,A,5\n2,B,6`, `id,name\n1,A\n2,B`);
    expect(r.summary.columnsRemoved).toEqual(['phone']);
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'name', 'phone']);
  });

  it('leading zeros are text', () => {
    const r = run(`id,zip\n1,07030`, `id,zip\n1,7030`, { key: ['id'] });
    expect(r.summary.modified).toBe(1);
  });

  it('number formatting: changed by default, equal with numeric toggle', () => {
    const b = `id,amt\n1,"1,000.00"`;
    const a = `id,amt\n1,1000`;
    expect(run(b, a, { key: ['id'] }).summary.modified).toBe(1);
    const r = run(b, a, { key: ['id'], normalize: { trim: true, ignoreCase: false, numeric: true, nullEqual: false } });
    expect(r.summary.modified).toBe(0);
  });

  it('formatting hint fires when most changes are formatting', () => {
    const r = run(`id,amt\n1,"1,000.00"\n2,ACME`, `id,amt\n1,1000\n2,acme`, { key: ['id'] });
    expect(r.summary.looksLikeFormatting).toBe(true);
  });

  it('whitespace equal with trim on (default), changed with trim off', () => {
    expect(run(`id,co\n1,"Acme "`, `id,co\n1,Acme`, { key: ['id'] }).summary.modified).toBe(0);
    const off = run(`id,co\n1,"Acme "`, `id,co\n1,Acme`, {
      key: ['id'],
      normalize: { trim: false, ignoreCase: false, numeric: false, nullEqual: false },
    });
    expect(off.summary.modified).toBe(1);
  });

  it('ignore case and null-like toggles', () => {
    const n = { trim: true, ignoreCase: true, numeric: false, nullEqual: true };
    expect(run(`id,a,b\n1,ACME,NULL`, `id,a,b\n1,acme,`, { key: ['id'], normalize: n }).summary.modified).toBe(0);
  });

  it('encoding: Windows-1252 é equals UTF-8 é', async () => {
    const w1252 = new Uint8Array([...Buffer.from('id,name\n1,Caf'), 0xe9]);
    const utf8 = new TextEncoder().encode('id,name\n1,Café');
    const b = await parseFile(w1252, 'b.csv');
    const a = await parseFile(utf8, 'a.csv');
    expect(b.meta.encoding).toBe('Windows-1252');
    expect(diffTables(b, a, { key: ['id'] }).summary.modified).toBe(0);
  });

  it('BOM on first header still matches id', async () => {
    const t = await parseFile(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('id,x\n1,2')]), 'b.csv');
    expect(t.headers[0]).toBe('id');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).encoding).toBe('UTF-8 (BOM)');
  });

  it('semicolon vs comma delimiters', () => {
    const b = csv(`id;name;city\n1;Ada;London\n2;Bob;Paris`);
    const a = csv(`id,name,city\n1,Ada,London\n2,Bob,Berlin`);
    expect(b.meta.delimiter).toBe(';');
    const r = diffTables(b, a, { key: ['id'] });
    expect(r.summary.modified).toBe(1);
  });

  it('pipe and tab delimiters', () => {
    expect(csv(`a|b|c\n1|2|3`).headers).toEqual(['a', 'b', 'c']);
    expect(csv(`a\tb\tc\n1\t2\t3`).headers).toEqual(['a', 'b', 'c']);
  });

  it('quoted newlines are one cell', () => {
    const t = csv(`id,address\n1,"12 Main St\nApt 4"\n2,x`);
    expect(t.rowCount).toBe(2);
    expect(t.columns[1][0]).toBe('12 Main St\nApt 4');
  });

  it('duplicate keys are listed, not matched', () => {
    const r = run(`id,name\n42,A\n42,B\n1,C`, `id,name\n42,A\n1,C`, { key: ['id'] });
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ key: '42', beforeRows: [0, 1], afterRows: [0] });
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 0 });
    expect(r.summary.unmatchable).toBe(3);
  });

  it('empty key values lower confidence', () => {
    const b = csv(`email,name\na@x,A\n,B\nc@x,C\nd@x,D\ne@x,E`);
    const a = csv(`email,name\na@x,A\n,B\nc@x,C\nd@x,D\ne@x,E`);
    const d = detectKey(b, a);
    expect(d.confidence).toBe('low');
    expect(d.reason).toMatch(/email/);
  });

  it('ragged rows → padded with warning', () => {
    const t = csv(`a,b,c\n1,2\n4,5,6`);
    expect(t.columns[2][0]).toBe('');
    expect(t.warnings.length).toBe(1);
  });

  it('keyless edit → one modified row, not delete + add', () => {
    const b = `name,city,team\nAda,London,A\nAda,London,A\nBob,Paris,B\nCy,Rome,C`;
    const a = `name,city,team\nAda,London,A\nAda,London,A\nBob,Lyon,B\nCy,Rome,C`;
    const r = run(b, a, { key: null });
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 1 });
    const op = r.ops.find((o) => o.type === 'modified')!;
    expect(op.changed!.map((c) => r.columns[c].name)).toEqual(['city']);
  });

  it('header-only After → all rows deleted', () => {
    const r = run(BASE, `id,name,email,city\n`);
    expect(counts(r)).toEqual({ added: 0, deleted: 4, modified: 0 });
  });

  it('different headers entirely → warning', () => {
    const r = run(`a,b\n1,2`, `c,d\n3,4`);
    expect(r.warnings.join(' ')).toMatch(/share no columns/);
    expect(counts(r)).toEqual({ added: 1, deleted: 1, modified: 0 });
  });

  it('composite key', () => {
    const b = `first,last,age\nA,X,1\nA,Y,2\nB,X,3`;
    const a = `first,last,age\nA,Y,20\nB,X,3\nA,X,1\nC,Z,9`;
    const r = run(b, a, { key: ['first', 'last'] });
    expect(counts(r)).toEqual({ added: 1, deleted: 0, modified: 1 });
  });

  it('deleted rows stay near their old neighbours', () => {
    const r = run(BASE, `id,name,email,city\n1,Ada,ada@x.com,London\n3,Cy,cy@x.com,Rome\n4,Di,di@x.com,Oslo`);
    expect(r.ops.map((o) => o.type[0] + (o.b >= 0 ? o.b : o.a))).toEqual(['u0', 'd1', 'u2', 'u3']);
  });

  it('net change for numeric columns', () => {
    const r = run(`id,amt\n1,100\n2,50`, `id,amt\n1,120\n3,5`, { key: ['id'] });
    expect(r.summary.perColumn.find((c) => c.column === 'amt')!.netChange).toBe(-25);
  });
});

describe('key detection', () => {
  it('prefers id-like names', () => {
    const d = detectKey(csv(BASE), csv(BASE));
    expect(d).toMatchObject({ key: 'id', confidence: 'high' });
  });
  it('ignores row-number columns', () => {
    const t = csv(`row,email,name\n1,a@x,A\n2,b@x,B\n3,c@x,C`);
    expect(detectKey(t, t).key).toBe('email');
  });
  it('no unique column → none', () => {
    const t = csv(`name,city\nA,X\nA,X`);
    expect(detectKey(t, t).confidence).toBe('none');
  });
});

describe('numbers', () => {
  it('parses common formats', () => {
    expect(parseNumber('1,000.00')).toBe(1000);
    expect(parseNumber('$1,234')).toBe(1234);
    expect(parseNumber('(500)')).toBe(-500);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('12,34')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('07030')).toBe(7030);
  });
});

// ---------------------------------------------------------------- property tests

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function randomTable(rand: () => number, rows: number, withId: boolean): string[][] {
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = [String(Math.floor(rand() * 4)), ['x', 'y', 'z'][Math.floor(rand() * 3)], String(Math.floor(rand() * 3))];
    out.push(withId ? [`k${r}`, ...row] : row);
  }
  return out;
}

function mutate(rand: () => number, rows: string[][], withId: boolean): string[][] {
  const out = rows.map((r) => [...r]);
  let next = rows.length;
  const steps = Math.floor(rand() * 8);
  for (let s = 0; s < steps; s++) {
    const p = Math.floor(rand() * (out.length + 1));
    const kind = rand();
    if (kind < 0.33 && out.length) out.splice(Math.min(p, out.length - 1), 1);
    else if (kind < 0.66) {
      const row = [String(Math.floor(rand() * 4)), 'w', String(Math.floor(rand() * 3))];
      out.splice(p, 0, withId ? [`k${next++}`, ...row] : row);
    } else if (out.length) {
      const r = out[Math.min(p, out.length - 1)];
      r[r.length - 1] = String(Number(r[r.length - 1]) + 10);
    }
  }
  if (withId && rand() < 0.3) out.reverse();
  return out;
}

const toTable = (headers: string[], rows: string[][]): Table =>
  parseDelimited([headers, ...rows].map((r) => r.join(',')).join('\n'));

/** Rebuild After from Before plus the diff, in the diff's order. */
function applyDiff(before: Table, after: Table, r: DiffResult): string[][] {
  const rows: string[][] = [];
  for (const op of r.ops) {
    if (op.type === 'deleted') continue;
    if (op.type === 'added') {
      rows.push(after.headers.map((_, c) => after.columns[c][op.a]));
      continue;
    }
    const row = after.headers.map((h) => before.columns[before.headers.indexOf(h)][op.b]);
    for (const ci of op.changed ?? []) {
      const col = r.columns[ci];
      row[col.ai] = after.columns[col.ai][op.a];
    }
    rows.push(row);
  }
  return rows;
}

describe('properties', () => {
  for (const withId of [true, false]) {
    it(`diff(x, x) is empty and apply(before, diff) = after (${withId ? 'keyed' : 'keyless'})`, () => {
      const rand = rng(withId ? 7 : 11);
      const headers = withId ? ['id', 'a', 'b', 'c'] : ['a', 'b', 'c'];
      for (let iter = 0; iter < 300; iter++) {
        const bRows = randomTable(rand, Math.floor(rand() * 25), withId);
        const aRows = mutate(rand, bRows, withId);
        const b = toTable(headers, bRows);
        const a = toTable(headers, aRows);
        const key = withId ? ['id'] : null;

        const self = diffTables(b, b, { key });
        expect(self.ops.every((o) => o.type === 'unchanged')).toBe(true);

        const r = diffTables(b, a, { key });
        const rebuilt = applyDiff(b, a, r);
        // Diffs list rows in After order, so the rebuild must match exactly.
        expect(rebuilt).toEqual(aRows);
        // Deterministic
        expect(diffTables(b, a, { key })).toMatchObject({ ops: r.ops });
      }
    });
  }

  it('myers produces a valid edit script', () => {
    const rand = rng(3);
    for (let i = 0; i < 300; i++) {
      const x = Array.from({ length: Math.floor(rand() * 30) }, () => Math.floor(rand() * 5));
      const y = Array.from({ length: Math.floor(rand() * 30) }, () => Math.floor(rand() * 5));
      const s = myersDiff(x, y, 1000)!;
      const rebuilt = s.filter((e) => e.t !== 'del').map((e) => (e.t === 'eq' ? x[e.b] : y[e.a]));
      expect(rebuilt).toEqual(y);
      expect(s.filter((e) => e.t !== 'ins').map((e) => e.b)).toEqual(x.map((_, i) => i));
    }
  });
});

describe('keyless move + edit', () => {
  it('an edited row that also moved is one modification', () => {
    const r = run(`name,city,team\nAda,London,A\nAda,London,A\nBob,Paris,B\nCy,Rome,C`, `name,city,team\nCy,Rome,C\nAda,London,A\nBob,Lyon,B\nAda,London,A`, { key: null });
    expect(counts(r)).toEqual({ added: 0, deleted: 0, modified: 1 });
    expect(r.summary.reordered).toBe(true);
  });
});
