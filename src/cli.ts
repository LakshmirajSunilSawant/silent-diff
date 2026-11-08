#!/usr/bin/env node
// Silent-Diff command line: same engine as the web app, output as JSON or a terminal table.
// Usage: npm run cli -- before.csv after.xlsx [--key id[,col2]] [--no-key] [--json] ...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { diffTables } from './core/diff';
import { detectKey } from './core/key';
import { describeNormalize } from './core/normalize';
import { parseFile } from './core/parse';
import { DEFAULT_NORMALIZE, type DiffOp, type DiffResult, type Table } from './core/types';

const HELP = `Silent-Diff: compare two CSV/TSV/XLSX files.

Usage: npm run cli -- <before> <after> [options]

Options:
  --key <cols>     Key column(s), comma-separated (up to 3). Default: auto-detect.
  --no-key         Align rows without a key.
  --json           Print the full diff as JSON.
  --limit <n>      Max changed rows to print in table mode (default 50, 0 = all).
  --no-trim        Do not trim whitespace.
  --ignore-case    Ignore letter case.
  --numeric        Compare numbers numerically (1,000.00 = 1000).
  --null-equal     Treat empty, NULL, N/A, - as equal.
  --dates          Compare dates by calendar day (2024-01-05 = 1/5/2024).
  --dmy            Read ambiguous dates as day/month/year (default month/day/year).
  --tolerance <n>  Numbers within n count as equal; add % for relative (e.g. 0.5%).
  --rename <a=b>   Treat Before column a and After column b as one column. Repeatable.
  --no-header      First row is data, not headers.
  -h, --help       Show this help.

Exit code: 0 when no differences, 1 when there are differences, 2 on error.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c(32, s);
const red = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const dim = (s: string) => c(2, s);

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return 0;
  }
  const files: string[] = [];
  const renames: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rename') renames.push(args[++i] ?? '');
    else if (a === '--key' || a === '--limit' || a === '--tolerance') flags.set(a, args[++i] ?? '');
    else if (a.startsWith('--')) flags.set(a, true);
    else files.push(a);
  }
  if (files.length !== 2) throw new Error('Give exactly two files: <before> <after>.');

  const hasHeader = !flags.has('--no-header');
  const load = (p: string) => parseFile(new Uint8Array(readFileSync(p)), basename(p), { hasHeader });
  const [before, after] = await Promise.all([load(files[0]), load(files[1])]);

  let key: string[] | null;
  let keyNote = '';
  if (flags.has('--no-key')) key = null;
  else if (typeof flags.get('--key') === 'string') key = String(flags.get('--key')).split(',').map((s) => s.trim()).filter(Boolean);
  else {
    const d = detectKey(before, after);
    key = d.key ? [d.key] : null;
    if (d.confidence === 'low') keyNote = `Low confidence in key: ${d.reason} Use --key or --no-key to choose.`;
  }

  const normalize = {
    ...DEFAULT_NORMALIZE,
    trim: !flags.has('--no-trim'),
    ignoreCase: flags.has('--ignore-case'),
    numeric: flags.has('--numeric'),
    nullEqual: flags.has('--null-equal'),
    dates: flags.has('--dates'),
    dateOrder: flags.has('--dmy') ? ('DMY' as const) : ('MDY' as const),
    ...parseTolerance(flags.get('--tolerance')),
  };
  const renameMap: Record<string, string> = {};
  for (const r of renames) {
    const [from, to] = r.split('=');
    if (!from || !to) throw new Error(`--rename expects before=after, got "${r}".`);
    renameMap[from.trim()] = to.trim();
  }
  const result = diffTables(before, after, { key, normalize, renames: renameMap });
  const s = result.summary;
  const differs = s.added + s.deleted + s.modified + s.columnsAdded.length + s.columnsRemoved.length > 0;

  if (flags.has('--json')) {
    console.log(JSON.stringify(toJson(result, before, after), null, 2));
    return differs ? 1 : 0;
  }

  const limitFlag = flags.get('--limit');
  const limit = typeof limitFlag === 'string' ? Number(limitFlag) : 50;
  printTable(result, before, after, limit, keyNote);
  return differs ? 1 : 0;
}

function parseTolerance(v: string | true | undefined): { tolerance: number; toleranceMode: 'abs' | 'pct' } {
  if (typeof v !== 'string' || !v) return { tolerance: 0, toleranceMode: 'abs' };
  const pct = v.trim().endsWith('%');
  const n = Number(v.replace('%', ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`--tolerance expects a number like 0.01 or 0.5%, got "${v}".`);
  return { tolerance: n, toleranceMode: pct ? 'pct' : 'abs' };
}

function rowRecord(t: Table, r: number): Record<string, string> {
  const out: Record<string, string> = {};
  t.headers.forEach((h, c) => (out[h] = t.columns[c][r]));
  return out;
}

function toJson(r: DiffResult, before: Table, after: Table) {
  return {
    before: before.meta,
    after: after.meta,
    mode: r.mode,
    key: r.key,
    normalize: r.normalize,
    summary: r.summary,
    warnings: [...r.warnings, ...before.warnings.map((w) => `Before: ${w}`), ...after.warnings.map((w) => `After: ${w}`)],
    duplicates: r.duplicates,
    approximate: r.approximate,
    changes: r.ops
      .filter((op) => op.type !== 'unchanged')
      .map((op) => {
        if (op.type === 'added') return { type: op.type, afterRow: op.a + 1, row: rowRecord(after, op.a) };
        if (op.type === 'deleted') return { type: op.type, beforeRow: op.b + 1, row: rowRecord(before, op.b) };
        return {
          type: op.type,
          beforeRow: op.b + 1,
          afterRow: op.a + 1,
          key: r.key ? Object.fromEntries(r.key.map((k) => [k, after.columns[after.headers.indexOf(k)][op.a]])) : undefined,
          cells: op.changed!.map((ci) => {
            const col = r.columns[ci];
            return { column: col.name, before: before.columns[col.bi][op.b], after: after.columns[col.ai][op.a] };
          }),
        };
      }),
  };
}

function label(r: DiffResult, op: DiffOp, before: Table, after: Table): string {
  if (r.key) {
    const t = op.a >= 0 ? after : before;
    const row = op.a >= 0 ? op.a : op.b;
    return r.key.map((k) => t.columns[t.headers.indexOf(k)][row]).join(' | ');
  }
  return op.a >= 0 ? `row ${op.a + 1}` : `row ${op.b + 1} (before)`;
}

function printTable(r: DiffResult, before: Table, after: Table, limit: number, keyNote: string) {
  const s = r.summary;
  console.log(`${before.meta.fileName} → ${after.meta.fileName}`);
  console.log(
    `${green(`+${s.added} added`)}, ${red(`−${s.deleted} deleted`)}, ${yellow(`~${s.modified} modified`)} rows` +
      (s.columnsAdded.length ? ` · ${green(`columns added: ${s.columnsAdded.join(', ')}`)}` : '') +
      (s.columnsRemoved.length ? ` · ${red(`columns removed: ${s.columnsRemoved.join(', ')}`)}` : '') +
      (s.reordered ? ' · rows reordered' : ''),
  );
  console.log(dim(`${s.unchanged} unchanged · ${r.key ? `matched by ${r.key.join(' + ')}` : 'aligned without a key'} · ${describeNormalize(r.normalize)} · ${r.elapsedMs} ms`));
  for (const w of [keyNote, ...r.warnings, ...before.warnings.map((x) => `Before: ${x}`), ...after.warnings.map((x) => `After: ${x}`)]) {
    if (w) console.log(yellow(`! ${w}`));
  }
  for (const sg of r.renameSuggestions) {
    console.log(yellow(`! Column "${sg.from}" looks renamed to "${sg.to}" (${Math.round(sg.similarity * 100)}% match). Use --rename "${sg.from}=${sg.to}".`));
  }
  if (r.duplicates.length) console.log(yellow(`! ${r.duplicates.length} duplicate key(s) not matched: ${r.duplicates.slice(0, 5).map((d) => d.key).join(', ')}${r.duplicates.length > 5 ? ', …' : ''}`));

  const changes = r.ops.filter((op) => op.type !== 'unchanged');
  if (!changes.length) {
    console.log(green('No differences found.'));
    return;
  }
  console.log('');
  const shown = limit > 0 ? changes.slice(0, limit) : changes;
  for (const op of shown) {
    const id = label(r, op, before, after);
    if (op.type === 'added') console.log(green(`+ ${id}`));
    else if (op.type === 'deleted') console.log(red(`− ${id}`));
    else {
      const cells = op.changed!.map((ci) => {
        const col = r.columns[ci];
        return `${col.name}: ${red(JSON.stringify(before.columns[col.bi][op.b]))} → ${green(JSON.stringify(after.columns[col.ai][op.a]))}`;
      });
      console.log(`${yellow('~')} ${id}  ${cells.join('; ')}`);
    }
  }
  if (shown.length < changes.length) console.log(dim(`… ${changes.length - shown.length} more (use --limit 0 to show all)`));
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  },
);
