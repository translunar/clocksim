import type { DeviceSpec } from '../../engine/bench';
import { contributions, estimateSigma, timeToRequirement, type ContributionKey, type EstimateMethod, type EstimateOptions } from '../../engine/models';
import { logTimes } from '../../engine/montecarlo';
import { effectiveTm, type Requirement, type Scenario, benchToSpec, type BenchDevice } from '../state';
import type { Domain } from '../../engine/units';

export interface GrowthInputs { spec: DeviceSpec; scenario: Scenario; dom: Domain; req: Requirement | null }
export interface MethodCurve { method: EstimateMethod; sigma: Float64Array; scaled: Float64Array; atReq: number | null; timeToReq: number | null; contributions: Record<ContributionKey, Float64Array> }

/** Thermal left the UI in v1.2 (spec §10.5): every request a view builds says "no thermal". */
export const NO_THERMAL = { profile: { kind: 'none' } as const, includeThermal: false as const };

/** Sustained temperature-offset levels of the §10.4 family. ΔT = 0 is the envelope itself. */
export const DELTA_T_LEVELS = [0.1, 1, 10];

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
    const o: EstimateOptions = { method, Tm: effectiveTm(sc, i.dom), fix: ds.fix, driftKnowledge: sc.driftKnowledge, dt: ds.dt, ...NO_THERMAL };
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

/** Worst-case family (spec §10.4): envelope plus |tempco|·ΔT·t at each sustained level. Linear, not RSS — a sustained offset is a deterministic bias. */
export function thermalFamily(times: Float64Array, envelope: Float64Array, tempcoSI: number): Float64Array[] {
  return DELTA_T_LEVELS.map(dT => Float64Array.from(envelope, (v, i) => v + Math.abs(tempcoSI) * dT * times[i]!));
}

/**
 * Flowdown (spec §10.4): the largest sustained |ΔT| that still meets the requirement at its
 * duration. May be ≤ 0 (the noise alone already violates); null when no readout can be formed
 * (tempco is zero, or the requirement duration lies outside the grid).
 */
export function flowdown(times: Float64Array, envelope: Float64Array, tempcoSI: number, req: Requirement): number | null {
  if (tempcoSI === 0) return null;
  const e = valueAt(times, envelope, req.duration);
  if (e === null) return null;
  return (req.value - e) / (Math.abs(tempcoSI) * req.duration);
}

export interface DeviceCurve { id: string; name: string; scaled: Float64Array; atReq: number | null; timeToReq: number | null }

/** One analytic kσ curve per bench device of the domain, all under `scenario.compareMethod` (spec §10.3). */
export function computeDeviceCurves(devices: BenchDevice[], sc: Scenario, dom: Domain, req: Requirement | null, times: Float64Array): DeviceCurve[] {
  const ds = sc.byDomain[dom];
  const k = req?.sigma ?? 1;
  return devices.map(d => {
    const o: EstimateOptions = { method: sc.compareMethod, Tm: effectiveTm(sc, dom), fix: ds.fix, driftKnowledge: sc.driftKnowledge, dt: ds.dt, ...NO_THERMAL };
    const scaled = Float64Array.from(estimateSigma(benchToSpec(d), o, times), v => v * k);
    return { id: d.id, name: d.name, scaled, atReq: req ? valueAt(times, scaled, req.duration) : null, timeToReq: req ? timeToRequirement(times, scaled, req.value) : null };
  });
}
