import type { DeviceSpec } from './bench';
import { errorLevel } from './bench';
import { deviceTemperature, type TempProfile } from './thermal';

export interface FixQuality { sigma: number; cadence: number; bias: number }
export interface InitialCov { p11: number; p12: number; p22: number; p13: number; p23: number; p33: number }
export type EstimateMethod = 'fudge' | 'constant' | 'gm' | 'fittedK';
export const ESTIMATE_METHODS: EstimateMethod[] = ['fudge', 'constant', 'gm', 'fittedK'];
export interface EstimateOptions {
  method: EstimateMethod;
  Tm: number;
  fix: FixQuality;
  driftKnowledge: number | null; // p33 for 3-state clocks (fractional-frequency-rate variance)
  dt: number;
  profile: TempProfile;
  includeThermal: boolean;
}
export type ContributionKey = 'initial' | 'Q' | 'N' | 'B' | 'K' | 'D' | 'R' | 'thermal';

/** Effective RW coefficient the model uses for the bias: real K plus, for `fudge`, the B²/Tm mapping. */
function kEffFor(spec: DeviceSpec, method: EstimateMethod, Tm: number): number {
  const K2 = spec.coefs.K ** 2;
  if (method === 'fudge') return Math.sqrt(K2 + spec.coefs.B ** 2 / Tm);
  return Math.sqrt(K2);
}

/**
 * Bayard steady-state post-fix covariance for level-1 devices (gyro, clock): r = Δ σ_fix²,
 * l = √(q1 + 2√(r q2)), p11 = √r l, p12 = √(r q2), p22 = √q2 l, with q1 = N², q2 = kEff².
 * For accel this is a v1 limitation, not a full 3-state steady state: only p11 = σ_fix² is set
 * (the position-fix variance), with no velocity or accel-bias uncertainty terms and no dependence
 * on fix cadence, driftKnowledge, or device noise — which is why steadyStateVsCadence returns a
 * constant for accel and the Sizing view excludes the accel domain entirely (see spec §3.9).
 */
export function initialCovariance(spec: DeviceSpec, fix: FixQuality, driftKnowledge: number | null, kEff: number): InitialCov {
  const q1 = spec.coefs.N ** 2, q2 = kEff ** 2;
  if (spec.domain === 'accel') {
    return { p11: fix.sigma ** 2, p12: 0, p22: 0, p13: 0, p23: 0, p33: 0 };
  }
  const r = fix.cadence * fix.sigma ** 2;
  const l = Math.sqrt(q1 + 2 * Math.sqrt(r * q2));
  return { p11: Math.sqrt(r) * l, p12: Math.sqrt(r * q2), p22: Math.sqrt(q2) * l, p13: 0, p23: 0, p33: spec.states === 3 && driftKnowledge ? driftKnowledge : 0 };
}

/**
 * Variance of ∫₀ᵗ b for a stationary Gauss-Markov b with variance s², correlation Tm.
 * Rewritten in x = t/Tm: 2 s² Tm² (x + expm1(-x)). Mathematically identical to
 * 2 s² Tm (t - Tm(1 - e^{-t/Tm})); that direct form catastrophically cancels for Tm >> t
 * (returns garbage, even negative, feeding sqrt(NaN) downstream). The expm1 form itself still
 * cancels below x ≈ 0.1 (5-decimal-digit-level relative error there), so below x = 0.03 a
 * 5-term Taylor series of x + expm1(-x) = x²/2 - x³/6 + x⁴/24 - x⁵/120 + x⁶/720 - … is used
 * instead; verified against a 50-digit reference that both branches agree to <1e-9 relative
 * at the x = 0.03 boundary.
 */
function gmOnce(s2: number, Tm: number, t: number): number {
  const x = t / Tm;
  const h = x < 0.03 ? x * x / 2 - x ** 3 / 6 + x ** 4 / 24 - x ** 5 / 120 + x ** 6 / 720 : x + Math.expm1(-x);
  return 2 * s2 * Tm * Tm * h;
}
/** Variance of ∫∫ b for the same process; same x = t/Tm rewrite and small-x Taylor guard as gmOnce. */
function gmTwice(s2: number, Tm: number, t: number): number {
  const x = t / Tm;
  const g = x < 0.03
    ? x ** 4 / 8 - x ** 5 / 30 + x ** 6 / 144 - x ** 7 / 840 + x ** 8 / 5760
    : x ** 3 / 3 - x ** 2 / 2 + 1 - (1 + x) * Math.exp(-x);
  return 2 * s2 * Tm ** 4 * g;
}

/** Variance of the error from white noise of intensity q injected `k` integrations above it: q t^(2k+1) / ((2k+1) (k!)²). */
function whiteVar(q: number, k: number, t: number): number {
  const fact = [1, 1, 2, 6, 24][k]!;
  return q * t ** (2 * k + 1) / ((2 * k + 1) * fact * fact);
}

