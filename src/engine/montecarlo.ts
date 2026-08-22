import { Prng } from './prng';
import { simulate, type DeviceSpec } from './bench';
import { initialCovariance, type FixQuality, type InitialCov } from './models';
import type { TempProfile } from './thermal';

export const PERCENTILES = { p68: 0.6827, p95: 0.9545, p997: 0.9973 } as const;

export interface MCRequest {
  spec: DeviceSpec; dt: number; duration: number; runs: number; seed: number;
  profile: TempProfile; includeThermal: boolean; fix: FixQuality; driftKnowledge: number | null; Tm: number;
}

/**
 * Log-spaced sample times in [dt, duration]: every point except the last is snapped to a multiple
 * of dt (so the caller can index a fixed-dt simulation with Math.round(t/dt)), and the last point
 * is exactly `duration` — never the dt-snapped neighbour, which can land past `duration` when
 * frac(duration/dt) > 0.5 and would otherwise silently stretch the grid beyond what was asked for
 * (callers that re-derive this grid from `duration` alone, e.g. a worker given the same duration,
 * must get back an array of the same length).
 */
export function logTimes(dt: number, duration: number, count = 64): Float64Array {
  const lo = Math.log(dt), hi = Math.log(duration);
  const set = new Set<number>();
  for (let i = 0; i < count; i++) {
    const t = Math.exp(lo + (hi - lo) * i / (count - 1));
    const snapped = Math.max(1, Math.round(t / dt)) * dt;
    if (snapped < duration) set.add(snapped);
  }
  set.add(duration);
  return Float64Array.from([...set].sort((a, b) => a - b));
}

/** Draw [e0, b0, d0] ~ N(0, P) via Cholesky (3x3, lower). */
export function drawInitial(P: InitialCov, prng: Prng): number[] {
  const a = [[P.p11, P.p12, P.p13], [P.p12, P.p22, P.p23], [P.p13, P.p23, P.p33]];
  const L = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
    let s = a[i]![j]!;
    for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
    L[i]![j] = i === j ? Math.sqrt(Math.max(0, s)) : (L[j]![j]! > 0 ? s / L[j]![j]! : 0);
  }
  const w = [prng.gaussian(), prng.gaussian(), prng.gaussian()];
  return [0, 1, 2].map(i => L[i]![0]! * w[0]! + L[i]![1]! * w[1]! + L[i]![2]! * w[2]!);
}

/** One Monte Carlo run: |error| sampled at `times`. Initial state drawn from the Bayard (fudge, Tm) covariance. */
export function runOne(req: MCRequest, times: Float64Array, runIndex: number): Float64Array {
  const prng = new Prng(req.seed).fork(1000 + runIndex);
  const kEff = Math.sqrt(req.spec.coefs.K ** 2 + req.spec.coefs.B ** 2 / req.Tm);
  const P = initialCovariance(req.spec, req.fix, req.driftKnowledge, kEff);
  const init = drawInitial(P, prng.fork(0));
  const n = Math.round(req.duration / req.dt) + 1;
  const res = simulate(req.spec, { dt: req.dt, n, profile: req.profile, includeThermal: req.includeThermal, initial: init }, prng.fork(1));
  // A 3-state device carries an explicit drift state, so the *nominal* aging rate R is treated
  // as known and compensated on both sides: models.ts zeroes contributions.R for states===3, and
  // here we subtract the same deterministic R*t^2/2 from the simulated truth. What's left in the
  // budget is only the *uncertainty* of that estimate — the driftKnowledge (p33) draw baked into
  // `init` above. For a 2-state device there is no drift state to carry the compensation, so the
  // aging is left in as unmodelled and shows up as the familiar R*t^2/2 growth.
  const compensateAging = req.spec.domain !== 'accel' && req.spec.states === 3;
  const out = new Float64Array(times.length);
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    const aging = compensateAging ? req.spec.coefs.R * t * t / 2 : 0;
    out[i] = Math.abs(res.error[Math.min(n - 1, Math.round(t / req.dt))]! + req.fix.bias - aging);
  }
  return out;
}

export class Envelope {
  runs = 0;
  private samples: number[][];
  constructor(public times: Float64Array) { this.samples = Array.from({ length: times.length }, () => []); }
  add(absErr: Float64Array): void { for (let i = 0; i < absErr.length; i++) this.samples[i]!.push(absErr[i]!); this.runs++; }
  percentile(p: number): Float64Array {
    const out = new Float64Array(this.times.length);
    for (let i = 0; i < out.length; i++) {
      const s = [...this.samples[i]!].sort((a, b) => a - b);
      out[i] = s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]! : 0;
    }
    return out;
  }
}
