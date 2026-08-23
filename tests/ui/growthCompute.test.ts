import { describe, it, expect } from 'vitest';
import { growthTimes, computeEstimates, mcSummary, valueAt } from '../../src/ui/views/growthCompute';
import { defaultState, benchToSpec } from '../../src/ui/state';

describe('growthCompute', () => {
  const s = defaultState();
  const spec = benchToSpec(s.bench[0]!);
  const req = s.scenario.byDomain.gyro.requirements[0]!;
  it('times span to the requirement duration', () => {
    const short = defaultState().scenario; short.byDomain.gyro.duration = 100;
    const t = growthTimes({ spec, scenario: short, dom: 'gyro', req });
    expect(t[t.length - 1]).toBe(req.duration);
  });
  it('computes one curve per selected method with scaled sigma', () => {
    const t = growthTimes({ spec, scenario: s.scenario, dom: 'gyro', req });
    const curves = computeEstimates({ spec, scenario: s.scenario, dom: 'gyro', req }, t);
    expect(curves.map(c => c.method)).toEqual(s.scenario.estimateMethods);
    for (const c of curves) { expect(c.scaled[5]).toBeCloseTo(c.sigma[5]! * req.sigma, 12); expect(c.atReq).not.toBeNull(); }
  });
  it('fudge is below constant at short durations for a flicker-dominated device', () => {
    const t = growthTimes({ spec, scenario: s.scenario, dom: 'gyro', req });
    const noFix = defaultState().scenario;
    noFix.estimateMethods = ['fudge', 'constant'];
    noFix.byDomain.gyro.fix = { sigma: 0, cadence: 1, bias: 0 };
    const [fudge, constant] = computeEstimates({ spec, scenario: noFix, dom: 'gyro', req }, t);
    const i = t.findIndex(v => v >= 60);
    expect(fudge!.sigma[i]!).toBeLessThan(constant!.sigma[i]!);
  });
  it('valueAt interpolates and mcSummary picks the right percentile', () => {
    const t = Float64Array.from([1, 10, 100]);
    expect(valueAt(t, Float64Array.from([1, 10, 100]), 31.6227766)).toBeCloseTo(31.6227766, 3);
    const env = { p68: Float64Array.from([1, 1, 1]), p95: Float64Array.from([2, 2, 2]), p997: Float64Array.from([3, 3, 3]) };
    expect(mcSummary(t, env, { id: 'r', value: 2.5, sigma: 3, duration: 10 }).atReq).toBe(3);
    expect(mcSummary(t, env, { id: 'r', value: 2.5, sigma: 2, duration: 10 }).atReq).toBe(2);
  });
});
