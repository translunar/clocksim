import type { Preset } from '../engine/presets';
import { specFromDatasheet, validatePreset } from '../engine/presets';
import type { DeviceSpec } from '../engine/bench';
import type { FixQuality, EstimateMethod } from '../engine/models';
import type { TempProfile } from '../engine/thermal';
import type { DevKind } from '../engine/deviations';
import type { Domain } from '../engine/units';
import { PRESETS } from '../presets';

export interface BenchDevice extends Preset { flickerMode: 'exact' | 'gmSum'; gmTaus: number[] }
export interface Requirement { id: string; value: number; sigma: 1 | 2 | 3; duration: number }
/** Scenario settings that differ per device domain — a clock's fix quality is nanoseconds, a gyro's is milliradians. */
export interface DomainScenario {
  duration: number; dt: number; fix: FixQuality;
  requirements: Requirement[]; activeRequirement: string | null;
}
export interface Scenario {
  runs: number; seed: number;
  byDomain: Record<Domain, DomainScenario>;
  driftKnowledge: number | null;
  temperature: TempProfile; includeThermal: boolean;
  Tm: number | 'auto'; estimateMethods: EstimateMethod[];
  devKind: DevKind;
  compareBy: CompareBy; compareMethod: EstimateMethod;
  compare: { dut: string | null; ref: string | null; osc: string | null; leak: number; floorQ: number };
}
export type View = 'guide' | 'devices' | 'adev' | 'growth' | 'sizing' | 'compare';
/** Which single dimension the Error-growth chart varies (spec §10.1). */
export type CompareBy = 'strategy' | 'device' | 'thermal';
export interface AppState { bench: BenchDevice[]; selected: string | null; scenario: Scenario; view: View }

