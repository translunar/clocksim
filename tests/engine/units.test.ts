import { describe, it, expect } from 'vitest';
import { toSI, fromSI, tempcoToSI, ERROR_UNIT } from '../../src/engine/units';

const D2R = Math.PI / 180;

describe('units', () => {
  it('gyro datasheet -> SI', () => {
    const si = toSI('gyro', { Q: 3600, F: 0, N: 60, B: 3600, K: 3600 * 60, D: 0, R: 3600 * 3600 });
    expect(si.Q).toBeCloseTo(D2R, 12);       // 3600 arcsec = 1 deg
    expect(si.N).toBeCloseTo(D2R, 12);       // 60 deg/sqrt(h) = 1 deg/sqrt(s)
    expect(si.B).toBeCloseTo(D2R, 12);       // 3600 deg/h = 1 deg/s
    expect(si.K).toBeCloseTo(D2R, 12);       // 1 deg/s/sqrt(s)
    expect(si.R).toBeCloseTo(D2R, 12);       // 1 deg/s^2
  });
  it('accel datasheet -> SI', () => {
    const si = toSI('accel', { Q: 0.1, F: 0, N: 1e6, B: 1e6, K: 60e6, D: 0, R: 3600e6 });
    expect(si.Q).toBe(0.1);
    expect(si.N).toBeCloseTo(9.80665, 9);
    expect(si.B).toBeCloseTo(9.80665, 9);
    expect(si.K).toBeCloseTo(9.80665, 9);
    expect(si.R).toBeCloseTo(9.80665, 9);
  });
  it('clock datasheet -> SI', () => {
    const si = toSI('clock', { Q: 10, F: 0, N: 1e-12, B: 1e-13, K: 1e-14, D: 0, R: 86400e-15 });
    expect(si.Q).toBeCloseTo(10e-9, 18);
    expect(si.N).toBe(1e-12);
    expect(si.B).toBeCloseTo(1e-13 / Math.sqrt(2 * Math.LN2 / Math.PI), 24);
    expect(si.K).toBeCloseTo(1e-14 * Math.sqrt(3), 24);
    expect(si.R).toBeCloseTo(1e-15, 27);
  });
  it('round-trips', () => {
    for (const d of ['gyro', 'accel', 'clock'] as const) {
      const c = { Q: 1.5, F: 0.2, N: 2.5, B: 3.5, K: 4.5, D: 0.7, R: 5.5 };
      const back = fromSI(d, toSI(d, c));
      for (const k of Object.keys(c) as (keyof typeof c)[]) expect(back[k]).toBeCloseTo(c[k], 9);
    }
  });
  it('tempco and error units', () => {
    expect(tempcoToSI('gyro', 3600)).toBeCloseTo(D2R, 12);  // 3600 deg/h/K = 1 deg/s/K
    expect(tempcoToSI('clock', 1)).toBe(1e-9);               // ppb/K
    expect(tempcoToSI('accel', 1e6)).toBeCloseTo(9.80665, 9);
    expect(ERROR_UNIT.gyro.fromSI(Math.PI)).toBeCloseTo(180, 9);
    expect(ERROR_UNIT.clock.fromSI(1e-9)).toBeCloseTo(1, 9);
    expect(ERROR_UNIT.accel.fromSI(2)).toBe(2);
  });
});
