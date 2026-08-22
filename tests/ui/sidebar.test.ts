import { describe, it, expect } from 'vitest';
import { exportDevice, importDevice } from '../../src/ui/sidebar';
import { defaultState } from '../../src/ui/state';

describe('sidebar helpers', () => {
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
