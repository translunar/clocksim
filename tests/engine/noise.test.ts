import { describe, it, expect } from 'vitest';
import { Prng } from '../../src/engine/prng';
import { kasdinCoefficients, powerLaw, gaussMarkovSum, gmAvar } from '../../src/engine/noise';

function variance(x: Float64Array) { let m = 0; for (const v of x) m += v; m /= x.length; let s = 0; for (const v of x) s += (v - m) ** 2; return s / x.length; }

describe('kasdinCoefficients', () => {
  it('flicker FM (alpha=-1) matches the known recursion', () => {
    const h = kasdinCoefficients(-1, 5);
    expect(Array.from(h)).toEqual([1, 0.5, 0.375, 0.3125, 0.2734375]);
  });
  it('white FM is a delta, RW FM is all ones, white PM is a first difference', () => {
    expect(Array.from(kasdinCoefficients(0, 4))).toEqual([1, 0, 0, 0]);
    expect(Array.from(kasdinCoefficients(-2, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(kasdinCoefficients(2, 4))).toEqual([1, -1, 0, 0]);
  });
});

describe('powerLaw', () => {
  it('white FM has variance qd', () => {
    const y = powerLaw(0, 200000, 4, new Prng(1));
    expect(variance(y)).toBeCloseTo(4, 1);
  });
  it('RW FM equals the cumulative sum of the white driver (same seed)', () => {
    const n = 1000;
    const w = new Prng(9).fill(new Float64Array(n));
    const y = powerLaw(-2, n, 1, new Prng(9));
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += w[i]!; expect(y[i]).toBeCloseTo(acc, 9); }
  });
  it('white PM equals the first difference of the white driver', () => {
    const n = 1000;
    const w = new Prng(5).fill(new Float64Array(n));
    const y = powerLaw(2, n, 1, new Prng(5));
    expect(y[0]).toBeCloseTo(w[0]!, 9);
    for (let i = 1; i < n; i++) expect(y[i]).toBeCloseTo(w[i]! - w[i - 1]!, 9);
  });
  it('flicker FM has a PSD slope near -1 (log-log fit of block variances)', () => {
    // Block-average variance of 1/f noise is ~flat vs block size; of white noise it falls as 1/m.
    const y = powerLaw(-1, 1 << 16, 1, new Prng(2));
    const blockVar = (m: number) => { const k = Math.floor(y.length / m); const b = new Float64Array(k); for (let i = 0; i < k; i++) { let s = 0; for (let j = 0; j < m; j++) s += y[i * m + j]!; b[i] = s / m; } return variance(b); };
    const v8 = blockVar(8), v256 = blockVar(256);
    const slope = Math.log(v256 / v8) / Math.log(256 / 8);
    expect(slope).toBeGreaterThan(-0.35); // white would give -1, RW would give +1
    expect(slope).toBeLessThan(0.25);
  });
});

describe('gaussMarkovSum', () => {
  it('gmAvar has the right limits', () => {
    const s = 2, tc = 100;
    expect(gmAvar(s, tc, 0.01)).toBeCloseTo(s * s * 0.01 / tc * (2 / 3), 3); // RW-like: (2σ²/τc)·τ/3
    // widened from 1e5: the white-like limit is only leading-order (2σ²τc/τ); the O(τc²/τ²)
    // residual is ~1.2 at τ=1e5, which overflows toBeCloseTo's 0.5 tolerance. τ=1e6 shrinks
    // the residual to ~0.12 without loosening the bound (same principle as widening n above).
    expect(gmAvar(s, tc, 1e6) * 1e6).toBeCloseTo(2 * s * s * tc, 0);        // white-like: 2σ²τc/τ
  });
  it('has roughly the requested stationary-ish floor at the band centre', () => {
    const n = 1 << 16, dt = 1;
    const y = gaussMarkovSum(1, [10, 100, 1000], n, dt, new Prng(3));
    // Allan variance at tau=100 via simple non-overlapping estimator
    const m = 100; const k = Math.floor(n / m); const bars = new Float64Array(k);
    for (let i = 0; i < k; i++) { let s = 0; for (let j = 0; j < m; j++) s += y[i * m + j]!; bars[i] = s / m; }
    let s2 = 0; for (let i = 0; i + 1 < k; i++) s2 += (bars[i + 1]! - bars[i]!) ** 2; const avar = s2 / (2 * (k - 1));
    expect(Math.sqrt(avar)).toBeGreaterThan(0.664 * 0.6);
    expect(Math.sqrt(avar)).toBeLessThan(0.664 * 1.5);
  });
});
