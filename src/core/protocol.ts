import type { DiffResult, KeyDetection, NormalizeOptions, Table } from './types';

export type Side = 'before' | 'after';

export type WorkerRequest =
  | { type: 'parse'; side: Side; name: string; buffer: ArrayBuffer; hasHeader: boolean }
  | { type: 'reparse'; hasHeader: boolean }
  | { type: 'swap' }
  | { type: 'clear'; side: Side }
  | { type: 'detect' }
  | { type: 'diff'; key: string[] | null; normalize: NormalizeOptions; renames: Record<string, string> };

export type WorkerResponse =
  | { type: 'parsed'; side: Side; table: Table }
  | { type: 'reparsed'; before?: Table; after?: Table }
  | { type: 'ok' }
  | { type: 'detected'; detection: KeyDetection }
  | { type: 'diffed'; result: DiffResult }
  | { type: 'error'; message: string };
