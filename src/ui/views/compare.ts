import { h, numInput, select } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci, fmtTime } from '../charts';
import { benchToSpec, effectiveTm, type AppState, type Scenario } from '../state';
import { crossover, estimateSigma, timeToRequirement } from '../../engine/models';
import { logTimes } from '../../engine/montecarlo';
import { ERROR_UNIT } from '../../engine/units';
import { adevSampleCount } from './adev';
import type { ViewFactory } from './types';

export const compareView: ViewFactory = (root, store, client) => {
  const controls = h('div', { class: 'row' }), chartEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' });
  root.replaceChildren(h('p', {}, dfn('DMTD', 'Dual-mixer time-difference'), ' comparison of two clocks from the bench against a common offset oscillator. With zero ', dfn('leak'), ' the offset oscillator is invisible; the ', dfn('floor'), ' sets the short-τ limit. The ', dfn('crossover'), ' of DUT and reference marks the natural disciplining time constant.'), controls, chartEl, readout);
  const chart = new LogLogChart(chartEl, { xLabel: 'τ (s)', yLabel: 'σy(τ)' });
  let pending: string | null = null, lastKey = '';

  const update = (s: AppState) => {
    const clocks = s.bench.filter(d => d.domain === 'clock');
    const set = (fn: (c: Scenario['compare']) => void) => store.update(st => { const c = structuredClone(st.scenario); fn(c.compare); return { ...st, scenario: c }; });
    const cmp = s.scenario.compare;
    const opts = clocks.map(d => ({ value: d.id, label: d.name }));
    controls.replaceChildren(
      select('DUT', opts, cmp.dut ?? '', v => set(c => { c.dut = v; })),
      select('Reference', opts, cmp.ref ?? '', v => set(c => { c.ref = v; })),
      select('Offset oscillator', opts, cmp.osc ?? '', v => set(c => { c.osc = v; })),
      numInput('leak ε', cmp.leak, v => set(c => { c.leak = v; }), { min: 0, term: 'leak' }),
      numInput('floor', cmp.floorQ * 1e12, v => set(c => { c.floorQ = v * 1e-12; }), { min: 0, unit: 'ps', term: 'floor' }),
    );
    if (clocks.length < 2) { readout.textContent = 'Add at least two clocks to the bench.'; return; }
    const dut = clocks.find(d => d.id === cmp.dut) ?? clocks[0]!, ref = clocks.find(d => d.id === cmp.ref) ?? clocks[1]!, osc = clocks.find(d => d.id === cmp.osc) ?? ref;
    const n = adevSampleCount(s.scenario.duration, s.scenario.dt);
    const key = JSON.stringify([dut, ref, osc, cmp.leak, cmp.floorQ, n, s.scenario.dt, s.scenario.seed, s.scenario.devKind]);
    if (key === lastKey) return;
    lastKey = key;
    if (pending) client.cancel(pending);
    pending = client.request({ type: 'compare', id: client.nextId(), dut: benchToSpec(dut), ref: benchToSpec(ref), osc: benchToSpec(osc), leak: cmp.leak, floorQ: cmp.floorQ, dt: s.scenario.dt, n, seed: s.scenario.seed, kind: s.scenario.devKind }, m => {
      pending = null;
      if (m.type !== 'compare') return;
      chart.setSeries([
        { label: `DUT: ${dut.name}`, color: PALETTE[0]! }, { label: `REF: ${ref.name}`, color: PALETTE[1]! },
        { label: `OSC: ${osc.name}`, color: PALETTE[7]!, dash: [4, 4], width: 1 }, { label: 'measured difference', color: PALETTE[2]!, width: 3 },
      ]);
      chart.setData(m.tau, [m.dut, m.ref, m.osc, m.measured]);
      const x = crossover(m.tau, m.dut, m.tau, m.ref);
      chart.clearLines();
      if (x) chart.addVLine(x, `crossover ${fmtTime(x)}`);
      const req = s.scenario.requirements.find(r => r.id === s.scenario.activeRequirement) ?? null;
      const eu = ERROR_UNIT.clock;
      let holdover = '—';
      if (req) {
        const times = logTimes(s.scenario.dt, Math.max(s.scenario.duration, req.duration));
        const sig = estimateSigma(benchToSpec(dut), { method: 'constant', Tm: effectiveTm(s.scenario), fix: s.scenario.fix, driftKnowledge: s.scenario.driftKnowledge, dt: s.scenario.dt, profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal }, times);
        const t = timeToRequirement(times, Float64Array.from(sig, v => v * req.sigma), req.value);
        holdover = t === null ? 'beyond span' : fmtTime(t);
      }
      readout.replaceChildren(
        h('div', {}, h('span', {}, dfn('crossover')), h('b', {}, x ? fmtTime(x) : 'none in range')),
        h('div', {}, h('span', {}, `DUT holdover to requirement (constant-B estimate${req ? `, ${eu.fromSI(req.value)} ${eu.label} ${req.sigma}σ` : ''})`), h('b', {}, holdover)),
        h('div', {}, h('span', {}, 'measured σy at τ = 1 s'), h('b', {}, fmtSci(m.measured[0] ?? 0))),
      );
    });
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); chart.destroy(); } };
};
