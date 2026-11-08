/// <reference lib="webworker" />
// Parsing, key detection, normalization and alignment run here so the page never freezes.
import { diffTables } from './core/diff';
import { detectKey } from './core/key';
import { parseFile } from './core/parse';
import type { Side, WorkerRequest, WorkerResponse } from './core/protocol';
import type { Table } from './core/types';

const files: Partial<Record<Side, { name: string; bytes: Uint8Array; table: Table }>> = {};

async function handle(req: WorkerRequest): Promise<WorkerResponse> {
  switch (req.type) {
    case 'parse': {
      const bytes = new Uint8Array(req.buffer);
      const table = await parseFile(bytes, req.name, { hasHeader: req.hasHeader });
      files[req.side] = { name: req.name, bytes, table };
      return { type: 'parsed', side: req.side, table };
    }
    case 'reparse': {
      const out: { before?: Table; after?: Table } = {};
      for (const side of ['before', 'after'] as const) {
        const f = files[side];
        if (!f) continue;
        f.table = await parseFile(f.bytes, f.name, { hasHeader: req.hasHeader });
        out[side] = f.table;
      }
      return { type: 'reparsed', ...out };
    }
    case 'swap': {
      [files.before, files.after] = [files.after, files.before];
      return { type: 'ok' };
    }
    case 'clear': {
      delete files[req.side];
      return { type: 'ok' };
    }
    case 'detect': {
      if (!files.before || !files.after) throw new Error('Both files are needed.');
      return { type: 'detected', detection: detectKey(files.before.table, files.after.table) };
    }
    case 'diff': {
      if (!files.before || !files.after) throw new Error('Both files are needed.');
      const result = diffTables(files.before.table, files.after.table, { key: req.key, normalize: req.normalize });
      return { type: 'diffed', result };
    }
  }
}

// Handle requests strictly in order, so a diff never runs against a half-parsed file.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = e.data;
  queue = queue.then(async () => {
    let res: WorkerResponse;
    try {
      res = await handle(req);
    } catch (err) {
      res = { type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, res });
  });
};
