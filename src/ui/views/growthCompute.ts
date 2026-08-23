import type { DeviceSpec } from '../../engine/bench';
import { contributions, estimateSigma, timeToRequirement, type ContributionKey, type EstimateMethod, type EstimateOptions } from '../../engine/models';
import { logTimes } from '../../engine/montecarlo';
import { effectiveTm, type Requirement, type Scenario } from '../state';
import type { Domain } from '../../engine/units';

export interface GrowthInputs { spec: DeviceSpec; scenario: Scenario; dom: Domain; req: Requirement | null }
export interface MethodCurve { method: EstimateMethod; sigma: Float64Array; scaled: Float64Array; atReq: number | null; timeToReq: number | null; contributions: Record<ContributionKey, Float64Array> }

export function growthTimes(i: GrowthInputs): Float64Array {
  const ds = i.scenario.byDomain[i.dom];
  return logTimes(ds.dt, Math.max(ds.duration, i.req?.duration ?? 0));
}

export function valueAt(times: Float64Array, curve: Float64Array, t: number): number | null {
  if (t < times[0]! || t > times[times.length - 1]!) return null;
  for (let j = 1; j < times.length; j++) if (t <= times[j]!) {
    // Exact grid hits: return the stored sample directly rather than round-tripping through
    // log/exp, which can perturb an exact value (e.g. Math.exp(Math.log(3)) !== 3).
    if (t === times[j - 1]!) return curve[j - 1]!;
    if (t === times[j]!) return curve[j]!;
    const a = curve[j - 1]!, b = curve[j]!;
    if (!(a > 0) || !(b > 0)) return b;
    const f = (Math.log(t) - Math.log(times[j - 1]!)) / (Math.log(times[j]!) - Math.log(times[j - 1]!));
    return Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a)));
  }
  return curve[0]!;
}

export function computeEstimates(i: GrowthInputs, times: Float64Array): MethodCurve[] {
  const sc = i.scenario;
  const ds = sc.byDomain[i.dom];
  return sc.estimateMethods.map(method => {
    const o: EstimateOptions = { method, Tm: effectiveTm(sc, i.dom), fix: ds.fix, driftKnowledge: sc.driftKnowledge, dt: ds.dt, profile: sc.temperature, includeThermal: sc.includeThermal };
    const sigma = estimateSigma(i.spec, o, times);
    const k = i.req?.sigma ?? 1;
    const scaled = Float64Array.from(sigma, v => v * k);
    return { method, sigma, scaled, contributions: contributions(i.spec, o, times), atReq: i.req ? valueAt(times, scaled, i.req.duration) : null, timeToReq: i.req ? timeToRequirement(times, scaled, i.req.value) : null };
  });
}

export function mcSummary(times: Float64Array, env: { p68: Float64Array; p95: Float64Array; p997: Float64Array }, req: Requirement | null) {
  const curve = req?.sigma === 3 ? env.p997 : req?.sigma === 2 ? env.p95 : env.p68;
  return { curve, atReq: req ? valueAt(times, curve, req.duration) : null, timeToReq: req ? timeToRequirement(times, curve, req.value) : null };
}
