import { describe, it, expect } from 'vitest';
import { Store, toHash, fromHash } from '../../src/ui/store';
import { defaultState, effectiveTm, benchToSpec, activeDomain, domScenario, updateDomain } from '../../src/ui/state';

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
    expect(effectiveTm(s.scenario, 'gyro')).toBe(s.scenario.byDomain.gyro.requirements[0]!.duration);
    s.scenario.Tm = 42;
    expect(effectiveTm(s.scenario, 'gyro')).toBe(42);
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
    s.scenario.byDomain.gyro.requirements = [{ id: 'r', value: -1, sigma: 3, duration: 600 }];
    const raw = JSON.parse(atob(toHash(s).replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    raw.view = 'nope';
    const h = btoa(JSON.stringify(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = fromHash(h);
    expect(back).not.toBeNull();
    expect(back!.scenario.Tm).toBe('auto');
    expect(back!.view).toBe('adev');
    expect(back!.scenario.estimateMethods).toEqual(defaultState().scenario.estimateMethods);
    expect(back!.scenario.byDomain.gyro.requirements).toEqual([]);
    expect(back!.scenario.byDomain.gyro.activeRequirement).toBeNull();
  });
  it('falls back to the first bench id when selected names an unknown device', () => {
    const s = defaultState();
    s.selected = 'not-a-device';
    const back = fromHash(toHash(s));
    expect(back).not.toBeNull();
    expect(back!.selected).toBe(s.bench[0]!.id);
  });
});

describe('per-domain scenario (spec §9.5)', () => {
  it('has the spec §9.5 defaults per domain', () => {
    const b = defaultState().scenario.byDomain;
    expect(b.gyro).toMatchObject({ duration: 3600, dt: 0.1, fix: { sigma: 333e-6, cadence: 0.5, bias: 0 } });
    expect(b.accel).toMatchObject({ duration: 3600, dt: 0.1, fix: { sigma: 3, cadence: 1, bias: 0 } });
    expect(b.clock).toMatchObject({ duration: 86400, dt: 1, fix: { sigma: 10e-9, cadence: 1, bias: 0 } });
    expect(b.gyro.requirements[0]).toMatchObject({ value: Math.PI / 180, sigma: 3, duration: 600 });
    expect(b.accel.requirements[0]).toMatchObject({ value: 100, sigma: 3, duration: 600 });
    expect(b.clock.requirements[0]).toMatchObject({ value: 1e-6, sigma: 3, duration: 86400 });
    expect(defaultState().scenario.estimateMethods).toEqual(['fudge', 'constant']);
  });
  it('activeDomain follows the selected device; clock devices see clock scenario', () => {
    const s = defaultState();               // bench: lsm6dsl-gyro, csac, ocxo; selected gyro
    expect(activeDomain(s)).toBe('gyro');
    const s2 = { ...s, selected: 'csac' };
    expect(activeDomain(s2)).toBe('clock');
    expect(domScenario(s2).fix.sigma).toBe(10e-9);   // the cesium/rubidium bug fix
  });
  it('updateDomain patches one domain immutably', () => {
    const s = defaultState();
    const s2 = updateDomain(s, 'clock', ds => { ds.dt = 10; });
    expect(s2.scenario.byDomain.clock.dt).toBe(10);
    expect(s.scenario.byDomain.clock.dt).toBe(1);
    expect(s2.scenario.byDomain.gyro).toEqual(s.scenario.byDomain.gyro);
  });
  it('effectiveTm uses the domain requirement duration when auto', () => {
    const sc = defaultState().scenario;
    expect(effectiveTm(sc, 'gyro')).toBe(600);
    expect(effectiveTm(sc, 'clock')).toBe(86400);
    expect(effectiveTm({ ...sc, Tm: 42 }, 'gyro')).toBe(42);
  });
  it('hash round-trips per-domain scenarios', () => {
    const s = updateDomain(defaultState(), 'clock', ds => { ds.fix.sigma = 5e-9; });
    const back = fromHash(toHash(s))!;
    expect(back.scenario.byDomain.clock.fix.sigma).toBe(5e-9);
  });
  it('a legacy v1.0 flat-scenario hash degrades to defaults without crashing', () => {
    const legacy = { ...defaultState(), scenario: { duration: 3600, dt: 0.1, runs: 200, seed: 1, fix: { sigma: 333e-6, cadence: 0.5, bias: 0 } } };
    const back = fromHash(toHash(legacy as never));
    expect(back).not.toBeNull();
    expect(back!.scenario.byDomain.gyro.dt).toBe(0.1);
  });
});
