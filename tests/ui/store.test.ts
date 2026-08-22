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
});
