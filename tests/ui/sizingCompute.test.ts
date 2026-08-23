import { describe, it, expect } from 'vitest';
import { cadenceGrid, computeKnee } from '../../src/ui/views/sizingCompute';
import { defaultState } from '../../src/ui/state';

describe('sizingCompute', () => {
  it('grid spans 1e-2..1e4', () => { const g = cadenceGrid(); expect(g[0]).toBeCloseTo(0.01, 9); expect(g[g.length - 1]).toBeCloseTo(1e4, 3); });
  it('cadenceGrid accepts a custom range', () => {
    const g = cadenceGrid(1, 100);
    expect(g[0]!).toBeCloseTo(1);
    expect(g[g.length - 1]!).toBeCloseTo(100);
  });
  it('curves are monotone and slowest cadence respects the requirement', () => {
    const s = defaultState();
    const req = { id: 'r', value: 1e-3, sigma: 3 as const, duration: 600 };
    const curves = computeKnee(s.bench.filter(d => d.domain === 'gyro'), s.scenario, 'gyro', req, cadenceGrid());
    expect(curves.length).toBe(1);
    const c = curves[0]!;
    for (let i = 1; i < c.sigma.length; i++) expect(c.sigma[i]!).toBeGreaterThanOrEqual(c.sigma[i - 1]!);
    if (c.slowestCadence !== null) { const g = cadenceGrid(); const i = g.findIndex(v => v >= c.slowestCadence! - 1e-9); expect(c.sigma[i]! * 3).toBeLessThanOrEqual(1e-3 * 1.0001); }
  });
});
