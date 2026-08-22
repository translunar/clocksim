import { describe, it, expect } from 'vitest';
import { Prng } from '../../src/engine/prng';

describe('Prng', () => {
  it('is deterministic for a seed', () => {
    const a = new Prng(42), b = new Prng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('differs across seeds and forks', () => {
    const a = new Prng(1), b = new Prng(2), c = new Prng(1).fork(7);
    expect(a.next()).not.toBe(b.next());
    expect(new Prng(1).next()).not.toBe(c.next());
  });
  it('produces uniform [0,1)', () => {
    const p = new Prng(3);
    let s = 0;
    for (let i = 0; i < 100000; i++) { const u = p.next(); expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); s += u; }
    expect(s / 100000).toBeCloseTo(0.5, 2);
  });
  it('produces unit gaussians', () => {
    const p = new Prng(4);
    const x = p.fill(new Float64Array(200000));
    let m = 0, v = 0;
    for (const xi of x) m += xi; m /= x.length;
    for (const xi of x) v += (xi - m) ** 2; v /= x.length;
    expect(m).toBeCloseTo(0, 2);
    expect(v).toBeCloseTo(1, 2);
  });
});
