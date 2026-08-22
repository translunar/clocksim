import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

export class SimClient {
  private worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  private handlers = new Map<string, (m: WorkerResponse) => void>();
  private counter = 0;
  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const h = this.handlers.get(ev.data.id);
      if (h) { h(ev.data); if (ev.data.type !== 'mc-progress') this.handlers.delete(ev.data.id); }
    };
    // If the worker chunk fails to load or a message can't be deserialized, every pending view
    // would otherwise hang forever on "simulating…" with no diagnostic (Minor 2). Fail every
    // outstanding request with an error response and clear the map so future requests start clean.
    this.worker.onerror = (ev: ErrorEvent) => this.failAll(ev.message || 'Worker error');
    this.worker.onmessageerror = () => this.failAll('Worker response could not be deserialized');
  }
  private failAll(message: string): void {
    for (const [id, h] of this.handlers) h({ type: 'error', id, message });
    this.handlers.clear();
  }
  nextId(): string { return 'req' + (++this.counter); }
  request(msg: Exclude<WorkerRequest, { type: 'cancel' }>, onMessage: (m: WorkerResponse) => void): string {
    this.handlers.set(msg.id, onMessage);
    this.worker.postMessage(msg);
    return msg.id;
  }
  cancel(id: string): void { this.worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest); this.handlers.delete(id); }
  destroy(): void { this.worker.terminate(); this.handlers.clear(); }
}
