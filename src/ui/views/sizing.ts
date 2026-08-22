import { h } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtTime } from '../charts';
import type { AppState } from '../state';
import { ERROR_UNIT } from '../../engine/units';
import { cadenceGrid, computeKnee } from './sizingCompute';
import type { ViewFactory } from './types';

export const sizingView: ViewFactory = (root, store) => {
  const chartEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' });
  root.replaceChildren(h('p', {}, 'Steady-state post-fix error versus fix cadence for every device of the selected domain: the ', dfn('knee'), ' where better device noise stops helping, and the slowest cadence that still meets the ', dfn('requirement'), '. Analytic (Bayard steady state with the fudge mapping at T_m); no simulation.'), chartEl, readout);
  const chart = new LogLogChart(chartEl, { xLabel: 'fix cadence Δ (s)', yLabel: 'steady-state 1σ error' });
  const update = (s: AppState) => {
    const sel = s.bench.find(d => d.id === s.selected);
    if (!sel) return;
    if (sel.domain === 'accel') { readout.textContent = 'Steady-state sizing is defined for 2-state devices (gyro, clock) in v1.'; chart.setSeries([]); chart.setData(cadenceGrid(), []); return; }
    const eu = ERROR_UNIT[sel.domain];
    const req = s.scenario.requirements.find(r => r.id === s.scenario.activeRequirement) ?? null;
    const curves = computeKnee(s.bench.filter(d => d.domain === sel.domain), s.scenario, req);
    chart.setSeries(curves.map((c, i) => ({ label: c.name, color: PALETTE[i % 8]!, width: c.id === sel.id ? 3 : 1.5 })));
    chart.setData(cadenceGrid(), curves.map(c => Float64Array.from(c.sigma, eu.fromSI)));
    chart.clearLines();
    if (req) chart.addHLine(eu.fromSI(req.value / req.sigma), `requirement as 1σ (${eu.fromSI(req.value)} ${eu.label} / ${req.sigma})`);
    readout.replaceChildren(...curves.map(c => h('div', {}, h('span', {}, c.name), h('b', {}, c.slowestCadence === null ? 'never meets' : fmtTime(c.slowestCadence)), 'slowest fix cadence meeting the requirement')));
  };
  update(store.get());
  return { update, destroy: () => chart.destroy() };
};
