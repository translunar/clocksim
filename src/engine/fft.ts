export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 complex FFT. Length must be a power of two. Inverse is scaled by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xRe = re[b]! * cRe - im[b]! * cIm;
        const xIm = re[b]! * cIm + im[b]! * cRe;
        re[b] = re[a]! - xRe; im[b] = im[a]! - xIm;
        re[a] = re[a]! + xRe; im[a] = im[a]! + xIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe; cRe = nRe;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n; }
}

/** Linear convolution of two real sequences via FFT; returns the first outLen samples. */
export function convolveReal(a: Float64Array, b: Float64Array, outLen: number): Float64Array {
  const n = nextPow2(a.length + b.length - 1);
  const aRe = new Float64Array(n), aIm = new Float64Array(n);
  const bRe = new Float64Array(n), bIm = new Float64Array(n);
  aRe.set(a); bRe.set(b);
  fft(aRe, aIm); fft(bRe, bIm);
  for (let i = 0; i < n; i++) {
    const r = aRe[i]! * bRe[i]! - aIm[i]! * bIm[i]!;
    const m = aRe[i]! * bIm[i]! + aIm[i]! * bRe[i]!;
    aRe[i] = r; aIm[i] = m;
  }
  fft(aRe, aIm, true);
  return aRe.slice(0, outLen);
}
