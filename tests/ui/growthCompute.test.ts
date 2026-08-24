import { describe, it, expect } from 'vitest';
import { growthTimes, computeEstimates, mcSummary, valueAt, NO_THERMAL, DELTA_T_LEVELS, thermalFamily, flowdown, computeDeviceCurves } from '../../src/ui/views/growthCompute';
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

describe('compare-by compute (spec §10)', () => {
  const t = Float64Array.from([1, 10, 100]);
  const req = { id: 'r', value: 4, sigma: 3 as const, duration: 10 };
  it('thermalFamily adds |tempco|·ΔT·t to the envelope, sign-blind', () => {
    const fam = thermalFamily(t, Float64Array.from([1, 1, 1]), -2e-3);
    expect(DELTA_T_LEVELS).toEqual([0.1, 1, 10]);
    expect(fam.length).toBe(3);
    expect(fam[0]![2]).toBeCloseTo(1 + 2e-3 * 0.1 * 100, 12);
    expect(fam[2]![1]).toBeCloseTo(1 + 2e-3 * 10 * 10, 12);
  });
  it('flowdown solves (req − envelope(t_req)) / (|tempco|·t_req)', () => {
    expect(flowdown(t, Float64Array.from([1, 2, 3]), 0.01, req)).toBeCloseTo((4 - 2) / (0.01 * 10), 12);
    expect(flowdown(t, Float64Array.from([1, 2, 3]), -0.01, req)).toBeCloseTo((4 - 2) / (0.01 * 10), 12);
  });
  it('flowdown degenerate cases: ≤ 0 when noise alone violates; null without a tempco', () => {
    expect(flowdown(t, Float64Array.from([1, 5, 9]), 0.01, req)!).toBeLessThanOrEqual(0);
    expect(flowdown(t, Float64Array.from([1, 2, 3]), 0, req)).toBeNull();
  });
  it('computeDeviceCurves: one kσ curve per device under the single compareMethod', () => {
    const s2 = defaultState();
    const gyros = s2.bench.filter(d => d.domain === 'gyro');
    const spec = benchToSpec(gyros[0]!);
    const grid = growthTimes({ spec, scenario: s2.scenario, dom: 'gyro', req: s2.scenario.byDomain.gyro.requirements[0]! });
    const curves = computeDeviceCurves(gyros, s2.scenario, 'gyro', s2.scenario.byDomain.gyro.requirements[0]!, grid);
    expect(curves.map(c => c.id)).toEqual(gyros.map(d => d.id));
    expect(curves[0]!.atReq).not.toBeNull();
    expect(curves[0]!.scaled[5]).toBeGreaterThan(0);
  });
  it('NO_THERMAL is the no-thermal request fragment', () => {
    expect(NO_THERMAL).toEqual({ profile: { kind: 'none' }, includeThermal: false });
  });
});
