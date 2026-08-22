import { describe, it, expect } from 'vitest';
import { LESSONS } from '../../src/ui/lessons';
import { toHash, fromHash } from '../../src/ui/store';

describe('lessons', () => {
  it('every lesson state is valid and round-trips', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(4);
    for (const l of LESSONS) {
      const s = l.state();
      expect(s.bench.length).toBeGreaterThan(0);
      expect(s.bench.some(d => d.id === s.selected)).toBe(true);
      expect(fromHash(toHash(s))).not.toBeNull();
      expect(l.blurb.length).toBeGreaterThan(40);
    }
  });
});
