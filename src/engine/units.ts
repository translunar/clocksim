import type { Coefs } from './deviations';
import { FLICKER_FLOOR } from './deviations';

export type Domain = 'gyro' | 'accel' | 'clock';

const D2R = Math.PI / 180;
const G = 9.80665;
const H = 3600, SQRT_H = 60;

export const DATASHEET_UNITS: Record<Domain, Record<keyof Coefs | 'tempco', string>> = {
  gyro:  { Q: 'arcsec', F: 'arcsec', N: '°/√h', B: '°/h', K: '°/h/√h', D: '°/h²/√h', R: '°/h²', tempco: '°/h/K' },
  accel: { Q: 'm/s', F: 'm/s', N: 'µg/√Hz', B: 'µg', K: 'µg/√h', D: 'µg/h/√h', R: 'µg/h', tempco: 'µg/K' },
  clock: { Q: 'ns', F: 'ns', N: 'σy(1 s)', B: 'σy floor', K: 'σy(1 s)', D: 'σy(1 s)', R: 'Δf/f per day', tempco: 'ppb/K' },
};

/** Multiplicative factors datasheet → SI for the linear fields. */
const FACTORS: Record<Domain, Record<keyof Coefs, number>> = {
  gyro:  { Q: D2R / H, F: D2R / H, N: D2R / SQRT_H, B: D2R / H, K: D2R / H / SQRT_H, D: D2R / (H * H) / SQRT_H, R: D2R / (H * H) },
  accel: { Q: 1, F: 1, N: 1e-6 * G, B: 1e-6 * G, K: 1e-6 * G / SQRT_H, D: 1e-6 * G / H / SQRT_H, R: 1e-6 * G / H },
  clock: { Q: 1e-9, F: 1e-9, N: 1, B: 1 / FLICKER_FLOOR, K: Math.sqrt(3), D: 1 / Math.sqrt(23 / 60), R: 1 / 86400 },
};

export function toSI(domain: Domain, c: Coefs): Coefs {
  const f = FACTORS[domain];
  return { Q: c.Q * f.Q, F: c.F * f.F, N: c.N * f.N, B: c.B * f.B, K: c.K * f.K, D: c.D * f.D, R: c.R * f.R };
}

export function fromSI(domain: Domain, c: Coefs): Coefs {
  const f = FACTORS[domain];
  return { Q: c.Q / f.Q, F: c.F / f.F, N: c.N / f.N, B: c.B / f.B, K: c.K / f.K, D: c.D / f.D, R: c.R / f.R };
}

const TEMPCO: Record<Domain, number> = { gyro: D2R / H, accel: 1e-6 * G, clock: 1e-9 };
export function tempcoToSI(domain: Domain, v: number): number { return v * TEMPCO[domain]; }
export function tempcoFromSI(domain: Domain, v: number): number { return v / TEMPCO[domain]; }

/** Display of the top-level integrated error. */
export const ERROR_UNIT: Record<Domain, { label: string; fromSI: (v: number) => number; toSI: (v: number) => number }> = {
  gyro:  { label: 'deg', fromSI: v => v / D2R, toSI: v => v * D2R },
  accel: { label: 'm', fromSI: v => v, toSI: v => v },
  clock: { label: 'ns', fromSI: v => v * 1e9, toSI: v => v * 1e-9 },
};
