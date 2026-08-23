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
  it('compare request returns three device curves plus a measured curve with 68% bounds (spec §9.10)', async () => {
    const out: WorkerResponse[] = [];
    const o: DeviceSpec = { ...g, id: 'o', name: 'o', domain: 'clock', coefs: { ...z, N: 1e-11, B: 1e-12 } };
    const a: DeviceSpec = { ...o, id: 'a', name: 'a' }, b: DeviceSpec = { ...o, id: 'b', name: 'b' };
    await handleRequest({ type: 'compare', id: 'c', dut: a, ref: b, osc: o, leak: 0, floorQ: 1e-12, dt: 1, n: 4096, seed: 1, kind: 'adev' }, m => out.push(m));
    const done = out.find(m => m.type === 'compare')!;
    expect(done).toBeDefined();
    if (done.type !== 'compare') throw new Error('expected compare');
    for (const k of ['dut', 'ref', 'osc', 'measured', 'lo', 'hi'] as const) {
      expect(done[k], k).toBeInstanceOf(Float64Array);
      expect(done[k].length, k).toBe(done.tau.length);
    }
    // The bounds belong to the measured curve and bracket it point for point.
    for (let i = 0; i < done.tau.length; i++) {
      expect(done.lo[i]!).toBeLessThanOrEqual(done.measured[i]!);
      expect(done.hi[i]!).toBeGreaterThanOrEqual(done.measured[i]!);
    }
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
  it('mc responses carry a trajectory subsample for spaghetti (spec §9.7)', async () => {
    const messages: WorkerResponse[] = [];
    const req = { spec: g, dt: 1, duration: 100, runs: 30, seed: 1, profile: { kind: 'none' as const }, includeThermal: false, fix: { sigma: 1e-4, cadence: 1, bias: 0 }, driftKnowledge: null, Tm: 100 };
    await handleRequest({ type: 'mc', id: 'x', req, batch: 10 }, m => messages.push(m));
    const done = messages.find(m => m.type === 'mc-done')!;
    if (done.type !== 'mc-done') throw new Error('expected mc-done');
    expect(done.sample.length).toBe(25);
    for (const t of done.sample) {
      expect(t).toBeInstanceOf(Float64Array);
      expect(t.length).toBe(done.times.length);
    }
    expect(done.p50).toBeInstanceOf(Float64Array);
    expect(done.p50.length).toBe(done.times.length);
    for (let i = 0; i < done.times.length; i++) expect(done.p50[i]!).toBeLessThanOrEqual(done.p997[i]!);
  });
  it('subsample is capped by runs when runs < 25', async () => {
    const messages: WorkerResponse[] = [];
    const req = { spec: g, dt: 1, duration: 100, runs: 5, seed: 1, profile: { kind: 'none' as const }, includeThermal: false, fix: { sigma: 1e-4, cadence: 1, bias: 0 }, driftKnowledge: null, Tm: 100 };
    await handleRequest({ type: 'mc', id: 'x', req, batch: 10 }, m => messages.push(m));
    const done = messages.find(m => m.type === 'mc-done')!;
    if (done.type !== 'mc-done') throw new Error('expected mc-done');
    expect(done.sample.length).toBe(5);
  });
});
