import { Prng } from './prng';
import { powerLaw, gaussMarkovSum } from './noise';
import type { Coefs } from './deviations';
import type { Domain } from './units';
import { deviceTemperature, type TempProfile, type Thermal } from './thermal';

export interface DeviceSpec {
  id: string;
  name: string;
  domain: Domain;
  states: 2 | 3;
  coefs: Coefs;              // SI
  flickerMode: 'exact' | 'gmSum';
  gmTaus: number[];          // correlation times for gmSum mode (s)
  thermal: Thermal | null;   // SI: rate-units per K, seconds
  source: string;
}

export interface SimOptions {
  dt: number;
  n: number;
  profile: TempProfile;
  includeThermal: boolean;
  /** [error offset, level-1 offset (bias / frequency / velocity), level-2 offset (drift / accel bias)] */
  initial: number[];
}

export interface SimResult { dt: number; y: Float64Array; error: Float64Array; thermalRate: Float64Array | null }

/** Integrations from the rate-like series to the error quantity. */
export function errorLevel(domain: Domain): 1 | 2 { return domain === 'accel' ? 2 : 1; }

/** Per-sample white-driver variances for each power-law term (see plan conventions). */
export function qdFor(c: Coefs, dt: number) {
  return { Q: c.Q * c.Q / (dt * dt), F: c.F * c.F / (dt * dt), N: c.N * c.N / dt, B: c.B * c.B, K: c.K * c.K * dt, D: c.D * c.D * dt };
}

function thermalRate(spec: DeviceSpec, o: SimOptions): Float64Array | null {
  if (!spec.thermal || !o.includeThermal || o.profile.kind === 'none') return null;
  const T = deviceTemperature(o.profile, spec.thermal.tauTh, o.dt, o.n);
  for (let i = 0; i < o.n; i++) T[i] = T[i]! * spec.thermal.tempco;
  return T;
}

/**
 * Rate-like series y: sum of all noise terms + drift + thermal + constant bias offset.
 * For accel, initial[2] is the accelerometer bias; for clock 3-state, initial[2] is the initial drift
 * (added to R); for gyro/2-state clock, initial[1] is the constant bias / frequency offset.
 *
 * Computes the thermal-rate contribution once and returns it alongside y so `simulate()` doesn't
 * have to call `deviceTemperature` a second time to populate `SimResult.thermalRate`.
 */
function simulateRateWithThermal(spec: DeviceSpec, o: SimOptions, prng: Prng): { y: Float64Array; thermalRate: Float64Array | null } {
  const { n, dt } = o;
  const c = spec.coefs;
  const qd = qdFor(c, dt);
  const y = new Float64Array(n);
  const add = (s: Float64Array) => { for (let i = 0; i < n; i++) y[i] = y[i]! + s[i]!; };
  if (c.N > 0) add(powerLaw(0, n, qd.N, prng.fork(1)));
  if (c.K > 0) add(powerLaw(-2, n, qd.K, prng.fork(2)));
  if (c.Q > 0) add(powerLaw(2, n, qd.Q, prng.fork(3)));
  if (c.F > 0) add(powerLaw(1, n, qd.F, prng.fork(4)));
  if (c.B > 0) add(spec.flickerMode === 'exact' ? powerLaw(-1, n, qd.B, prng.fork(5)) : gaussMarkovSum(c.B, spec.gmTaus, n, dt, prng.fork(5)));
  if (c.D > 0) { const w = powerLaw(-2, n, qd.D, prng.fork(6)); let acc = 0; for (let i = 0; i < n; i++) { acc += w[i]! * dt; y[i] = y[i]! + acc; } }
  const levelOffset = spec.domain === 'accel' || spec.states === 3 ? (o.initial[2] ?? 0) : 0;
  const biasOffset = spec.domain === 'accel' ? levelOffset : (o.initial[1] ?? 0);
  const drift0 = spec.domain !== 'accel' && spec.states === 3 ? levelOffset : 0;
  for (let i = 0; i < n; i++) y[i] = y[i]! + biasOffset + (c.R + drift0) * i * dt;
  const th = thermalRate(spec, o);
  if (th) add(th);
  return { y, thermalRate: th };
}

export function simulateRate(spec: DeviceSpec, o: SimOptions, prng: Prng): Float64Array {
  return simulateRateWithThermal(spec, o, prng).y;
}

function integrate(y: Float64Array, dt: number, x0: number): Float64Array {
  const out = new Float64Array(y.length);
  let acc = x0;
  for (let i = 0; i < y.length; i++) { out[i] = acc; acc += y[i]! * dt; }
  return out;
}

export function simulate(spec: DeviceSpec, o: SimOptions, prng: Prng): SimResult {
  const { y, thermalRate: th } = simulateRateWithThermal(spec, o, prng);
  let error: Float64Array;
  if (errorLevel(spec.domain) === 1) {
    error = integrate(y, o.dt, o.initial[0] ?? 0);
  } else {
    const v = integrate(y, o.dt, o.initial[1] ?? 0);
    error = integrate(v, o.dt, o.initial[0] ?? 0);
  }
  return { dt: o.dt, y, error, thermalRate: th };
}

/** DMTD measurement: phase difference plus leaked offset-oscillator phase plus a white-PM floor. */
export function comparePhase(dut: Float64Array, ref: Float64Array, osc: Float64Array, leak: number, floorQ: number, prng: Prng): Float64Array {
  const n = dut.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = dut[i]! - ref[i]! + leak * osc[i]! + (floorQ > 0 ? floorQ * prng.gaussian() : 0);
  return out;
}
