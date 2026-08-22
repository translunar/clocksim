/** xoshiro128** seeded via splitmix32. All randomness in the engine goes through this. */
export class Prng {
  private s = new Uint32Array(4);
  private spare: number | null = null;

  constructor(seed: number) {
    let x = (seed >>> 0) || 0x9e3779b9;
    for (let i = 0; i < 4; i++) {
      // splitmix32
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }

  private rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    const s = this.s;
    const result = Math.imul(this.rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1]! << 9) >>> 0;
    s[2] = (s[2]! ^ s[0]!) >>> 0;
    s[3] = (s[3]! ^ s[1]!) >>> 0;
    s[1] = (s[1]! ^ s[2]!) >>> 0;
    s[0] = (s[0]! ^ s[3]!) >>> 0;
    s[2] = (s[2]! ^ t) >>> 0;
    s[3] = this.rotl(s[3]!, 11);
    return result / 4294967296;
  }

  /** Standard normal via Box-Muller. */
  gaussian(): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u1 = this.next();
    while (u1 === 0) u1 = this.next();
    const u2 = this.next();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * u2;
    this.spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  fill(out: Float64Array): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.gaussian();
    return out;
  }

  /** Independent stream derived from this one; used to give each MC run / noise type its own stream. */
  fork(label: number): Prng {
    const mix = (this.s[0]! ^ Math.imul(label + 1, 0x9e3779b1)) >>> 0;
    return new Prng(mix);
  }
}
