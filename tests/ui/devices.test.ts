import { describe, it, expect } from 'vitest';
import { exportDevice, importDevice } from '../../src/ui/views/devices';
import { defaultState, uniqueId } from '../../src/ui/state';
import { controlKey } from '../../src/ui/dom';

describe('device export/import', () => {
  it('export/import round-trips a bench device', () => {
    const d = defaultState().bench[0]!;
    const back = importDevice(exportDevice(d));
    expect(back).toEqual(d);
  });
  it('import rejects invalid JSON and invalid devices', () => {
    expect(importDevice('{')).toBeNull();
    expect(importDevice('{"id":"x"}')).toBeNull();
  });
});

describe('controlKey', () => {
  it('is deterministic', () => {
    expect(controlKey(['scenario', 'duration'])).toBe(controlKey(['scenario', 'duration']));
  });
  it('joins parts with a colon', () => {
    expect(controlKey(['scenario', 'duration'])).toBe('scenario:duration');
  });
  it('is slug-safe: only lowercase alphanumerics, "-" and ":"', () => {
    const key = controlKey(['dev', 'LSM6DSL Gyro #1', 'N']);
    expect(key).toMatch(/^[a-z0-9:-]+$/);
  });
});

describe('uniqueId', () => {
  it('returns the base when unused', () => {
    expect(uniqueId('a', [])).toBe('a');
  });
  it('appends -2 on first collision', () => {
    expect(uniqueId('a', ['a'])).toBe('a-2');
  });
  it('finds the next free suffix', () => {
    expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3');
  });
});