/** Returns `base` if unused among `existing`, else the first `base-2`, `base-3`, … that is free. */
export function uniqueId(base: string, existing: Iterable<string>): string {
  const seen = new Set(existing);
  if (!seen.has(base)) return base;
  let n = 2;
  while (seen.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function fromPreset(p: Preset, id = p.id): BenchDevice {
  return { ...structuredClone(p), id, flickerMode: 'exact', gmTaus: [10, 100, 1000] };
}

export function benchToSpec(d: BenchDevice): DeviceSpec {
  return { ...specFromDatasheet(d), flickerMode: d.flickerMode, gmTaus: d.gmTaus };
}

export function isBenchDevice(v: unknown): v is BenchDevice {
  if (!validatePreset(v)) return false;
  const o = v as unknown as Record<string, unknown>;
  return (o.flickerMode === 'exact' || o.flickerMode === 'gmSum') && Array.isArray(o.gmTaus);
}

export function defaultDomainScenarios(): Record<Domain, DomainScenario> {
  return {
    gyro:  { duration: 3600,  dt: 0.1, fix: { sigma: 333e-6, cadence: 0.5, bias: 0 },
             requirements: [{ id: 'g1', value: Math.PI / 180, sigma: 3, duration: 600 }], activeRequirement: 'g1' },
    accel: { duration: 3600,  dt: 0.1, fix: { sigma: 3, cadence: 1, bias: 0 },
             requirements: [{ id: 'a1', value: 100, sigma: 3, duration: 600 }], activeRequirement: 'a1' },
    clock: { duration: 86400, dt: 1,   fix: { sigma: 10e-9, cadence: 1, bias: 0 },
             requirements: [{ id: 'c1', value: 1e-6, sigma: 3, duration: 86400 }], activeRequirement: 'c1' },
  };
}

/** Domain of the selected bench device; 'gyro' when nothing is selected. */
export function activeDomain(s: AppState): Domain {
  return s.bench.find(d => d.id === s.selected)?.domain ?? 'gyro';
}
export function domScenario(s: AppState): DomainScenario {
  return s.scenario.byDomain[activeDomain(s)];
}
export function activeReq(ds: DomainScenario): Requirement | null {
  return ds.requirements.find(r => r.id === ds.activeRequirement) ?? null;
}
export function updateDomain(s: AppState, dom: Domain, fn: (ds: DomainScenario) => void): AppState {
  const byDomain = structuredClone(s.scenario.byDomain);
  fn(byDomain[dom]);
  return { ...s, scenario: { ...s.scenario, byDomain } };
}

export function effectiveTm(sc: Scenario, dom: Domain): number {
  if (sc.Tm !== 'auto') return sc.Tm;
  const ds = sc.byDomain[dom];
  const r = ds.requirements.find(x => x.id === ds.activeRequirement) ?? ds.requirements[0];
  return r ? r.duration : ds.duration;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPositive = (v: unknown): v is number => isFiniteNum(v) && v > 0;
const isNonNegative = (v: unknown): v is number => isFiniteNum(v) && v >= 0;

function sanitizeTemperature(raw: unknown, fallback: TempProfile): TempProfile {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case 'none': return { kind: 'none' };
    case 'step': return isFiniteNum(o.amplitude) && isFiniteNum(o.at) ? { kind: 'step', amplitude: o.amplitude, at: o.at } : fallback;
    case 'ramp': return isFiniteNum(o.rate) ? { kind: 'ramp', rate: o.rate } : fallback;
    case 'sinusoid': return isFiniteNum(o.amplitude) && isFiniteNum(o.period) ? { kind: 'sinusoid', amplitude: o.amplitude, period: o.period } : fallback;
    default: return fallback;
  }
}

function sanitizeFix(raw: unknown, fallback: FixQuality): FixQuality {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  if (isNonNegative(o.sigma) && isPositive(o.cadence) && isNonNegative(o.bias)) {
    return { sigma: o.sigma, cadence: o.cadence, bias: o.bias };
  }
  return fallback;
}

function sanitizeRequirements(raw: unknown, fallback: Requirement[]): Requirement[] {
  if (!Array.isArray(raw)) return fallback;
  const out: Requirement[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id === 'string' && isPositive(o.value) && (o.sigma === 1 || o.sigma === 2 || o.sigma === 3) && isPositive(o.duration)) {
      out.push({ id: o.id, value: o.value, sigma: o.sigma, duration: o.duration });
    }
  }
  return out;
}

function sanitizeCompare(raw: unknown, fallback: Scenario['compare']): Scenario['compare'] {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const idOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
  if (idOrNull(o.dut) && idOrNull(o.ref) && idOrNull(o.osc) && isNonNegative(o.leak) && isNonNegative(o.floorQ)) {
    return { dut: o.dut, ref: o.ref, osc: o.osc, leak: o.leak, floorQ: o.floorQ };
  }
  return fallback;
}

const VALID_ESTIMATE_METHODS = new Set<EstimateMethod>(['fudge', 'constant', 'gm', 'fittedK']);
const VALID_DEV_KINDS = new Set<DevKind>(['adev', 'mdev', 'hdev']);
const VALID_COMPARE_BY = new Set<CompareBy>(['strategy', 'device', 'thermal']);

function sanitizeDomainScenario(raw: unknown, fallback: DomainScenario): DomainScenario {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const duration = isPositive(o.duration) ? o.duration : fallback.duration;
  const dt = isPositive(o.dt) ? o.dt : fallback.dt;
  const fix = sanitizeFix(o.fix, fallback.fix);
  const requirements = sanitizeRequirements(o.requirements, fallback.requirements);
  const activeRequirement =
    typeof o.activeRequirement === 'string' && requirements.some(r => r.id === o.activeRequirement)
      ? o.activeRequirement : (requirements[0]?.id ?? null);
  return { duration, dt, fix, requirements, activeRequirement };
}

/**
 * Rebuilds a Scenario from untrusted input (e.g. a URL hash), starting from `defaults` and
 * copying only well-formed fields; anything malformed keeps the corresponding default. Never
 * throws — every branch has a safe fallback, so callers (fromHash) don't need a try/catch here.
 */
export function sanitizeScenario(raw: unknown, defaults: Scenario): Scenario {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const runs = isPositive(o.runs) && Number.isInteger(o.runs) ? o.runs : defaults.runs;
  const seed = isFiniteNum(o.seed) ? o.seed : defaults.seed;

  const rawBy = o.byDomain && typeof o.byDomain === 'object' ? (o.byDomain as Record<string, unknown>) : {};
  const byDomain = {
    gyro: sanitizeDomainScenario(rawBy.gyro, defaults.byDomain.gyro),
    accel: sanitizeDomainScenario(rawBy.accel, defaults.byDomain.accel),
    clock: sanitizeDomainScenario(rawBy.clock, defaults.byDomain.clock),
  };

  const driftKnowledge = o.driftKnowledge === null ? null : isNonNegative(o.driftKnowledge) ? o.driftKnowledge : defaults.driftKnowledge;
  const temperature = sanitizeTemperature(o.temperature, defaults.temperature);
  const includeThermal = typeof o.includeThermal === 'boolean' ? o.includeThermal : defaults.includeThermal;
  const Tm = o.Tm === 'auto' ? 'auto' : isPositive(o.Tm) ? o.Tm : defaults.Tm;

  const filteredMethods = Array.isArray(o.estimateMethods)
    ? o.estimateMethods.filter((m): m is EstimateMethod => VALID_ESTIMATE_METHODS.has(m as EstimateMethod))
    : [];
  const estimateMethods = filteredMethods.length > 0 ? filteredMethods : defaults.estimateMethods;

  const devKind = VALID_DEV_KINDS.has(o.devKind as DevKind) ? (o.devKind as DevKind) : defaults.devKind;
  const compareBy = VALID_COMPARE_BY.has(o.compareBy as CompareBy) ? (o.compareBy as CompareBy) : defaults.compareBy;
  const compareMethod = VALID_ESTIMATE_METHODS.has(o.compareMethod as EstimateMethod) ? (o.compareMethod as EstimateMethod) : defaults.compareMethod;
  const compare = sanitizeCompare(o.compare, defaults.compare);

  return { runs, seed, byDomain, driftKnowledge, temperature, includeThermal, Tm, estimateMethods, devKind, compareBy, compareMethod, compare };
}

export function defaultState(): AppState {
  const pick = (id: string) => fromPreset(PRESETS.find(p => p.id === id)!);
  return {
    bench: [pick('lsm6dsl-gyro'), pick('csac'), pick('ocxo')],
    selected: 'lsm6dsl-gyro',
    scenario: {
      runs: 200, seed: 1,
      byDomain: defaultDomainScenarios(),
      driftKnowledge: null,
      temperature: { kind: 'none' }, includeThermal: true,
      Tm: 'auto', estimateMethods: ['fudge', 'constant'],
      devKind: 'adev',
      compareBy: 'strategy', compareMethod: 'constant',
      compare: { dut: 'csac', ref: 'ocxo', osc: 'ocxo', leak: 0, floorQ: 1e-12 },
    },
    view: 'adev',
  };
}
