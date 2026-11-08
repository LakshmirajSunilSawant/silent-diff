import type { WorkerRequest, WorkerResponse } from './core/protocol';

/** Promise wrapper around the diff worker. */
export class DiffWorker {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private pending = new Map<number, (r: WorkerResponse) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<{ id: number; res: WorkerResponse }>) => {
      const cb = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      cb?.(e.data.res);
    };
  }

  send<T extends WorkerResponse['type']>(req: WorkerRequest, transfer: Transferable[] = []): Promise<Extract<WorkerResponse, { type: T }>> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (res) => {
        if (res.type === 'error') reject(new Error(res.message));
        else resolve(res as Extract<WorkerResponse, { type: T }>);
      });
      this.worker.postMessage({ id, req }, transfer);
    });
  }
}
