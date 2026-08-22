import { describe, it, expect } from 'vitest';
import { fft, nextPow2, convolveReal } from '../../src/engine/fft';

function naiveDft(re: Float64Array, im: Float64Array) {
  const n = re.length, outRe = new Float64Array(n), outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) for (let t = 0; t < n; t++) {
    const a = -2 * Math.PI * k * t / n;
    outRe[k] = outRe[k]! + (re[t]! * Math.cos(a) - im[t]! * Math.sin(a));
    outIm[k] = outIm[k]! + (re[t]! * Math.sin(a) + im[t]! * Math.cos(a));
  }
  return { outRe, outIm };
}

describe('fft', () => {
  it('nextPow2', () => {
    expect(nextPow2(1)).toBe(1); expect(nextPow2(5)).toBe(8); expect(nextPow2(8)).toBe(8); expect(nextPow2(1025)).toBe(2048);
  });
  it('matches a naive DFT', () => {
    const n = 64, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { re[i] = Math.sin(i * 0.3) + (i % 5); im[i] = Math.cos(i * 0.7); }
    const { outRe, outIm } = naiveDft(re, im);
    fft(re, im);
    for (let i = 0; i < n; i++) { expect(re[i]).toBeCloseTo(outRe[i]!, 8); expect(im[i]).toBeCloseTo(outIm[i]!, 8); }
  });
  it('inverse round-trips', () => {
    const n = 128, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = i * 0.01 - 0.5;
    const orig = Float64Array.from(re);
    fft(re, im); fft(re, im, true);
    for (let i = 0; i < n; i++) { expect(re[i]).toBeCloseTo(orig[i]!, 10); expect(im[i]).toBeCloseTo(0, 10); }
  });
  it('convolveReal matches direct convolution', () => {
    const a = Float64Array.from([1, 2, 3, 4, 5]), b = Float64Array.from([1, -1, 0.5]);
    const out = convolveReal(a, b, 5);
    const direct = [1, 1, 1.5, 2, 2.5];
    for (let i = 0; i < 5; i++) expect(out[i]).toBeCloseTo(direct[i]!, 10);
  });
});
