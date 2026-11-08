import Papa from 'papaparse';
import type { Table, TableMeta } from './types';

export const MAX_BYTES = 200 * 1024 * 1024;
export const MAX_ROWS = 1_000_000;

export class LimitError extends Error {}

export interface ParseOptions {
  /** Treat the first row as column headers. Default true. */
  hasHeader?: boolean;
}

/** Decode bytes as UTF-8 (with or without BOM), UTF-16 with BOM, or Windows-1252 as a fallback. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16 LE' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16 BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

function formatOf(fileName: string, bytes: Uint8Array): TableMeta['format'] {
  // XLSX files are zip archives: they start with "PK\x03\x04".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'xlsx';
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  return 'csv';
}

export async function parseFile(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  opts: ParseOptions = {},
): Promise<Table> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_BYTES) {
    throw new LimitError(
      `${fileName} is ${(bytes.byteLength / 1024 / 1024).toFixed(0)} MB. Silent-Diff handles files up to 200 MB in the browser; use the command-line version for bigger files.`,
    );
  }
  const format = formatOf(fileName, bytes);
  if (format === 'xlsx') {
    const { rows, sheetName } = await readXlsx(bytes);
    return buildTable(rows, { fileName, format, sheetName }, opts);
  }
  const { text, encoding } = decodeText(bytes);
  return parseDelimited(text, fileName, opts, format, encoding);
}

export function parseDelimited(
  text: string,
  fileName = 'file.csv',
  opts: ParseOptions = {},
  format: 'csv' | 'tsv' = 'csv',
  encoding = 'UTF-8',
): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const result = Papa.parse<string[]>(text, {
    delimiter: format === 'tsv' ? '\t' : '',
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const delimiter = result.meta.delimiter;
  const table = buildTable(result.data, { fileName, format, delimiter, encoding }, opts);
  const bad = result.errors.filter((e) => e.type === 'Quotes');
  if (bad.length) table.warnings.push(`${bad.length} row(s) have unbalanced quotes; parsing may be off near row ${bad[0].row! + 1}.`);
  return table;
}

async function readXlsx(bytes: Uint8Array): Promise<{ rows: string[][]; sheetName: string }> {
  const XLSX = await import('xlsx');
  // cellFormula: false → read the cached cell values, not formulas.
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], sheetName: '' };
  const ws = wb.Sheets[sheetName];
  // raw: false → the formatted text the user sees in Excel, so 07030 stays 07030.
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
  return { rows: rows.map((r) => r.map((v) => (v == null ? '' : String(v)))), sheetName };
}

/** Turn row arrays into a columnar Table, fixing up headers and ragged rows. */
export function buildTable(rows: string[][], meta: TableMeta, opts: ParseOptions = {}): Table {
  const hasHeader = opts.hasHeader !== false;
  const warnings: string[] = [];
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const headerRow = hasHeader && rows.length ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  if (body.length > MAX_ROWS) {
    throw new LimitError(
      `${meta.fileName} has ${body.length.toLocaleString()} rows. Silent-Diff handles up to 1,000,000 rows in the browser; use the command-line version for bigger files.`,
    );
  }

  const headers = uniqueHeaders(
    Array.from({ length: width }, (_, i) => (hasHeader ? (headerRow[i] ?? '').trim() : '')),
  );
  if (hasHeader && width > headerRow.length && rows.length) {
    warnings.push(`Some rows have more cells than the header; extra columns were named ${headers.slice(headerRow.length).join(', ')}.`);
  }

  const columns: string[][] = headers.map(() => new Array<string>(body.length));
  let short = 0;
  for (let r = 0; r < body.length; r++) {
    const row = body[r];
    if (row.length < width) short++;
    for (let c = 0; c < width; c++) columns[c][r] = row[c] ?? '';
  }
  if (short) warnings.push(`${short.toLocaleString()} row(s) have fewer cells than the header; missing cells were treated as empty.`);

  return { headers, columns, rowCount: body.length, warnings, meta };
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    const n = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return name;
  });
}
