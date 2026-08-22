import { h } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci, fmtTime } from '../charts';
import { benchToSpec, effectiveTm, type AppState } from '../state';
import { ERROR_UNIT } from '../../engine/units';
import type { ContributionKey } from '../../engine/models';
import { computeEstimates, growthTimes, mcSummary, valueAt } from './growthCompute';
import type { ViewFactory } from './types';

const CONTRIB: ContributionKey[] = ['initial', 'Q', 'N', 'B', 'K', 'D', 'R', 'thermal'];

export const growthView: ViewFactory = (root, store, client) => {
  const mainEl = h('div', { class: 'chart' }), stackEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' }), status = h('div', {});
  root.replaceChildren(
    h('p', {}, 'Open-loop error growth after the last fix: analytic ', dfn('Bayard', 'estimates'), ' per ', dfn('Tm', 'estimate method'), ' versus Monte Carlo truth (', dfn('percentile', 'percentile envelope'), '), against the active ', dfn('requirement'), '.'),
    mainEl, readout, status, h('h3', {}, 'Contributions (first selected method)'), stackEl);
  const main = new LogLogChart(mainEl, { xLabel: 't since last fix (s)', yLabel: 'error' });
  const stack = new LogLogChart(stackEl, { xLabel: 't since last fix (s)', yLabel: 'σ contribution' });
  let pending: string | null = null, lastKey = '';
  let lastMc: { runs: number; times: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array } | null = null;

  const update = (s: AppState) => {
    const d = s.bench.find(x => x.id === s.selected);
    if (!d) return;
    const spec = benchToSpec(d);
    const eu = ERROR_UNIT[d.domain];
    const req = s.scenario.requirements.find(r => r.id === s.scenario.activeRequirement) ?? null;
    const inputs = { spec, scenario: s.scenario, req };
    const times = growthTimes(inputs);
    const est = computeEstimates(inputs, times);
    const conv = (a: Float64Array) => Float64Array.from(a, eu.fromSI);
    const k = req?.sigma ?? 1;

    const renderAll = (mc: { runs: number; times: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array } | null) => {
      // Use the worker's own time grid for anything derived from its curves: with the duration
      // sent below matching what growthTimes() used, mc.times and `times` are the same values,
      // but plotting/interpolating against mc.times keeps this correct even if that ever drifts
      // again (I5) instead of silently misaligning the last MC point.
      const mcS = mc ? mcSummary(mc.times, mc, req) : null;
      main.setSeries([
        ...est.map((c, i) => ({ label: `${c.method} (${k}σ)`, color: PALETTE[i + 1]!, dash: [6, 3] })),
        { label: `Monte Carlo ${k}σ`, color: PALETTE[0]!, width: 3 },
      ]);
      main.setData(mc ? mc.times : times, [...est.map(c => conv(c.scaled)), mcS ? conv(mcS.curve) : null]);
      main.clearLines();
      if (req) { main.addHLine(eu.fromSI(req.value), `requirement ${eu.fromSI(req.value)} ${eu.label} (${k}σ)`); main.addVLine(req.duration, fmtTime(req.duration)); }
      const first = est[0];
      const thermalAtReq = first && req ? valueAt(times, first.contributions.thermal, req.duration) : null;
      readout.replaceChildren(
        ...est.map(c => h('div', {}, h('span', {}, dfn(c.method), ` at ${req ? fmtTime(req.duration) : '—'}`), h('b', {}, c.atReq === null ? '—' : `${fmtSci(eu.fromSI(c.atReq))} ${eu.label}`), `time to requirement: ${c.timeToReq === null ? 'never within span' : fmtTime(c.timeToReq)}`)),
        h('div', {}, h('span', {}, 'Monte Carlo truth'), h('b', {}, mcS?.atReq == null ? '…' : `${fmtSci(eu.fromSI(mcS.atReq))} ${eu.label}`), `time to requirement: ${mcS?.timeToReq == null ? (mc ? 'never within span' : '…') : fmtTime(mcS.timeToReq)}`),
        ...(mcS?.atReq != null ? est.map(c => h('div', { class: c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'warn' : '' }, h('span', {}, `truth / ${c.method}`), h('b', {}, c.atReq ? (mcS.atReq! / c.atReq).toFixed(2) + '×' : '—'), c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'estimate is optimistic at this duration' : 'estimate is adequate or conservative here')) : []),
        h('div', {}, h('span', {}, 'T_m in use'), h('b', {}, fmtTime(effectiveTm(s.scenario)))),
        h('div', {}, h('span', {}, dfn('thermal', 'thermal (truth only)')), h('b', {}, thermalAtReq == null ? '—' : `${fmtSci(eu.fromSI(thermalAtReq))} ${eu.label}`), 'not included in the analytic estimate above; carried only by the Monte Carlo truth'),
      );
      if (first) {
        const keys = CONTRIB.filter(key => first.contributions[key].some(v => v > 0));
        stack.setSeries(keys.map((key, i) => ({ label: key === 'B' ? `B (${first.method})` : key, color: PALETTE[i % 8]! })));
        stack.setData(times, keys.map(key => conv(first.contributions[key])));
      }
    };

    const key = JSON.stringify([spec, s.scenario.dt, s.scenario.duration, s.scenario.runs, s.scenario.seed, s.scenario.fix, s.scenario.driftKnowledge, s.scenario.temperature, s.scenario.includeThermal, effectiveTm(s.scenario), req?.duration]);
    if (key !== lastKey) {
      lastKey = key;
      if (pending) { client.cancel(pending); pending = null; }
      lastMc = null;
      renderAll(null);
      // The same value growthTimes() uses (not times[times.length-1]): logTimes' dt-snapped last
      // grid point can exceed the raw duration, so echoing that back used to hand the worker a
      // different duration than the one used to build `times`, and its re-derived logTimes grid
      // came out a different length (I5).
      const mcDuration = Math.max(s.scenario.duration, req?.duration ?? 0);
      const samples = Math.round(mcDuration / s.scenario.dt);
      if (samples > 2_000_000) {
        status.textContent = 'Monte Carlo skipped: duration/dt exceeds 2,000,000 samples — increase dt or shorten duration';
      } else {
        status.textContent = 'running Monte Carlo…';
        pending = client.request({ type: 'mc', id: client.nextId(), batch: 10, req: { spec, dt: s.scenario.dt, duration: mcDuration, runs: s.scenario.runs, seed: s.scenario.seed, profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal, fix: s.scenario.fix, driftKnowledge: s.scenario.driftKnowledge, Tm: effectiveTm(s.scenario) } }, m => {
          if (m.type === 'mc-progress' || m.type === 'mc-done') { lastMc = m; renderAll(m); status.textContent = m.type === 'mc-done' ? `done: ${m.runs} runs` : `${m.runs} / ${s.scenario.runs} runs`; }
          if (m.type === 'mc-done' || m.type === 'error') { pending = null; if (m.type === 'error') status.textContent = m.message; }
        });
      }
    } else renderAll(lastMc);
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); main.destroy(); stack.destroy(); } };
};