function thermalError(spec: DeviceSpec, o: EstimateOptions, times: Float64Array): Float64Array {
  const out = new Float64Array(times.length);
  if (!spec.thermal || !o.includeThermal || o.profile.kind === 'none') return out;
  const tEnd = times[times.length - 1] ?? 0;
  const n = Math.max(2, Math.ceil(tEnd / o.dt) + 1);
  const T = deviceTemperature(o.profile, spec.thermal.tauTh, o.dt, n);
  const lvl = errorLevel(spec.domain);
  let acc1 = 0, acc2 = 0, j = 0;
  for (let i = 0; i < n; i++) {
    while (j < times.length && times[j]! <= i * o.dt + 1e-12) { out[j] = Math.abs(lvl === 1 ? acc1 : acc2); j++; }
    acc1 += spec.thermal.tempco * T[i]! * o.dt;
    acc2 += acc1 * o.dt;
  }
  while (j < times.length) { out[j] = Math.abs(lvl === 1 ? acc1 : acc2); j++; }
  return out;
}

/** σ-curves per contribution. Level 1 = gyro/clock (error = ∫y), level 2 = accel (error = ∫∫y). */
export function contributions(spec: DeviceSpec, o: EstimateOptions, times: Float64Array): Record<ContributionKey, Float64Array> {
  if (!(o.Tm > 0)) throw new Error('Tm must be > 0');
  const n = times.length;
  const c = spec.coefs;
  const lvl = errorLevel(spec.domain);
  const kEff = kEffFor(spec, o.method, o.Tm);
  const P = initialCovariance(spec, o.fix, o.driftKnowledge, kEff);
  const B2 = c.B ** 2;
  const out: Record<ContributionKey, Float64Array> = {
    initial: new Float64Array(n), Q: new Float64Array(n), N: new Float64Array(n), B: new Float64Array(n),
    K: new Float64Array(n), D: new Float64Array(n), R: new Float64Array(n), thermal: thermalError(spec, o, times),
  };
  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    // initial covariance propagated through the chain; constant-bias method adds B² to the bias state.
    const p22 = P.p22 + (o.method === 'constant' && lvl === 1 ? B2 : 0);
    const p33 = P.p33 + (o.method === 'constant' && lvl === 2 ? B2 : 0);
    const init = lvl === 1
      ? P.p11 + 2 * P.p12 * t + p22 * t * t + p33 * t ** 4 / 4 + o.fix.bias ** 2
      : P.p11 + 2 * P.p12 * t + (P.p22 + P.p13) * t * t + P.p23 * t ** 3 + p33 * t ** 4 / 4 + o.fix.bias ** 2;
    out.initial[i] = Math.sqrt(init);
    if (lvl === 1) {
      out.Q[i] = c.Q;                                   // bounded phase noise
      out.N[i] = Math.sqrt(whiteVar(c.N ** 2, 0, t));
      out.K[i] = Math.sqrt(whiteVar(kEff ** 2 - (o.method === 'fudge' ? B2 / o.Tm : 0), 1, t));
      out.D[i] = Math.sqrt(whiteVar(c.D ** 2, 2, t));
      out.R[i] = spec.states === 3 ? 0 : Math.abs(c.R) * t * t / 2;
      out.B[i] = o.method === 'fudge' ? Math.sqrt(whiteVar(B2 / o.Tm, 1, t))
               : o.method === 'constant' ? 0 /* folded into initial via p22 */
               : o.method === 'gm' ? Math.sqrt(gmOnce(B2, o.Tm, t)) : 0;
    } else {
      out.Q[i] = Math.sqrt(c.Q ** 2 * o.dt * t);        // white velocity noise → position RW
      out.N[i] = Math.sqrt(whiteVar(c.N ** 2, 1, t));
      out.K[i] = Math.sqrt(whiteVar(kEff ** 2 - (o.method === 'fudge' ? B2 / o.Tm : 0), 2, t));
      out.D[i] = Math.sqrt(whiteVar(c.D ** 2, 3, t));
      out.R[i] = Math.abs(c.R) * t ** 3 / 6;
      out.B[i] = o.method === 'fudge' ? Math.sqrt(whiteVar(B2 / o.Tm, 2, t))
               : o.method === 'constant' ? 0
               : o.method === 'gm' ? Math.sqrt(gmTwice(B2, o.Tm, t)) : 0;
    }
  }
  // For `constant`, report the B share explicitly so the stack is readable: move it out of `initial`.
  if (o.method === 'constant' && c.B > 0) {
    for (let i = 0; i < n; i++) {
      const t = times[i]!;
      const bTerm = lvl === 1 ? B2 * t * t : B2 * t ** 4 / 4;
      out.B[i] = Math.sqrt(bTerm);
      out.initial[i] = Math.sqrt(Math.max(0, out.initial[i]! ** 2 - bTerm));
    }
  }
  return out;
}

