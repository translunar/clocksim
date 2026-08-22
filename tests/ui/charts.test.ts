import { describe, it, expect } from 'vitest';
import { fmtSci, fmtTime, PALETTE } from '../../src/ui/format';

describe('chart helpers', () => {
  it('fmtSci handles null/NaN/Infinity (uPlot passes null for unlabeled ticks)', () => {
    expect(fmtSci(null as unknown as number)).toBe(''); expect(fmtSci(NaN)).toBe(''); expect(fmtSci(Infinity)).toBe('');
  });
  it('fmtSci', () => { expect(fmtSci(1234)).toBe('1.23e+3'); expect(fmtSci(0.000012)).toBe('1.2e-5'); expect(fmtSci(0)).toBe('0'); });
  it('fmtTime', () => {
    expect(fmtTime(30)).toBe('30 s'); expect(fmtTime(600)).toBe('600 s (10 min)'); expect(fmtTime(7200)).toBe('7.2e+3 s (2 h)'); expect(fmtTime(172800)).toBe('1.73e+5 s (2 d)');
  });
  it('palette has 8 unique colours', () => { expect(new Set(PALETTE).size).toBe(8); });
});
