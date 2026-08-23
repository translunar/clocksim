import { h, numInput, select, expander, controlKey } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci, fmtTime } from '../charts';
import { benchToSpec, effectiveTm, updateDomain, type AppState, type Scenario } from '../state';
import { crossover, estimateSigma, timeToRequirement } from '../../engine/models';
import { logTimes } from '../../engine/montecarlo';
import { ERROR_UNIT } from '../../engine/units';
import type { WorkerResponse } from '../../worker/protocol';
import { adevSampleCount } from './adev';
import type { ViewFactory } from './types';

type CompareResponse = Extract<WorkerResponse, { type: 'compare' }>;

export const compareView: ViewFactory = (root, store, client) => {
  const controls = h('div', { class: 'row' }), simRow = h('div', {}), chartEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' });
  root.replaceChildren(
    h('p', {},
      'To compare two good clocks you need a measurement quieter than both. ',
      'A ', dfn('DMTD'), ' mixes each clock against a shared offset oscillator. ',
      'The offset oscillator is common to both channels, so its noise cancels in the difference — unless some fraction ', dfn('leak', 'leaks'), ' through. ',
      'The ', dfn('floor'), ' is the electronics noise below which nothing can be measured. ',
      'The ', dfn('crossover'), ' marks where the device under test becomes noisier than the reference.'),
    controls, simRow, chartEl, readout);
  const chart = new LogLogChart(chartEl, { xLabel: 'τ (s)', yLabel: 'σy(τ)' });
  let pending: string | null = null, lastKey = '', lastM: CompareResponse | null = null;

  const renderReadout = (m: CompareResponse, s: AppState) => {
    const clocks = s.bench.filter(d => d.domain === 'clock');
    const cmp = s.scenario.compare;
    const dut = clocks.find(d => d.id === cmp.dut) ?? clocks[0]!;
    const x = crossover(m.tau, m.dut, m.tau, m.ref);
    chart.clearLines();
    if (x) chart.addVLine(x, `crossover ${fmtTime(x)}`);
    // DMTD is clocks-only, so the clock domain scenario applies regardless of what is selected.
    const cs = s.scenario.byDomain.clock;
    const req = cs.requirements.find(r => r.id === cs.activeRequirement) ?? null;
    const eu = ERROR_UNIT.clock;
    let holdover = '—';
    if (req) {
      const times = logTimes(cs.dt, Math.max(cs.duration, req.duration));
      const sig = estimateSigma(benchToSpec(dut), { method: 'constant', Tm: effectiveTm(s.scenario, 'clock'), fix: cs.fix, driftKnowledge: s.scenario.driftKnowledge, dt: cs.dt, profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal }, times);
      const t = timeToRequirement(times, Float64Array.from(sig, v => v * req.sigma), req.value);
      holdover = t === null ? 'beyond span' : fmtTime(t);
    }
    readout.replaceChildren(
      h('div', {}, h('span', {}, dfn('crossover')), h('b', {}, x ? fmtTime(x) : 'none in range')),
      h('div', {}, h('span', {}, `DUT holdover to requirement (constant-B formula${req ? `, ${eu.fromSI(req.value)} ${eu.label} ${req.sigma}σ` : ''})`), h('b', {}, holdover)),
      h('div', {}, h('span', {}, `measured σy at τ = ${fmtTime(m.tau[0] ?? cs.dt)}`), h('b', {}, fmtSci(m.measured[0] ?? 0))),
    );
  };

  const update = (s: AppState) => {
    const clocks = s.bench.filter(d => d.domain === 'clock');
    const set = (fn: (c: Scenario['compare']) => void) => store.update(st => { const c = structuredClone(st.scenario); fn(c.compare); return { ...st, scenario: c }; });
    const cmp = s.scenario.compare;
    const opts = clocks.map(d => ({ value: d.id, label: d.name }));
    controls.replaceChildren(
      select('Device under test (DUT)', opts, cmp.dut ?? '', v => set(c => { c.dut = v; })),
      select('Reference', opts, cmp.ref ?? '', v => set(c => { c.ref = v; })),
      select('Offset oscillator', opts, cmp.osc ?? '', v => set(c => { c.osc = v; })),
      numInput('leak ε', cmp.leak, v => set(c => { c.leak = v; }), { min: 0, term: 'leak' }),
      numInput('floor', cmp.floorQ * 1e12, v => set(c => { c.floorQ = v * 1e-12; }), { min: 0, unit: 'ps', term: 'floor' }),
    );
    const cs = s.scenario.byDomain.clock;
    simRow.replaceChildren(expander('dmtd:sim', `sim: span ${cs.duration} s · dt ${cs.dt} s · seed ${s.scenario.seed}`,
      h('div', { class: 'row' },
        numInput('span', cs.duration, v => store.update(st => updateDomain(st, 'clock', x => { x.duration = v; })), { unit: 's', min: 1, key: controlKey(['dmtd', 'span']) }),
        numInput('dt', cs.dt, v => store.update(st => updateDomain(st, 'clock', x => { x.dt = v; })), { unit: 's', min: 1e-3, key: controlKey(['dmtd', 'dt']) }),
        numInput('seed', s.scenario.seed, v => store.update(st => ({ ...st, scenario: { ...st.scenario, seed: v } })), { key: controlKey(['dmtd', 'seed']) }))));
    if (clocks.length < 2) { readout.textContent = 'Add at least two clocks to the bench.'; return; }
    const dut = clocks.find(d => d.id === cmp.dut) ?? clocks[0]!, ref = clocks.find(d => d.id === cmp.ref) ?? clocks[1]!, osc = clocks.find(d => d.id === cmp.osc) ?? ref;
    const n = adevSampleCount(cs.duration, cs.dt);
    const key = JSON.stringify([dut, ref, osc, cmp.leak, cmp.floorQ, n, cs.dt, s.scenario.seed, s.scenario.devKind]);
    if (key === lastKey) { if (lastM) renderReadout(lastM, s); return; }
    lastKey = key;
    if (pending) client.cancel(pending);
    lastM = null;
    pending = client.request({ type: 'compare', id: client.nextId(), dut: benchToSpec(dut), ref: benchToSpec(ref), osc: benchToSpec(osc), leak: cmp.leak, floorQ: cmp.floorQ, dt: cs.dt, n, seed: s.scenario.seed, kind: s.scenario.devKind }, m => {
      pending = null;
      if (m.type === 'error') { readout.textContent = m.message; return; }
      if (m.type !== 'compare') return;
      lastM = m;
      chart.setSeries([
        { label: `Device under test: ${dut.name}`, color: PALETTE[0]! }, { label: `Reference: ${ref.name}`, color: PALETTE[1]! },
        { label: `Offset oscillator: ${osc.name}`, color: PALETTE[7]!, dash: [4, 4], width: 1 }, { label: 'measured difference', color: PALETTE[2]!, width: 3 },
      ]);
      chart.setData(m.tau, [m.dut, m.ref, m.osc, m.measured]);
      renderReadout(m, s);
    });
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); chart.destroy(); } };
};