/**
 * RSS of every contribution except `thermal`. Thermal is deliberately excluded: per spec §3.4 and
 * the glossary, the analytic estimate methods never see flicker or thermal — thermal is truth-only,
 * shown in the contribution stack (and separately in the growth-view readout) so the user can see
 * what it's carrying that the estimate isn't, but it must not silently dominate the "estimate"
 * number the tool compares Monte Carlo truth against.
 */
export function estimateSigma(spec: DeviceSpec, o: EstimateOptions, times: Float64Array): Float64Array {
  const c = contributions(spec, o, times);
  const out = new Float64Array(times.length);
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (const k of Object.keys(c) as ContributionKey[]) { if (k === 'thermal') continue; s += c[k][i]! ** 2; }
    out[i] = Math.sqrt(s);
  }
  return out;
}

/** Exactly bayard_calc.m: the fudge method with no thermal. */
export function bayardSigma(spec: DeviceSpec, fix: FixQuality, Tm: number, times: Float64Array): Float64Array {
  return estimateSigma(spec, { method: 'fudge', Tm, fix, driftKnowledge: null, dt: 1, profile: { kind: 'none' }, includeThermal: false }, times);
}

/** First time at which sigma >= limit, log-log interpolated; null if never within `times`. */
export function timeToRequirement(times: Float64Array, sigma: Float64Array, limit: number): number | null {
  for (let i = 0; i < times.length; i++) {
    if (sigma[i]! >= limit) {
      if (i === 0) return times[0]!;
      if (times[i - 1]! <= 0) return times[i]!;
      const t0 = Math.log(times[i - 1]!), t1 = Math.log(times[i]!);
      const s0 = Math.log(Math.max(sigma[i - 1]!, 1e-300)), s1 = Math.log(sigma[i]!);
      const f = (Math.log(limit) - s0) / (s1 - s0);
      return Math.exp(t0 + f * (t1 - t0));
    }
  }
  return null;
}

/** Steady-state post-fix error √p11 as a function of fix cadence (level-1 devices, fudge mapping). */
export function steadyStateVsCadence(spec: DeviceSpec, fix: Omit<FixQuality, 'cadence'>, Tm: number, cadences: Float64Array): Float64Array {
  if (!(Tm > 0)) throw new Error('Tm must be > 0');
  const kEff = kEffFor(spec, 'fudge', Tm);
  const out = new Float64Array(cadences.length);
  for (let i = 0; i < cadences.length; i++) {
    const P = initialCovariance(spec, { ...fix, cadence: cadences[i]! }, null, kEff);
    out[i] = Math.sqrt(P.p11 + fix.bias ** 2);
  }
  return out;
}

/** τ at which curve A first rises above curve B (log-log interpolation on A's grid); null if never. */
export function crossover(tauA: Float64Array, devA: Float64Array, tauB: Float64Array, devB: Float64Array): number | null {
  const interpB = (tau: number): number | null => {
    if (tau < tauB[0]! || tau > tauB[tauB.length - 1]!) return null;
    for (let j = 1; j < tauB.length; j++) if (tau <= tauB[j]!) {
      const f = (Math.log(tau) - Math.log(tauB[j - 1]!)) / (Math.log(tauB[j]!) - Math.log(tauB[j - 1]!));
      return Math.exp(Math.log(devB[j - 1]!) + f * (Math.log(devB[j]!) - Math.log(devB[j - 1]!)));
    }
    return null;
  };
  let prev: number | null = null;
  for (let i = 0; i < tauA.length; i++) {
    const a = devA[i]!;
    const b = interpB(tauA[i]!);
    // A gap — out-of-range tau, or a non-finite/non-positive sample on either curve — can't be
    // logged or compared; treat it as a coverage gap and drop `prev` so a stale sign from before
    // the gap can never pair with a point after it to report a spurious crossing.
    if (b === null || !Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) { prev = null; continue; }
    const diff = Math.log(a) - Math.log(b);
    if (prev !== null && prev < 0 && diff >= 0) {
      const lo = tauA[i - 1]!, hi = tauA[i]!;
      const f = -prev / (diff - prev);
      // Clamp: the crossing is mathematically within [lo, hi]; log-space round-trip can overshoot by ~1ulp.
      return Math.min(hi, Math.max(lo, Math.exp(Math.log(lo) + f * (Math.log(hi) - Math.log(lo)))));
    }
    prev = diff;
  }
  return null;
}
