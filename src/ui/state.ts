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
