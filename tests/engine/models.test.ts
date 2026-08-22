import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initialCovariance, contributions, estimateSigma, bayardSigma, timeToRequirement, steadyStateVsCadence, crossover, type EstimateOptions } from '../../src/engine/models';
import type { DeviceSpec } from '../../src/engine/bench';

const fx = JSON.parse(readFileSync(new URL('../../fixtures/bayard.json', import.meta.url), 'utf8'));
const z = { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 };
const spec = (over: Partial<DeviceSpec>): DeviceSpec => ({ id: 'g', name: 'g', domain: 'gyro', states: 2, coefs: z, flickerMode: 'exact', gmTaus: [], thermal: null, source: 't', ...over });
const baseOpts = { Tm: 3600, fix: { sigma: fx.nea, cadence: fx.delta, bias: fx.b }, driftKnowledge: null, dt: 1, profile: { kind: 'none' as const }, includeThermal: false };

describe('Bayard port', () => {
  const g = spec({ coefs: { ...z, N: fx.N, B: fx.B } });
  it('initial covariance matches bayard_calc.m', () => {
    const kEff = fx.B / Math.sqrt(fx.Tfudge);
    const p = initialCovariance(g, baseOpts.fix, null, kEff);
    expect(p.p11 / fx.p11).toBeCloseTo(1, 10);
    expect(p.p12 / fx.p12).toBeCloseTo(1, 10);
    expect(p.p22 / fx.p22).toBeCloseTo(1, 10);
  });
  it('fudge sigma(t) matches bayard_calc.m to 1e-10 relative', () => {
    const s = bayardSigma(g, baseOpts.fix, fx.Tfudge, Float64Array.from(fx.t));
    for (let i = 0; i < fx.t.length; i++) expect(s[i]! / fx.sigma[i]).toBeCloseTo(1, 10);
  });
});

