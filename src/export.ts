import Papa from 'papaparse';
import type { DiffColumn, DiffOp, DiffResult, Table } from './core/types';
import { describeNormalize } from './core/normalize';

export type Palette = 'default' | 'colorblind';

const LABEL: Record<DiffOp['type'], string> = { added: '+ added', deleted: '− deleted', modified: '~ modified', unchanged: 'unchanged' };

/** Value shown for a cell: After for added/kept rows, Before for deleted rows and removed columns. */
export function cellValue(col: DiffColumn, op: DiffOp, before: Table, after: Table): string {
  if (op.type === 'deleted' || col.ai < 0) return col.bi >= 0 && op.b >= 0 ? before.columns[col.bi][op.b] : '';
  return col.ai >= 0 && op.a >= 0 ? after.columns[col.ai][op.a] : '';
}

export function oldValue(col: DiffColumn, op: DiffOp, before: Table): string {
  return col.bi >= 0 && op.b >= 0 ? before.columns[col.bi][op.b] : '';
}

export function summaryLine(r: DiffResult): string {
  const s = r.summary;
  const parts = [`${s.added.toLocaleString()} added`, `${s.deleted.toLocaleString()} deleted`, `${s.modified.toLocaleString()} modified`];
  let line = `${parts.join(', ')} rows`;
  if (s.columnsAdded.length) line += ` · ${s.columnsAdded.length} column${s.columnsAdded.length > 1 ? 's' : ''} added (${s.columnsAdded.join(', ')})`;
  if (s.columnsRemoved.length) line += ` · ${s.columnsRemoved.length} column${s.columnsRemoved.length > 1 ? 's' : ''} removed (${s.columnsRemoved.join(', ')})`;
  if (s.reordered) line += ' · rows reordered';
  return line;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(before: Table, after: Table) {
  const strip = (n: string) => n.replace(/\.[^.]+$/, '');
  return `diff_${strip(before.meta.fileName)}_vs_${strip(after.meta.fileName)}`.replace(/[^\w.-]+/g, '_');
}

export function exportCsv(r: DiffResult, before: Table, after: Table) {
  const header = ['_change', '_changed_columns', ...r.columns.map((c) => c.name)];
  const rows = r.ops.map((op) => [
    op.type,
    (op.changed ?? []).map((ci) => r.columns[ci].name).join('; '),
    ...r.columns.map((c) => cellValue(c, op, before, after)),
  ]);
  const text = Papa.unparse([header, ...rows]);
  // BOM so Excel opens UTF-8 correctly.
  download(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), baseName(before, after) + '.csv');
}

export async function exportXlsx(r: DiffResult, before: Table, after: Table, palette: Palette) {
  const ExcelJS = (await import('exceljs')).default;
  const colors =
    palette === 'colorblind'
      ? { add: 'FFBDD7EE', addFont: 'FF1F4E79', del: 'FFF8CBAD', delFont: 'FF843C0C', mod: 'FFFFEB9C', modFont: 'FF7F6000' }
      : { add: 'FFC6EFCE', addFont: 'FF006100', del: 'FFFFC7CE', delFont: 'FF9C0006', mod: 'FFFFEB9C', modFont: 'FF9C5700' };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Silent-Diff';
  wb.created = new Date();

  // ---- Summary sheet
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 28 }, { width: 60 }];
  const s = r.summary;
  const rows: [string, string | number][] = [
    ['Before', before.meta.fileName],
    ['After', after.meta.fileName],
    ['Summary', summaryLine(r)],
    ['Rows added', s.added],
    ['Rows deleted', s.deleted],
    ['Rows modified', s.modified],
    ['Rows unchanged', s.unchanged],
    ['Columns added', s.columnsAdded.join(', ') || '—'],
    ['Columns removed', s.columnsRemoved.join(', ') || '—'],
    ['Matched rows by', r.key ? r.key.join(' + ') : 'row alignment (no key)'],
    ['Normalization', describeNormalize(r.normalize)],
  ];
  const renamed = r.columns.filter((c) => c.renamedFrom);
  if (renamed.length) rows.push(['Renamed columns', renamed.map((c) => `${c.renamedFrom} → ${c.name}`).join(', ')]);
  if (s.unmatchable) rows.push(['Rows not matched (duplicate or empty key)', s.unmatchable]);
  if (r.approximate) rows.push(['Note', 'Large keyless diff: alignment is approximate']);
  const title = sum.addRow(['Silent-Diff report']);
  title.font = { bold: true, size: 14 };
  sum.addRow([]);
  rows.forEach((row) => {
    const added = sum.addRow(row);
    added.getCell(1).font = { bold: true };
  });
  sum.addRow([]);
  const h = sum.addRow(['Column', 'Changed cells', 'Net change']);
  h.font = { bold: true };
  sum.getColumn(3).width = 16;
  for (const c of s.perColumn) sum.addRow([c.column, c.changed, c.netChange ?? '']);

  // ---- Diff sheet
  const ws = wb.addWorksheet('Diff', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ws.columns = [{ header: 'Change', width: 14 }, ...r.columns.map((c) => ({ header: c.name, width: Math.min(40, Math.max(10, c.name.length + 4)) }))];
  const head = ws.getRow(1);
  head.font = { bold: true };
  r.columns.forEach((c, i) => {
    const cell = head.getCell(i + 2);
    if (c.status === 'added') {
      cell.fill = fill(colors.add);
      cell.value = `${c.name} (new column)`;
    } else if (c.status === 'removed') {
      cell.fill = fill(colors.del);
      cell.value = `${c.name} (removed column)`;
    } else if (c.renamedFrom) {
      cell.value = `${c.name} (was ${c.renamedFrom})`;
    }
  });

  for (const op of r.ops) {
    const row = ws.addRow([LABEL[op.type], ...r.columns.map((c) => cellValue(c, op, before, after))]);
    if (op.type === 'added') {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = fill(colors.add);
        cell.font = { color: { argb: colors.addFont } };
      });
    } else if (op.type === 'deleted') {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = fill(colors.del);
        cell.font = { color: { argb: colors.delFont }, strike: true };
      });
    } else if (op.type === 'modified') {
      row.getCell(1).font = { color: { argb: colors.modFont }, bold: true };
      for (const ci of op.changed!) {
        const cell = row.getCell(ci + 2);
        cell.fill = fill(colors.mod);
        cell.font = { color: { argb: colors.modFont } };
        cell.note = `Was: ${oldValue(r.columns[ci], op, before) || '(empty)'}`;
      }
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: r.columns.length + 1 } };

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), baseName(before, after) + '.xlsx');
}
