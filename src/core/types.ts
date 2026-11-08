/** A parsed file, stored column-wise. Every value is kept as text so leading zeros survive. */
export interface Table {
  headers: string[];
  /** columns[c][r] is the value of column c in row r. */
  columns: string[][];
  rowCount: number;
  warnings: string[];
  meta: TableMeta;
}

export interface TableMeta {
  fileName: string;
  format: 'csv' | 'tsv' | 'xlsx';
  delimiter?: string;
  encoding?: string;
  sheetName?: string;
}

export interface NormalizeOptions {
  /** Trim leading and trailing whitespace. On by default. */
  trim: boolean;
  ignoreCase: boolean;
  /** Compare values that look like numbers by numeric value, so 1,000.00 equals 1000. */
  numeric: boolean;
  /** Treat empty, null, NULL, N/A, NaN, None, nil and - as the same value. */
  nullEqual: boolean;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = {
  trim: true,
  ignoreCase: false,
  numeric: false,
  nullEqual: false,
};

export type ColumnStatus = 'both' | 'added' | 'removed';

/** One column of the diff view, the union of both files' columns, matched by header name. */
export interface DiffColumn {
  name: string;
  status: ColumnStatus;
  /** Column index in Before, or -1. */
  bi: number;
  /** Column index in After, or -1. */
  ai: number;
}

export type OpType = 'added' | 'deleted' | 'modified' | 'unchanged';

export interface DiffOp {
  type: OpType;
  /** Row index in Before, or -1 for added rows. */
  b: number;
  /** Row index in After, or -1 for deleted rows. */
  a: number;
  /** Indices into DiffResult.columns of cells that changed (modified rows only). */
  changed?: number[];
}

export interface KeyCandidate {
  column: string;
  score: number;
  /** Share of non-empty values (worst of the two files). */
  filled: number;
  /** Share of unique values among non-empty ones (worst of the two files). */
  unique: number;
  /** Share of key values found in both files. */
  overlap: number;
}

export interface KeyDetection {
  /** Best key, or null when no column is a usable key. */
  key: string | null;
  confidence: 'high' | 'low' | 'none';
  reason: string;
  candidates: KeyCandidate[];
}

export interface DuplicateKey {
  key: string;
  beforeRows: number[];
  afterRows: number[];
}

export interface ColumnStat {
  column: string;
  changed: number;
  /** Sum(After) − Sum(Before), for columns that are mostly numeric. */
  netChange?: number;
}

export interface DiffSummary {
  added: number;
  deleted: number;
  modified: number;
  unchanged: number;
  columnsAdded: string[];
  columnsRemoved: string[];
  reordered: boolean;
  /** Rows that could not be matched because their key is duplicated or empty. */
  unmatchable: number;
  perColumn: ColumnStat[];
  /** True when most changed cells would vanish with all normalizations on. */
  looksLikeFormatting: boolean;
}

export interface DiffResult {
  mode: 'keyed' | 'keyless';
  key: string[] | null;
  columns: DiffColumn[];
  ops: DiffOp[];
  summary: DiffSummary;
  duplicates: DuplicateKey[];
  /** Rows with an empty key value. */
  emptyKeys: { beforeRows: number[]; afterRows: number[] };
  /** Keyless alignment hit its size cap and fell back to a set comparison. */
  approximate: boolean;
  warnings: string[];
  normalize: NormalizeOptions;
  elapsedMs: number;
}
