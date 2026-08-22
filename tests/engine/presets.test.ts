import { describe, it, expect } from 'vitest';
import { PRESETS } from '../../src/presets';
import { presetToSpec, validatePreset } from '../../src/engine/presets';

describe('presets', () => {
  it('all presets validate and have unique ids', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(validatePreset(p)).toBe(true);
  });
  it('convert to SI specs', () => {
    const g = presetToSpec(PRESETS.find(p => p.id === 'lsm6dsl-gyro')!);
    expect(g.coefs.N).toBeCloseTo(0.24 * Math.PI / 180 / 60, 12);
    expect(g.thermal!.tempco).toBeCloseTo(36 * Math.PI / 180 / 3600, 12);
    const c = presetToSpec(PRESETS.find(p => p.id === 'cesium-5071a')!);
    expect(c.coefs.N).toBe(5e-12);
    expect(c.coefs.B).toBeCloseTo(5e-15 / 0.664, 3);
  });
  it('rejects malformed presets', () => {
    expect(validatePreset({ id: 'x' })).toBe(false);
    expect(validatePreset({ id: 'x', name: 'x', domain: 'laser', states: 2, coefs: { Q: 0, F: 0, N: 0, B: 0, K: 0, D: 0, R: 0 }, thermal: null, source: '', inferred: [] })).toBe(false);
  });
});
