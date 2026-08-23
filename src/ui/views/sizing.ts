import { h, numInput, controlKey } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtTime } from '../charts';
import { updateDomain, type AppState } from '../state';
import { ERROR_UNIT } from '../../engine/units';
import { cadenceGrid, computeKnee } from './sizingCompute';
import type { ViewFactory } from './types';

let cadLo = 0.01, cadHi = 1e4; // view-local sweep range; not part of saved state

export const sizingView: ViewFactory = (root, store) => {
  const controls = h('div', {});
  const chartEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' });
  root.replaceChildren(
    h('p', {},
      'Suppose you get a fix every T seconds. This chart shows how big your error stays, for each device, as T grows. ',
      'Where a line is flat, fixes come often enough that device quality does not matter — that is the ', dfn('knee'), '. ',
      'No simulation here — pure formula.'),
    controls, chartEl, readout);
  const chart = new LogLogChart(chartEl, { xLabel: 'fix cadence Δ (s)', yLabel: 'steady-state 1σ error' });
  const update = (s: AppState) => {
    const sel = s.bench.find(d => d.id === s.selected);
    if (!sel) return;
    if (sel.domain === 'accel') { controls.replaceChildren(); readout.textContent = 'Steady-state sizing covers gyros and clocks in v1; accelerometers are a stated limitation (spec §3.9).'; chart.setSeries([]); chart.setData(cadenceGrid(cadLo, cadHi), []); return; }
    const ds = s.scenario.byDomain[sel.domain];
    controls.replaceChildren(h('div', { class: 'row' },
      numInput('fix accuracy', ds.fix.sigma, v => store.update(st => updateDomain(st, sel.domain, x => { x.fix.sigma = v; })), { unit: sel.domain === 'gyro' ? 'rad, 1σ' : 's, 1σ', min: 0, term: 'fix', key: controlKey(['sizing', 'fixsigma']) }),
      h('div', { class: 'row' },
        numInput('sweep from', cadLo, v => { cadLo = Math.max(1e-3, v); update(store.get()); }, { unit: 's', key: controlKey(['sizing', 'cadlo']) }),
        numInput('to', cadHi, v => { cadHi = Math.max(cadLo * 10, v); update(store.get()); }, { unit: 's', key: controlKey(['sizing', 'cadhi']) }))));
    const eu = ERROR_UNIT[sel.domain];
    const req = ds.requirements.find(r => r.id === ds.activeRequirement) ?? null;
    const grid = cadenceGrid(cadLo, cadHi);
    const curves = computeKnee(s.bench.filter(d => d.domain === sel.domain), s.scenario, sel.domain, req, grid);
    chart.setSeries(curves.map((c, i) => ({ label: c.name, color: PALETTE[i % 8]!, width: c.id === sel.id ? 3 : 1.5 })));
    chart.setData(grid, curves.map(c => Float64Array.from(c.sigma, eu.fromSI)));
    chart.clearLines();
    if (req) chart.addHLine(eu.fromSI(req.value / req.sigma), `requirement as 1σ (${eu.fromSI(req.value)} ${eu.label} / ${req.sigma})`);
    readout.replaceChildren(...curves.map(c => h('div', {}, h('span', {}, c.name), h('b', {}, c.slowestCadence === null ? 'never meets' : fmtTime(c.slowestCadence)), 'slowest fix cadence that still meets the requirement')));
  };
  update(store.get());
  return { update, destroy: () => chart.destroy() };
};
