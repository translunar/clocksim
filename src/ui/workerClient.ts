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
