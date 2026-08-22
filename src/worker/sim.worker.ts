import type { WorkerRequest, WorkerResponse } from './protocol';
import { handleRequest } from './handler';

const cancelled = new Set<string>();
const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') { cancelled.add(msg.id); return; }
  void handleRequest(msg, post, () => cancelled.has(msg.id)).then(() => cancelled.delete(msg.id));
};
