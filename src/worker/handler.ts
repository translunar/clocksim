import type { WorkerRequest, WorkerResponse } from './protocol';
import { Prng } from '../engine/prng';
import { simulateRate, comparePhase } from '../engine/bench';
import { deviation, frequencyToPhase, logSpacedM, analyticAdevTerms, analyticAdev } from '../engine/deviations';
import { logTimes, runOne, Envelope, PERCENTILES } from '../engine/montecarlo';

const yieldToLoop = () => new Promise<void>(r => setTimeout(r, 0));

export async function handleRequest(msg: WorkerRequest, post: (m: WorkerResponse) => void, isCancelled: () => boolean = () => false): Promise<void> {
  try {
    if (msg.type === 'adev') {
      const y = simulateRate(msg.spec, { dt: msg.dt, n: msg.n, profile: msg.profile, includeThermal: msg.includeThermal, initial: [0, 0, 0] }, new Prng(msg.seed));
      const x = frequencyToPhase(y, msg.dt);
      const ms = logSpacedM(x.length, 8, 0.4); // beyond 10% the view draws points faded
      const r = deviation(msg.kind, x, msg.dt, ms);
      post({ type: 'adev', id: msg.id, tau: r.tau, dev: r.dev, lo: r.lo, hi: r.hi, analytic: analyticAdevTerms(msg.spec.coefs, r.tau), analyticTotal: analyticAdev(msg.spec.coefs, r.tau) });
    } else if (msg.type === 'compare') {
      const opts = { dt: msg.dt, n: msg.n, profile: { kind: 'none' as const }, includeThermal: false, initial: [0, 0, 0] };
      const seed = new Prng(msg.seed);
      const yd = simulateRate(msg.dut, opts, seed.fork(1)), yr = simulateRate(msg.ref, opts, seed.fork(2)), yo = simulateRate(msg.osc, opts, seed.fork(3));
      const xd = frequencyToPhase(yd, msg.dt), xr = frequencyToPhase(yr, msg.dt), xo = frequencyToPhase(yo, msg.dt);
      const xm = comparePhase(xd, xr, xo, msg.leak, msg.floorQ, msg.dt, seed.fork(4));
      const ms = logSpacedM(xd.length);
      const d = (x: Float64Array) => deviation(msg.kind, x, msg.dt, ms);
      const rd = d(xd);
      post({ type: 'compare', id: msg.id, tau: rd.tau, dut: rd.dev, ref: d(xr).dev, osc: d(xo).dev, measured: d(xm).dev });
    } else if (msg.type === 'mc') {
      const times = logTimes(msg.req.dt, msg.req.duration);
      const env = new Envelope(times);
      const snapshot = () => ({ runs: env.runs, times, p68: env.percentile(PERCENTILES.p68), p95: env.percentile(PERCENTILES.p95), p997: env.percentile(PERCENTILES.p997) });
      for (let r = 0; r < msg.req.runs; r++) {
        if (isCancelled()) break;
        env.add(runOne(msg.req, times, r));
        if ((r + 1) % msg.batch === 0 && r + 1 < msg.req.runs) { post({ type: 'mc-progress', id: msg.id, ...snapshot() }); await yieldToLoop(); }
      }
      post({ type: 'mc-done', id: msg.id, ...snapshot() });
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
}
