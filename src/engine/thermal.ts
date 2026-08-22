export type TempProfile =
  | { kind: 'none' }
  | { kind: 'step'; amplitude: number; at: number }
  | { kind: 'ramp'; rate: number }
  | { kind: 'sinusoid'; amplitude: number; period: number };

export interface Thermal { tempco: number; tauTh: number }

/** Ambient temperature deviation from reference (K) at time t (s). */
export function ambient(p: TempProfile, t: number): number {
  switch (p.kind) {
    case 'none': return 0;
    case 'step': return t >= p.at ? p.amplitude : 0;
    case 'ramp': return p.rate * t;
    case 'sinusoid': return p.amplitude * Math.sin(2 * Math.PI * t / p.period);
  }
}

/** Device temperature deviation through a first-order lag with time constant tauTh (0 = none). Exact discretization. */
export function deviceTemperature(p: TempProfile, tauTh: number, dt: number, n: number): Float64Array {
  const out = new Float64Array(n);
  if (tauTh <= 0) { for (let i = 0; i < n; i++) out[i] = ambient(p, i * dt); return out; }
  const a = Math.exp(-dt / tauTh);
  let T = 0;
  for (let i = 0; i < n; i++) { out[i] = T; T = a * T + (1 - a) * ambient(p, i * dt); }
  return out;
}
