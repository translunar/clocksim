export interface Coefs { Q: number; F: number; N: number; B: number; K: number; D: number; R: number }
export type DevKind = 'adev' | 'mdev' | 'hdev';
export interface DevResult { tau: Float64Array; dev: Float64Array; count: Int32Array; lo: Float64Array; hi: Float64Array }

export const FLICKER_FLOOR = Math.sqrt(2 * Math.LN2 / Math.PI); // 0.664

export function frequencyToPhase(y: Float64Array, dt: number): Float64Array {
  const x = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) x[i + 1] = x[i]! + y[i]! * dt;
  return x;
}

export function logSpacedM(nPhase: number, perDecade = 8, maxFrac = 0.1): number[] {
  const maxM = Math.max(1, Math.floor((nPhase - 1) * maxFrac));
  const out: number[] = [];
  let last = 0;
  for (let e = 0; ; e++) {
    const m = Math.round(Math.pow(10, e / perDecade));
    if (m > maxM) break;
    if (m > last) { out.push(m); last = m; }
  }
  return out;
}

/** Howe–Allan–Barnes white-FM approximation of equivalent degrees of freedom for overlapping estimators. */
export function edfApprox(nPhase: number, m: number): number {
  const N = nPhase;
  const e = (3 * (N - 1) / (2 * m) - 2 * (N - 2) / N) * (4 * m * m) / (4 * m * m + 5);
  return Math.max(1, e);
}

/** chi-square quantile via Wilson–Hilferty. */
function chi2Quantile(p: number, k: number): number {
  const z = p > 0.5 ? 1 : -1; // 68% band: z = ±1
  const t = 1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k));
  return k * t * t * t;
}

function withBounds(tau: Float64Array, dev: Float64Array, count: Int32Array, nPhase: number, ms: number[]): DevResult {
  const lo = new Float64Array(dev.length), hi = new Float64Array(dev.length);
  for (let i = 0; i < dev.length; i++) {
    const edf = edfApprox(nPhase, ms[i]!);
    lo[i] = dev[i]! * Math.sqrt(edf / chi2Quantile(0.84, edf));
    hi[i] = dev[i]! * Math.sqrt(edf / chi2Quantile(0.16, edf));
  }
  return { tau, dev, count, lo, hi };
}

/** Overlapping Allan deviation on phase data x (seconds or radians), sample interval dt. */
export function oadev(x: Float64Array, dt: number, ms: number[]): DevResult {
  const N = x.length;
  const tau = new Float64Array(ms.length), dev = new Float64Array(ms.length), count = new Int32Array(ms.length);
  ms.forEach((m, i) => {
    const n = N - 2 * m;
    let s = 0;
    for (let j = 0; j < n; j++) { const d = x[j + 2 * m]! - 2 * x[j + m]! + x[j]!; s += d * d; }
    const t = m * dt;
    tau[i] = t; count[i] = n; dev[i] = Math.sqrt(s / (2 * n * t * t));
  });
  return withBounds(tau, dev, count, N, ms);
}

/** Modified Allan deviation on phase data. */
export function mdev(x: Float64Array, dt: number, ms: number[]): DevResult {
  const N = x.length;
  const tau = new Float64Array(ms.length), dev = new Float64Array(ms.length), count = new Int32Array(ms.length);
  ms.forEach((m, i) => {
    const n = N - 3 * m + 1;
    // running sum of second differences over a window of m
    let v = 0;
    for (let j = 0; j < m; j++) v += x[j + 2 * m]! - 2 * x[j + m]! + x[j]!;
    let s = v * v;
    for (let j = 1; j < n; j++) {
      v += (x[j + 3 * m - 1]! - 2 * x[j + 2 * m - 1]! + x[j + m - 1]!) - (x[j - 1 + 2 * m]! - 2 * x[j - 1 + m]! + x[j - 1]!);
      s += v * v;
    }
    const t = m * dt;
    tau[i] = t; count[i] = n; dev[i] = Math.sqrt(s / (2 * m * m * t * t * n));
  });
  return withBounds(tau, dev, count, N, ms);
}

/** Overlapping Hadamard deviation on phase data. */
export function ohdev(x: Float64Array, dt: number, ms: number[]): DevResult {
  const N = x.length;
  const tau = new Float64Array(ms.length), dev = new Float64Array(ms.length), count = new Int32Array(ms.length);
  ms.forEach((m, i) => {
    const n = N - 3 * m;
    let s = 0;
    for (let j = 0; j < n; j++) { const d = x[j + 3 * m]! - 3 * x[j + 2 * m]! + 3 * x[j + m]! - x[j]!; s += d * d; }
    const t = m * dt;
    tau[i] = t; count[i] = n; dev[i] = Math.sqrt(s / (6 * n * t * t));
  });
  return withBounds(tau, dev, count, N, ms);
}

export function deviation(kind: DevKind, x: Float64Array, dt: number, ms: number[]): DevResult {
  return kind === 'adev' ? oadev(x, dt, ms) : kind === 'mdev' ? mdev(x, dt, ms) : ohdev(x, dt, ms);
}

/** Per-coefficient ADEV asymptotes (sigma, not variance). */
export function analyticAdevTerms(c: Coefs, taus: ArrayLike<number>): Record<keyof Coefs, Float64Array> {
  const n = taus.length;
  const r = { Q: new Float64Array(n), F: new Float64Array(n), N: new Float64Array(n), B: new Float64Array(n), K: new Float64Array(n), D: new Float64Array(n), R: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const t = taus[i]!;
    r.Q[i] = Math.sqrt(3) * c.Q / t;
    r.F[i] = c.F / t;
    r.N[i] = c.N / Math.sqrt(t);
    r.B[i] = FLICKER_FLOOR * c.B;
    r.K[i] = c.K * Math.sqrt(t / 3);
    r.D[i] = c.D * Math.sqrt(23 / 60 * t * t * t);
    r.R[i] = c.R * t / Math.SQRT2;
  }
  return r;
}

export function analyticAdev(c: Coefs, taus: ArrayLike<number>): Float64Array {
  const terms = analyticAdevTerms(c, taus);
  const out = new Float64Array(taus.length);
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (const k of Object.keys(terms) as (keyof Coefs)[]) s += terms[k][i]! ** 2;
    out[i] = Math.sqrt(s);
  }
  return out;
}
