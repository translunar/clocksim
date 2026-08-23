import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../../src/ui/views/guide';
import { fromHash } from '../../src/ui/store';
import type { View } from '../../src/ui/state';

const VIEWS: View[] = ['guide', 'devices', 'adev', 'growth', 'sizing', 'compare'];

/**
 * The example hashes are built at module load with `PRESETS.find(...)!`, so a renamed or removed
 * preset id would throw the moment the Guide module is imported — i.e. at app boot, before
 * anything is on screen. Importing EXAMPLES here is itself half the test; decoding each hash is
 * the other half, and catches a state shape the sanitizer would silently reject.
 */
describe('guide examples', () => {
  it('offers several examples', () => {
    expect(Object.keys(EXAMPLES).length).toBeGreaterThanOrEqual(4);
  });

  for (const [name, hash] of Object.entries(EXAMPLES)) {
    it(`example "${name}" decodes to a usable state`, () => {
      expect(hash.startsWith('#')).toBe(true);
      const s = fromHash(hash.slice(1));
      expect(s, name).not.toBeNull();
      expect(VIEWS).toContain(s!.view);
      expect(s!.bench.length).toBeGreaterThan(0);
      expect(s!.bench.some(d => d.id === s!.selected)).toBe(true);
    });
  }
});
