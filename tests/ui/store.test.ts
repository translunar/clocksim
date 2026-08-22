import { describe, it, expect } from 'vitest';
import { Store, toHash, fromHash } from '../../src/ui/store';
import { defaultState, effectiveTm, benchToSpec } from '../../src/ui/state';

describe('store', () => {
  it('round-trips through the hash', () => {
    const s = defaultState();
    s.scenario.seed = 99; s.scenario.Tm = 1234;
    const back = fromHash(toHash(s));
    expect(back).not.toBeNull();
    expect(back!.scenario.seed).toBe(99);
    expect(back!.scenario.Tm).toBe(1234);
    expect(back!.bench.map(d => d.id)).toEqual(s.bench.map(d => d.id));
  });
  it('rejects garbage', () => {
    expect(fromHash('not-base64!!')).toBeNull();
    expect(fromHash(btoa('{"bench":[{"id":1}]}'))).toBeNull();
  });
  it('notifies subscribers and applies patches', () => {
    const st = new Store(defaultState());
    let seen = 0;
    const off = st.subscribe(() => seen++);
    st.set({ view: 'growth' });
    expect(st.get().view).toBe('growth');
    st.update(s => ({ ...s, scenario: { ...s.scenario, runs: 5 } }));
    expect(st.get().scenario.runs).toBe(5);
    off();
    st.set({ view: 'adev' });
    expect(seen).toBe(2);
  });
  it('effectiveTm follows the active requirement when auto', () => {
    const s = defaultState();
    expect(effectiveTm(s.scenario)).toBe(s.scenario.requirements[0]!.duration);
    s.scenario.Tm = 42;
    expect(effectiveTm(s.scenario)).toBe(42);
  });
  it('benchToSpec applies flicker mode', () => {
    const s = defaultState();
    s.bench[0]!.flickerMode = 'gmSum';
    expect(benchToSpec(s.bench[0]!).flickerMode).toBe('gmSum');
  });
  it('sanitizes malformed scenario/view fields from an untrusted hash', () => {
    const s = defaultState();
    s.scenario.Tm = -5;
    s.scenario.estimateMethods = ['bogus'] as unknown as typeof s.scenario.estimateMethods;
    s.scenario.requirements = [{ id: 'r', value: -1, sigma: 3, duration: 600 }];
    const raw = JSON.parse(atob(toHash(s).replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    raw.view = 'nope';
    const h = btoa(JSON.stringify(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = fromHash(h);
    expect(back).not.toBeNull();
    expect(back!.scenario.Tm).toBe('auto');
    expect(back!.view).toBe('adev');
    expect(back!.scenario.estimateMethods).toEqual(defaultState().scenario.estimateMethods);
    expect(back!.scenario.requirements).toEqual([]);
    expect(back!.scenario.activeRequirement).toBeNull();
  });
  it('falls back to the first bench id when selected names an unknown device', () => {
    const s = defaultState();
    s.selected = 'not-a-device';
    const back = fromHash(toHash(s));
    expect(back).not.toBeNull();
    expect(back!.selected).toBe(s.bench[0]!.id);
  });
});
