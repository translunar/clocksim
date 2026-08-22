import { describe, it, expect } from 'vitest';
import { logTimes, drawInitial, runOne, Envelope, PERCENTILES } from '../../src/engine/montecarlo';
import { Prng } from '../../src/engine/prng';
import type { DeviceSpec } from '../../src/engine/bench';

const z = { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 };
const spec = (over: Partial<DeviceSpec>): DeviceSpec => ({ id: 'g', name: 'g', domain: 'gyro', states: 2, coefs: z, flickerMode: 'exact', gmTaus: [], thermal: null, source: 't', ...over });

describe('montecarlo', () => {
  it('logTimes is unique, increasing, multiples of dt, spans [dt, duration]', () => {
    const t = logTimes(0.5, 1000, 40);
    expect(t[0]).toBe(0.5);
    expect(t[t.length - 1]).toBe(1000);
    for (let i = 1; i < t.length; i++) { expect(t[i]!).toBeGreaterThan(t[i - 1]!); expect(Math.abs(t[i]! / 0.5 - Math.round(t[i]! / 0.5))).toBeLessThan(1e-9); }
  });
  it('drawInitial reproduces the covariance statistically', () => {
    const P = { p11: 4, p12: 1, p22: 1, p13: 0, p23: 0, p33: 0.25 };
    const p = new Prng(1); let s11 = 0, s12 = 0, s22 = 0, s33 = 0; const n = 50000;
    for (let i = 0; i < n; i++) { const [e, b, d] = drawInitial(P, p); s11 += e! * e!; s12 += e! * b!; s22 += b! * b!; s33 += d! * d!; }
    expect(s11 / n).toBeCloseTo(4, 1); expect(s12 / n).toBeCloseTo(1, 1); expect(s22 / n).toBeCloseTo(1, 1); expect(s33 / n).toBeCloseTo(0.25, 1);
  });
  it('pure white FM envelope grows like N sqrt(t) at the 68th percentile', () => {
    const req = { spec: spec({ coefs: { ...z, N: 1e-3 } }), dt: 1, duration: 1000, runs: 300, seed: 7, profile: { kind: 'none' as const }, includeThermal: false, fix: { sigma: 0, cadence: 1, bias: 0 }, driftKnowledge: null, Tm: 1000 };
    const times = logTimes(req.dt, req.duration, 16);
    const env = new Envelope(times);
    for (let r = 0; r < req.runs; r++) env.add(runOne(req, times, r));
    expect(env.runs).toBe(300);
    const p68 = env.percentile(PERCENTILES.p68);
    const last = times.length - 1;
    expect(p68[last]! / (1e-3 * Math.sqrt(times[last]!))).toBeGreaterThan(0.8);
    expect(p68[last]! / (1e-3 * Math.sqrt(times[last]!))).toBeLessThan(1.25);
  });
  it('3-state clock truth compensates the deterministic aging that models.ts also zeroes; 2-state truth carries it', () => {
    // Both use identical simulated y (bench.ts adds c.R unconditionally on states), so any
    // difference between the two envelopes below is purely runOne's aging subtraction.
    const R = 1e-12;
    const base = { dt: 1, duration: 1000, runs: 3, seed: 1, profile: { kind: 'none' as const }, includeThermal: false, fix: { sigma: 0, cadence: 1, bias: 0 }, driftKnowledge: null, Tm: 1000 };
    const times = Float64Array.from([1000]);

    const spec3 = spec({ domain: 'clock', states: 3, coefs: { ...z, R } });
    const env3 = new Envelope(times);
    for (let r = 0; r < base.runs; r++) env3.add(runOne({ ...base, spec: spec3 }, times, r));
    // Compensated: what's left is only the Euler-integration discretization of the subtraction
    // (the sim integrates R as a discrete Riemann sum; the compensation is the continuous
    // R*t^2/2), which is ~5e-10 here — three orders of magnitude below the uncompensated value.
    expect(env3.percentile(PERCENTILES.p68)[0]!).toBeLessThan(1e-8);

    const spec2 = spec({ domain: 'clock', states: 2, coefs: { ...z, R } });
    const env2 = new Envelope(times);
    for (let r = 0; r < base.runs; r++) env2.add(runOne({ ...base, spec: spec2 }, times, r));
    const analyticAging = R * 1000 * 1000 / 2;
    expect(env2.percentile(PERCENTILES.p68)[0]! / analyticAging).toBeCloseTo(1, 2);
  });

  it('pure flicker envelope grows roughly like B t (within the log factor)', () => {
    const req = { spec: spec({ coefs: { ...z, B: 1e-4 } }), dt: 1, duration: 2000, runs: 200, seed: 3, profile: { kind: 'none' as const }, includeThermal: false, fix: { sigma: 0, cadence: 1, bias: 0 }, driftKnowledge: null, Tm: 1000 };
    const times = logTimes(req.dt, req.duration, 16);
    const env = new Envelope(times);
    for (let r = 0; r < req.runs; r++) env.add(runOne(req, times, r));
    const p68 = env.percentile(PERCENTILES.p68);
    const i = times.length - 1;
    const ratio = p68[i]! / (1e-4 * times[i]!);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(2.5);
  });
});
