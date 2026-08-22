import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { frequencyToPhase, logSpacedM, oadev, mdev, ohdev, analyticAdev, analyticAdevTerms } from '../../src/engine/deviations';

const fx = JSON.parse(readFileSync(new URL('../../fixtures/deviations.json', import.meta.url), 'utf8'));

describe('frequencyToPhase', () => {
  it('matches the fixture phase', () => {
    const x = frequencyToPhase(Float64Array.from(fx.y), fx.dt);
    expect(x.length).toBe(fx.x.length);
    for (let i = 0; i < x.length; i += 97) expect(x[i]).toBeCloseTo(fx.x[i], 12);
  });
});

describe('deviations vs allantools', () => {
  const x = Float64Array.from(fx.x);
  for (const [name, fn] of [['oadev', oadev], ['mdev', mdev], ['ohdev', ohdev]] as const) {
    it(`${name} matches to 1e-9 relative`, () => {
      const r = fn(x, fx.dt, fx.ms);
      const ref = fx[name];
      expect(r.tau.length).toBe(ref.tau.length);
      for (let i = 0; i < r.tau.length; i++) {
        expect(r.tau[i]).toBeCloseTo(ref.tau[i], 12);
        expect(Math.abs(r.dev[i]! / ref.dev[i] - 1)).toBeLessThan(1e-9);
        expect(r.count[i]).toBe(ref.n[i]);
        expect(r.lo[i]).toBeLessThan(r.dev[i]!);
        expect(r.hi[i]).toBeGreaterThan(r.dev[i]!);
      }
    });
  }
});

describe('logSpacedM', () => {
  it('is increasing, unique, and bounded by maxFrac of the series', () => {
    const ms = logSpacedM(10001, 8, 0.1);
    for (let i = 1; i < ms.length; i++) expect(ms[i]!).toBeGreaterThan(ms[i - 1]!);
    expect(ms[0]).toBe(1);
    expect(ms[ms.length - 1]!).toBeLessThanOrEqual(1000);
  });
});

describe('analyticAdev', () => {
  it('reproduces each asymptote alone', () => {
    const taus = [1, 10, 100];
    const z = { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 };
    expect(Array.from(analyticAdev({ ...z, N: 2 }, taus))).toEqual(taus.map(t => 2 / Math.sqrt(t)));
    expect(Array.from(analyticAdev({ ...z, B: 3 }, taus)).map(v => +v.toFixed(6))).toEqual(taus.map(() => +(3 * Math.sqrt(2 * Math.LN2 / Math.PI)).toFixed(6)));
    expect(Array.from(analyticAdev({ ...z, K: 3 }, taus))).toEqual(taus.map(t => 3 * Math.sqrt(t / 3)));
    expect(Array.from(analyticAdev({ ...z, R: 1 }, taus))).toEqual(taus.map(t => t / Math.SQRT2));
    expect(Array.from(analyticAdev({ ...z, Q: 1 }, taus))).toEqual(taus.map(t => Math.sqrt(3) / t));
    expect(Array.from(analyticAdev({ ...z, D: 1 }, taus))).toEqual(taus.map(t => Math.sqrt(23 / 60 * t ** 3)));
  });
  it('sums in quadrature and exposes terms', () => {
    const c = { Q: 0, F: 0, N: 1, B: 0, K: 1, D: 0, R: 0 };
    const total = analyticAdev(c, [3])[0]!;
    const terms = analyticAdevTerms(c, [3]);
    expect(total).toBeCloseTo(Math.sqrt(terms.N[0]! ** 2 + terms.K[0]! ** 2), 12);
  });
});