describe('estimate methods', () => {
  const t = Float64Array.from([10, 100, 1000, 10000]);
  const noFix = { sigma: 0, cadence: 1, bias: 0 };
  const g = spec({ coefs: { ...z, B: 1e-5 } });
  it('constant gives B t', () => {
    const c = contributions(g, { ...baseOpts, method: 'constant', fix: noFix }, t);
    for (let i = 0; i < t.length; i++) expect(c.B[i]).toBeCloseTo(1e-5 * t[i]!, 12);
  });
  it('fudge gives sqrt(B^2/Tm t^3/3)', () => {
    const c = contributions(g, { ...baseOpts, method: 'fudge', fix: noFix, Tm: 100 }, t);
    for (let i = 0; i < t.length; i++) expect(c.B[i]).toBeCloseTo(Math.sqrt(1e-10 / 100 * t[i]! ** 3 / 3), 12);
  });
  it('gm tends to constant as Tm -> infinity and to white-like at long t', () => {
    const cInf = contributions(g, { ...baseOpts, method: 'gm', fix: noFix, Tm: 1e12 }, t);
    for (let i = 0; i < t.length; i++) expect(cInf.B[i]! / (1e-5 * t[i]!)).toBeCloseTo(1, 4);
    const cShort = contributions(g, { ...baseOpts, method: 'gm', fix: noFix, Tm: 1 }, t);
    expect(cShort.B[3]! / Math.sqrt(2 * 1e-10 * 1 * 1e4)).toBeCloseTo(1, 3);
  });
  it('fittedK ignores B and uses K', () => {
    const gk = spec({ coefs: { ...z, B: 1e-5, K: 1e-6 } });
    const c = contributions(gk, { ...baseOpts, method: 'fittedK', fix: noFix }, t);
    for (let i = 0; i < t.length; i++) { expect(c.B[i]).toBe(0); expect(c.K[i]).toBeCloseTo(1e-6 * Math.sqrt(t[i]! ** 3 / 3), 12); }
  });
  it('total is the RSS of contributions', () => {
    const gk = spec({ coefs: { ...z, N: 1e-4, B: 1e-5, K: 1e-6 } });
    const o = { ...baseOpts, method: 'constant' as const };
    const c = contributions(gk, o, t), s = estimateSigma(gk, o, t);
    for (let i = 0; i < t.length; i++) {
      let q = 0; for (const k of Object.keys(c) as (keyof typeof c)[]) q += c[k][i]! ** 2;
      expect(s[i]).toBeCloseTo(Math.sqrt(q), 12);
    }
  });
  it('accel position contributions', () => {
    const a = spec({ domain: 'accel', states: 3, coefs: { ...z, N: 1e-3, B: 1e-4 } });
    const c = contributions(a, { ...baseOpts, method: 'constant', fix: noFix }, t);
    for (let i = 0; i < t.length; i++) { expect(c.N[i]).toBeCloseTo(1e-3 * Math.sqrt(t[i]! ** 3 / 3), 12); expect(c.B[i]).toBeCloseTo(1e-4 * t[i]! ** 2 / 2, 12); }
  });
  it('3-state clock drift knowledge adds sqrt(p33) t^2/2', () => {
    const ck = spec({ domain: 'clock', states: 3, coefs: z });
    const c = contributions(ck, { ...baseOpts, method: 'constant', fix: noFix, driftKnowledge: 1e-20 }, t);
    for (let i = 0; i < t.length; i++) expect(c.initial[i]).toBeCloseTo(1e-10 * t[i]! ** 2 / 2, 18);
  });
  it('constant-method R contribution is zero for 3-state (compensated) and R t^2/2 for 2-state', () => {
    const R = 1e-12;
    const c3 = spec({ domain: 'clock', states: 3, coefs: { ...z, R } });
    const r3 = contributions(c3, { ...baseOpts, method: 'constant', fix: noFix }, t);
    for (let i = 0; i < t.length; i++) expect(r3.R[i]).toBe(0);
    const c2 = spec({ domain: 'clock', states: 2, coefs: { ...z, R } });
    const r2 = contributions(c2, { ...baseOpts, method: 'constant', fix: noFix }, t);
    for (let i = 0; i < t.length; i++) expect(r2.R[i]).toBeCloseTo(R * t[i]! * t[i]! / 2, 20);
  });

  it('thermal contribution integrates tempco * T_dev', () => {
    const g2 = spec({ thermal: { tempco: 1e-6, tauTh: 0 } });
    const c = contributions(g2, { ...baseOpts, method: 'constant', fix: noFix, dt: 0.01, profile: { kind: 'ramp', rate: 0.01 }, includeThermal: true }, Float64Array.from([100]));
    expect(c.thermal[0]).toBeCloseTo(1e-6 * 0.01 * 100 * 100 / 2, 7); // left-Riemann sum at dt=0.01
  });
  it('gmTwice (accel) tends to constant as Tm -> infinity and to white-like at long t', () => {
    const a = spec({ domain: 'accel', states: 3, coefs: { ...z, B: 1e-4 } });
    const cInf = contributions(a, { ...baseOpts, method: 'gm', fix: noFix, Tm: 1e12 }, t);
    for (let i = 0; i < t.length; i++) expect(cInf.B[i]! / (1e-4 * t[i]! ** 2 / 2)).toBeCloseTo(1, 4);
    const cShort = contributions(a, { ...baseOpts, method: 'gm', fix: noFix, Tm: 1 }, t);
    expect(cShort.B[3]! / Math.sqrt(2 * 1e-8 * 1 * 1e4 ** 3 / 3)).toBeCloseTo(1, 3);
  });
  it('rejects non-positive Tm', () => {
    expect(() => contributions(g, { ...baseOpts, method: 'constant', Tm: 0, fix: noFix }, t)).toThrow();
  });

  it('estimateSigma excludes thermal from the total, even though contributions.thermal is nonzero', () => {
    const g2 = spec({ thermal: { tempco: 1e-6, tauTh: 0 } });
    const o: EstimateOptions = { ...baseOpts, method: 'constant', fix: noFix, dt: 0.01, profile: { kind: 'ramp', rate: 0.01 }, includeThermal: true };
    const withThermal = estimateSigma(g2, o, t);
    const withoutThermal = estimateSigma(g2, { ...o, includeThermal: false }, t);
    const c = contributions(g2, o, t);
    for (let i = 0; i < t.length; i++) {
      expect(c.thermal[i]).toBeGreaterThan(0);
      expect(withThermal[i]).toBeCloseTo(withoutThermal[i]!, 12);
    }
  });
});

