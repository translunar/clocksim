import { describe, it, expect } from 'vitest';
import { Prng } from '../../src/engine/prng';
import { simulate, simulateRate, comparePhase, errorLevel, type DeviceSpec } from '../../src/engine/bench';
import { frequencyToPhase, oadev } from '../../src/engine/deviations';

const base = (over: Partial<DeviceSpec>): DeviceSpec => ({
  id: 'x', name: 'x', domain: 'gyro', states: 2,
  coefs: { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 }, flickerMode: 'exact', gmTaus: [10, 100, 1000], thermal: null, source: 'test', ...over,
});
const opts = (n: number, dt = 1) => ({ dt, n, profile: { kind: 'none' as const }, includeThermal: true, initial: [0, 0, 0] });

function varianceOf(x: Float64Array) { let m = 0; for (const v of x) m += v; m /= x.length; let s = 0; for (const v of x) s += (v - m) ** 2; return s / x.length; }

describe('bench', () => {
  it('errorLevel', () => { expect(errorLevel('gyro')).toBe(1); expect(errorLevel('clock')).toBe(1); expect(errorLevel('accel')).toBe(2); });

  it('white FM only: ADEV of simulated rate follows N/sqrt(tau)', () => {
    const spec = base({ coefs: { Q: 0, F: 0, N: 0.01, B: 0, K: 0, D: 0, R: 0 } });
    const y = simulateRate(spec, opts(1 << 16), new Prng(1));
    const x = frequencyToPhase(y, 1);
    const r = oadev(x, 1, [1, 10, 100]);
    expect(r.dev[0]).toBeCloseTo(0.01, 3);
    expect(r.dev[2]! / r.dev[0]!).toBeCloseTo(0.1, 1);
  });

  it('flicker only: ADEV is flat near 0.664 B', () => {
    const spec = base({ coefs: { Q: 0, F: 0, N: 0, B: 0.02, K: 0, D: 0, R: 0 } });
    const y = simulateRate(spec, opts(1 << 16), new Prng(2));
    const r = oadev(frequencyToPhase(y, 1), 1, [4, 32, 256]);
    for (const d of r.dev) { expect(d / (0.664 * 0.02)).toBeGreaterThan(0.8); expect(d / (0.664 * 0.02)).toBeLessThan(1.25); }
  });

  it('RW FM only: ADEV grows as K sqrt(tau/3)', () => {
    const spec = base({ coefs: { Q: 0, F: 0, N: 0, B: 0, K: 1e-3, D: 0, R: 0 } });
    const y = simulateRate(spec, opts(1 << 16), new Prng(3));
    const r = oadev(frequencyToPhase(y, 1), 1, [10, 100]);
    expect(r.dev[1]! / r.dev[0]!).toBeCloseTo(Math.sqrt(10), 0);
    expect(r.dev[0]! / (1e-3 * Math.sqrt(10 / 3))).toBeGreaterThan(0.7);
  });

  it('drift and initial bias are deterministic in y', () => {
    const spec = base({ coefs: { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 2 } });
    const res = simulate(spec, { ...opts(4), initial: [0.5, 0.25, 0] }, new Prng(4));
    expect(Array.from(res.y)).toEqual([0.25, 2.25, 4.25, 6.25]);   // bias0 + R t
    expect(res.error[0]).toBeCloseTo(0.5, 12);                        // err0
    expect(res.error[3]).toBeCloseTo(0.5 + 0.25 * 3 + 2 * (0 + 1 + 2), 12); // trapezoid-free left Riemann
  });

  it('thermal adds tempco * T_dev to y and can be excluded', () => {
    const spec = base({ thermal: { tempco: 0.1, tauTh: 0 } });
    const o = { ...opts(3), profile: { kind: 'ramp' as const, rate: 1 } };
    const on = simulate(spec, o, new Prng(5));
    const off = simulate(spec, { ...o, includeThermal: false }, new Prng(5));
    expect(Array.from(on.y)).toEqual([0, 0.1, 0.2]);
    expect(Array.from(off.y)).toEqual([0, 0, 0]);
    expect(on.thermalRate && Array.from(on.thermalRate)).toEqual([0, 0.1, 0.2]);
  });

  it('accel integrates twice', () => {
    const spec = base({ domain: 'accel', states: 3, coefs: { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 } });
    const res = simulate(spec, { ...opts(4), initial: [1, 2, 3] }, new Prng(6)); // pos0=1, vel0=2, abias=3
    // y = 3 each step; v = 2 + 3 t; p = 1 + ∫ v
    expect(Array.from(res.y)).toEqual([3, 3, 3, 3]);
    expect(res.error[0]).toBe(1);
    expect(res.error[1]).toBeCloseTo(1 + 2, 12);
    expect(res.error[2]).toBeCloseTo(1 + 2 + 5, 12);
  });

  it('white PM only: phase is bounded with variance Q^2', () => {
    const spec = base({ domain: 'clock', coefs: { Q: 2e-9, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 } });
    const res = simulate(spec, opts(20000, 0.1), new Prng(7));
    expect(Math.sqrt(varianceOf(res.error))).toBeCloseTo(2e-9, 10);
  });

  it('gmSum flicker mode produces a floor too', () => {
    const spec = base({ coefs: { Q: 0, F: 0, N: 0, B: 0.02, K: 0, D: 0, R: 0 }, flickerMode: 'gmSum' });
    const y = simulateRate(spec, opts(1 << 15), new Prng(8));
    const r = oadev(frequencyToPhase(y, 1), 1, [100]);
    expect(r.dev[0]! / (0.664 * 0.02)).toBeGreaterThan(0.5);
    expect(r.dev[0]! / (0.664 * 0.02)).toBeLessThan(2);
  });

  it('comparePhase with zero leak is independent of the offset oscillator', () => {
    const n = 100, p = new Prng(9);
    const dut = p.fill(new Float64Array(n)), ref = p.fill(new Float64Array(n));
    const a = comparePhase(dut, ref, p.fill(new Float64Array(n)), 0, 0, new Prng(1));
    const b = comparePhase(dut, ref, p.fill(new Float64Array(n)), 0, 0, new Prng(1));
    for (let i = 0; i < n; i++) { expect(a[i]).toBe(b[i]); expect(a[i]).toBeCloseTo(dut[i]! - ref[i]!, 12); }
  });

  it('comparePhase applies leak times the offset-oscillator phase exactly', () => {
    const n = 50, p = new Prng(11);
    const dut = p.fill(new Float64Array(n)), ref = p.fill(new Float64Array(n)), osc = p.fill(new Float64Array(n));
    const out = comparePhase(dut, ref, osc, 0.5, 0, new Prng(1));
    for (let i = 0; i < n; i++) expect(out[i]).toBeCloseTo(dut[i]! - ref[i]! + 0.5 * osc[i]!, 12);
  });

  it('comparePhase white-PM floor has std dev floorQ and zero mean', () => {
    const n = 20000;
    const zeros = new Float64Array(n);
    const out = comparePhase(zeros, zeros, zeros, 0, 2e-9, new Prng(12));
    let mean = 0; for (const v of out) mean += v; mean /= n;
    let variance = 0; for (const v of out) variance += (v - mean) ** 2; variance /= n;
    expect(mean).toBeCloseTo(0, 10);
    expect(Math.sqrt(variance)).toBeCloseTo(2e-9, 10);
  });

  it('comparePhase with floorQ=0 consumes no PRNG draws', () => {
    const n = 10;
    const dut = new Float64Array(n), ref = new Float64Array(n), osc = new Float64Array(n);
    const prng = new Prng(1);
    comparePhase(dut, ref, osc, 0, 0, prng);
    const fresh = new Prng(1);
    expect(prng.next()).toBe(fresh.next());
  });

  it('clock 3-state adds initial drift (initial[2]) to R', () => {
    const spec = base({ domain: 'clock', states: 3, coefs: { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 1e-12 } });
    const y = simulateRate(spec, { ...opts(4), initial: [0, 2e-9, 3e-12] }, new Prng(13));
    const expected = [0, 1, 2, 3].map(i => 2e-9 + 4e-12 * i);
    y.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 20));
  });

  it('clock 2-state ignores initial[2]', () => {
    const spec = base({ domain: 'clock', states: 2, coefs: { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 1e-12 } });
    const y = simulateRate(spec, { ...opts(4), initial: [0, 2e-9, 3e-12] }, new Prng(14));
    const expected = [0, 1, 2, 3].map(i => 2e-9 + 1e-12 * i);
    y.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 20));
  });
});
