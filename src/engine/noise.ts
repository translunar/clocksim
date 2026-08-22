import { Prng } from './prng';
import { convolveReal } from './fft';

/** Exponent of the one-sided rate PSD, S_y(f) ∝ f^alpha. +2 white PM, +1 flicker PM, 0 white FM, -1 flicker FM, -2 RW FM. */
export type Alpha = 2 | 1 | 0 | -1 | -2;

/** Kasdin (1995) fractional-difference filter coefficients for a rate series. */
export function kasdinCoefficients(alpha: Alpha, n: number): Float64Array {
  const h = new Float64Array(n);
  h[0] = 1;
  for (let k = 1; k < n; k++) h[k] = h[k - 1]! * (k - 1 - alpha / 2) / k + 0; // +0 normalizes -0 (e.g. alpha=2, k=2)
  return h;
}

/**
 * Power-law noise of length n. `qd` is the per-sample variance of the white driver.
 * See the plan's conventions table for how qd maps to N, B, K, Q, F.
 */
export function powerLaw(alpha: Alpha, n: number, qd: number, prng: Prng): Float64Array {
  const w = prng.fill(new Float64Array(n));
  const s = Math.sqrt(qd);
  for (let i = 0; i < n; i++) w[i] = w[i]! * s;
  if (alpha === 0) return w;
  if (alpha === -2) { for (let i = 1; i < n; i++) w[i] = w[i]! + w[i - 1]!; return w; }
  if (alpha === 2) { for (let i = n - 1; i >= 1; i--) w[i] = w[i]! - w[i - 1]!; return w; }
  return convolveReal(w, kasdinCoefficients(alpha, n), n);
}

/** Analytic Allan variance of a first-order Gauss-Markov process (IEEE Std 952). */
export function gmAvar(sigma: number, tauC: number, tau: number): number {
  const x = tau / tauC;
  return (sigma * sigma / (x * x)) * (2 * x - 3 + 4 * Math.exp(-x) - Math.exp(-2 * x));
}

/**
 * Sum of first-order Gauss-Markov processes with correlation times `taus`, each started from its
 * stationary distribution, with a common per-component variance chosen so that the summed Allan
 * variance at the geometric centre of the band equals (0.664·sigma)² — i.e. the flicker floor a
 * device with bias instability `sigma` would show. This is the "what the filter designer models"
 * approximation of flicker, not flicker itself.
 */
export function gaussMarkovSum(sigma: number, taus: number[], n: number, dt: number, prng: Prng): Float64Array {
  if (taus.length === 0) return new Float64Array(n);
  const centre = Math.exp(taus.reduce((a, t) => a + Math.log(t), 0) / taus.length);
  let unitSum = 0;
  for (const tc of taus) unitSum += gmAvar(1, tc, centre);
  const floorVar = (0.664 * sigma) ** 2;
  const sigmaI = Math.sqrt(floorVar / unitSum);
  const out = new Float64Array(n);
  taus.forEach((tc, idx) => {
    const p = prng.fork(idx);
    const phi = Math.exp(-dt / tc);
    const drive = sigmaI * Math.sqrt(1 - phi * phi);
    let b = sigmaI * p.gaussian();
    for (let i = 0; i < n; i++) { out[i] = out[i]! + b; b = phi * b + drive * p.gaussian(); }
  });
  return out;
}
