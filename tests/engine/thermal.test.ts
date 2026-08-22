import { describe, it, expect } from 'vitest';
import { ambient, deviceTemperature } from '../../src/engine/thermal';

describe('thermal', () => {
  it('profiles', () => {
    expect(ambient({ kind: 'none' }, 50)).toBe(0);
    expect(ambient({ kind: 'step', amplitude: 5, at: 10 }, 9)).toBe(0);
    expect(ambient({ kind: 'step', amplitude: 5, at: 10 }, 10)).toBe(5);
    expect(ambient({ kind: 'ramp', rate: 0.1 }, 20)).toBeCloseTo(2, 12);
    expect(ambient({ kind: 'sinusoid', amplitude: 3, period: 100 }, 25)).toBeCloseTo(3, 12);
  });
  it('no lag follows ambient exactly', () => {
    const T = deviceTemperature({ kind: 'ramp', rate: 1 }, 0, 0.5, 5);
    expect(Array.from(T)).toEqual([0, 0.5, 1, 1.5, 2]);
  });
  it('first-order lag step response reaches 63% at tauTh', () => {
    const tau = 100, dt = 0.01, n = Math.round(tau / dt) + 1;
    const T = deviceTemperature({ kind: 'step', amplitude: 10, at: 0 }, tau, dt, n);
    expect(T[n - 1]! / 10).toBeCloseTo(1 - Math.exp(-1), 2);
  });
});
