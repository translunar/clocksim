import { describe, it, expect } from 'vitest';
import { handleRequest } from '../../src/worker/handler';
import type { WorkerResponse } from '../../src/worker/protocol';
import type { DeviceSpec } from '../../src/engine/bench';

const z = { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 };
const g: DeviceSpec = { id: 'g', name: 'g', domain: 'gyro', states: 2, coefs: { ...z, N: 1e-3, B: 1e-5 }, flickerMode: 'exact', gmTaus: [], thermal: null, source: 't' };

describe('worker handler', () => {
  it('adev request returns deviation and analytic terms', async () => {
    const out: WorkerResponse[] = [];
    await handleRequest({ type: 'adev', id: 'a', spec: g, dt: 1, n: 4096, seed: 1, kind: 'adev', profile: { kind: 'none' }, includeThermal: false }, m => out.push(m));
    const done = out.find(m => m.type === 'adev')!;
    expect(done.type).toBe('adev');
    if (done.type === 'adev') { expect(done.tau.length).toBeGreaterThan(5); expect(done.analytic.N.length).toBe(done.tau.length); }
  });
  it('mc request streams progress then done, and honours cancel', async () => {
    const out: WorkerResponse[] = [];
    let cancelled = false;
    await handleRequest({ type: 'mc', id: 'm', req: { spec: g, dt: 1, duration: 100, runs: 30, seed: 1, profile: { kind: 'none' }, includeThermal: false, fix: { sigma: 1e-4, cadence: 1, bias: 0 }, driftKnowledge: null, Tm: 100 }, batch: 10 },
      m => { out.push(m); if (m.type === 'mc-progress' && m.runs >= 10) cancelled = true; }, () => cancelled);
    const prog = out.filter(m => m.type === 'mc-progress');
    expect(prog.length).toBeGreaterThanOrEqual(1);
    expect(out[out.length - 1]!.type).toBe('mc-done');
    const last = out[out.length - 1]!;
    if (last.type === 'mc-done') expect(last.runs).toBeLessThan(30);
  });
});
