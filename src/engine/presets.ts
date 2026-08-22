import type { Coefs } from './deviations';
import type { DeviceSpec } from './bench';
import { toSI, tempcoToSI, type Domain } from './units';

export interface Preset {
  id: string; name: string; domain: Domain; states: 2 | 3;
  coefs: Coefs; thermal: { tempco: number; tauTh: number } | null;
  source: string; inferred: (keyof Coefs | 'tempco')[]; placeholder?: boolean;
}

const COEF_KEYS: (keyof Coefs)[] = ['Q', 'F', 'N', 'B', 'K', 'D', 'R'];
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validatePreset(p: unknown): p is Preset {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.source !== 'string') return false;
  if (o.domain !== 'gyro' && o.domain !== 'accel' && o.domain !== 'clock') return false;
  if (o.states !== 2 && o.states !== 3) return false;
  if (o.domain === 'accel' && o.states !== 3) return false;
  const c = o.coefs as Record<string, unknown> | undefined;
  if (!c || !COEF_KEYS.every(k => isNum(c[k]))) return false;
  if (o.thermal !== null) {
    const t = o.thermal as Record<string, unknown> | undefined;
    if (!t || !isNum(t.tempco) || !isNum(t.tauTh)) return false;
  }
  if (!Array.isArray(o.inferred)) return false;
  return true;
}

export function specFromDatasheet(p: { id: string; name: string; domain: Domain; states: 2 | 3; coefs: Coefs; thermal: { tempco: number; tauTh: number } | null; source: string }): DeviceSpec {
  return {
    id: p.id, name: p.name, domain: p.domain, states: p.states,
    coefs: toSI(p.domain, p.coefs), flickerMode: 'exact', gmTaus: [10, 100, 1000],
    thermal: p.thermal ? { tempco: tempcoToSI(p.domain, p.thermal.tempco), tauTh: p.thermal.tauTh } : null,
    source: p.source,
  };
}

export function presetToSpec(p: Preset): DeviceSpec { return specFromDatasheet(p); }