describe('gm continuity across the Taylor/closed-form threshold', () => {
  // Independent reference (one Taylor order beyond production's, of the same closed forms
  // gmOnce/gmTwice rewrite to) — verified against a 50-digit Decimal reference in Python during
  // review to agree with the exact closed form to <1e-15 relative near x = 0.03.
  const hRef = (x: number) => x ** 2 / 2 - x ** 3 / 6 + x ** 4 / 24 - x ** 5 / 120 + x ** 6 / 720 - x ** 7 / 5040 + x ** 8 / 40320;
  const gRef = (x: number) => x ** 4 / 8 - x ** 5 / 30 + x ** 6 / 144 - x ** 7 / 840 + x ** 8 / 5760 - x ** 9 / 45360;
  const Tm = 100, B = 1e-5, times = [2.9, 3.1]; // x = t/Tm = 0.029, 0.031: straddles the 0.03 branch threshold
  const noFix = { sigma: 0, cadence: 1, bias: 0 };
  it('gmOnce (level-1) matches the closed form on both sides of the branch', () => {
    const g = spec({ coefs: { ...z, B } });
    const c = contributions(g, { ...baseOpts, method: 'gm', fix: noFix, Tm }, Float64Array.from(times));
    times.forEach((t, i) => {
      const ref = Math.sqrt(2 * B * B * Tm * Tm * hRef(t / Tm));
      expect(c.B[i]! / ref).toBeCloseTo(1, 9);
    });
  });
  it('gmTwice (level-2/accel) matches the closed form on both sides of the branch', () => {
    const a = spec({ domain: 'accel', states: 3, coefs: { ...z, B } });
    const c = contributions(a, { ...baseOpts, method: 'gm', fix: noFix, Tm }, Float64Array.from(times));
    times.forEach((t, i) => {
      const ref = Math.sqrt(2 * B * B * Tm ** 4 * gRef(t / Tm));
      expect(c.B[i]! / ref).toBeCloseTo(1, 9);
    });
  });
});

describe('helpers', () => {
  it('timeToRequirement interpolates in log-log', () => {
    const t = Float64Array.from([1, 10, 100]), s = Float64Array.from([1, 10, 100]);
    expect(timeToRequirement(t, s, 31.6227766)).toBeCloseTo(31.6227766, 3);
    expect(timeToRequirement(t, s, 1000)).toBeNull();
  });
  it('timeToRequirement handles a leading time of 0 without taking log(0)', () => {
    const t = Float64Array.from([0, 1, 10, 100]), s = Float64Array.from([0, 10, 20, 100]);
    expect(timeToRequirement(t, s, 5)).toBe(1); // crosses between t=0 and t=1; can't log-interpolate from 0
  });
  it('steadyStateVsCadence grows with cadence', () => {
    const g = spec({ coefs: { ...z, N: 1e-4, B: 1e-5 } });
    const s = steadyStateVsCadence(g, { sigma: 1e-4, bias: 0 }, 3600, Float64Array.from([0.1, 1, 10, 100]));
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
  });
  it('steadyStateVsCadence rejects non-positive Tm', () => {
    const g = spec({ coefs: { ...z, N: 1e-4, B: 1e-5 } });
    expect(() => steadyStateVsCadence(g, { sigma: 1e-4, bias: 0 }, 0, Float64Array.from([1]))).toThrow();
  });
  it('crossover finds where A rises above B', () => {
    const tau = Float64Array.from([1, 10, 100, 1000]);
    const a = Float64Array.from([1, 1, 1, 1]), b = Float64Array.from([10, 3, 1, 0.3]);
    const x = crossover(tau, a, tau, b);
    expect(x).not.toBeNull();
    expect(x!).toBeGreaterThan(10); expect(x!).toBeLessThanOrEqual(100);
    expect(crossover(tau, a, tau, Float64Array.from([10, 10, 10, 10]))).toBeNull();
  });
  it('crossover finds a true interior crossing', () => {
    const tau = Float64Array.from([1, 10, 100, 1000]);
    const a = Float64Array.from([0.5, 1, 2, 4]), b = Float64Array.from([2, 2, 2, 2]);
    const x = crossover(tau, a, tau, b);
    expect(x).not.toBeNull();
    expect(x!).toBeGreaterThan(10);
    expect(x!).toBeLessThanOrEqual(100);
    expect(x!).toBeCloseTo(100, 6); // A(100) == B(100) exactly: log-linear interpolation lands on the grid point
  });
  it('crossover ignores a non-finite sample in B without reporting a spurious early crossing', () => {
    const tau = Float64Array.from([1, 10, 100, 1000]);
    const a = Float64Array.from([0.5, 1, 2, 4]), b = Float64Array.from([2, NaN, 2, 2]);
    const x = crossover(tau, a, tau, b);
    // The NaN at tau=10 corrupts the two segments touching it (both need a finite endpoint to
    // interpolate); only tau=1000 stays clean, so there's no sign change left in valid data —
    // it must not fabricate a crossing from a sign recorded before the gap.
    expect(x).toBeNull();
  });
});
