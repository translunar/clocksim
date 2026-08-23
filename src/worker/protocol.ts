import type { DeviceSpec } from '../engine/bench';
import type { DevKind, Coefs } from '../engine/deviations';
import type { TempProfile } from '../engine/thermal';
import type { MCRequest } from '../engine/montecarlo';

export const SAMPLE_TRAJECTORIES = 25;

export type WorkerRequest =
  | { type: 'adev'; id: string; spec: DeviceSpec; dt: number; n: number; seed: number; kind: DevKind; profile: TempProfile; includeThermal: boolean }
  | { type: 'compare'; id: string; dut: DeviceSpec; ref: DeviceSpec; osc: DeviceSpec; leak: number; floorQ: number; dt: number; n: number; seed: number; kind: DevKind }
  | { type: 'mc'; id: string; req: MCRequest; batch: number }
  | { type: 'cancel'; id: string };

export type WorkerResponse =
  | { type: 'adev'; id: string; tau: Float64Array; dev: Float64Array; lo: Float64Array; hi: Float64Array; analytic: Record<keyof Coefs, Float64Array>; analyticTotal: Float64Array }
  | { type: 'compare'; id: string; tau: Float64Array; dut: Float64Array; ref: Float64Array; osc: Float64Array; measured: Float64Array }
  | { type: 'mc-progress'; id: string; runs: number; times: Float64Array; p50: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array; sample: Float64Array[] }
  | { type: 'mc-done'; id: string; runs: number; times: Float64Array; p50: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array; sample: Float64Array[] }
  | { type: 'error'; id: string; message: string };
