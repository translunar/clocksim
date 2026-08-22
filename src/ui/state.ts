import type { Preset } from '../engine/presets';
import { specFromDatasheet, validatePreset } from '../engine/presets';
import type { DeviceSpec } from '../engine/bench';
import type { FixQuality, EstimateMethod } from '../engine/models';
import type { TempProfile } from '../engine/thermal';
import type { DevKind } from '../engine/deviations';
import { PRESETS } from '../presets';

export interface BenchDevice extends Preset { flickerMode: 'exact' | 'gmSum'; gmTaus: number[] }
export interface Requirement { id: string; value: number; sigma: 1 | 2 | 3; duration: number }
export interface Scenario {
  duration: number; dt: number; runs: number; seed: number;
  fix: FixQuality; driftKnowledge: number | null;
  temperature: TempProfile; includeThermal: boolean;
  Tm: number | 'auto'; estimateMethods: EstimateMethod[];
  requirements: Requirement[]; activeRequirement: string | null;
  devKind: DevKind;
  compare: { dut: string | null; ref: string | null; osc: string | null; leak: number; floorQ: number };
}
export type View = 'adev' | 'growth' | 'compare' | 'sizing';
export interface AppState { bench: BenchDevice[]; selected: string | null; scenario: Scenario; view: View }

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

export function effectiveTm(s: Scenario): number {
  if (s.Tm !== 'auto') return s.Tm;
  const r = s.requirements.find(x => x.id === s.activeRequirement) ?? s.requirements[0];
  return r ? r.duration : s.duration;
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

/**
 * Rebuilds a Scenario from untrusted input (e.g. a URL hash), starting from `defaults` and
 * copying only well-formed fields; anything malformed keeps the corresponding default. Never
 * throws — every branch has a safe fallback, so callers (fromHash) don't need a try/catch here.
 */
export function sanitizeScenario(raw: unknown, defaults: Scenario): Scenario {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const duration = isPositive(o.duration) ? o.duration : defaults.duration;
  const dt = isPositive(o.dt) ? o.dt : defaults.dt;
  const runs = isPositive(o.runs) && Number.isInteger(o.runs) ? o.runs : defaults.runs;
  const seed = isFiniteNum(o.seed) ? o.seed : defaults.seed;

  const fix = sanitizeFix(o.fix, defaults.fix);
  const driftKnowledge = o.driftKnowledge === null ? null : isNonNegative(o.driftKnowledge) ? o.driftKnowledge : defaults.driftKnowledge;
  const temperature = sanitizeTemperature(o.temperature, defaults.temperature);
  const includeThermal = typeof o.includeThermal === 'boolean' ? o.includeThermal : defaults.includeThermal;
  const Tm = o.Tm === 'auto' ? 'auto' : isPositive(o.Tm) ? o.Tm : defaults.Tm;

  const filteredMethods = Array.isArray(o.estimateMethods)
    ? o.estimateMethods.filter((m): m is EstimateMethod => VALID_ESTIMATE_METHODS.has(m as EstimateMethod))
    : [];
  const estimateMethods = filteredMethods.length > 0 ? filteredMethods : defaults.estimateMethods;

  const requirements = sanitizeRequirements(o.requirements, defaults.requirements);
  const activeRequirement =
    typeof o.activeRequirement === 'string' && requirements.some(r => r.id === o.activeRequirement)
      ? o.activeRequirement
      : (requirements[0]?.id ?? null);

  const devKind = VALID_DEV_KINDS.has(o.devKind as DevKind) ? (o.devKind as DevKind) : defaults.devKind;
  const compare = sanitizeCompare(o.compare, defaults.compare);

  return { duration, dt, runs, seed, fix, driftKnowledge, temperature, includeThermal, Tm, estimateMethods, requirements, activeRequirement, devKind, compare };
}

export function defaultState(): AppState {
  const pick = (id: string) => fromPreset(PRESETS.find(p => p.id === id)!);
  return {
    bench: [pick('lsm6dsl-gyro'), pick('csac'), pick('ocxo')],
    selected: 'lsm6dsl-gyro',
    scenario: {
      duration: 3600, dt: 0.1, runs: 200, seed: 1,
      fix: { sigma: 333e-6, cadence: 0.5, bias: 0 }, driftKnowledge: null,
      temperature: { kind: 'none' }, includeThermal: true,
      Tm: 'auto', estimateMethods: ['fudge', 'constant', 'gm'],
      requirements: [{ id: 'r1', value: Math.PI / 180, sigma: 3, duration: 600 }], activeRequirement: 'r1',
      devKind: 'adev',
      compare: { dut: 'csac', ref: 'ocxo', osc: 'ocxo', leak: 0, floorQ: 1e-12 },
    },
    view: 'adev',
  };
}
