import { h, numInput, expander, segmented, controlKey } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci } from '../charts';
import { benchToSpec, updateDomain, type AppState } from '../state';
import { DATASHEET_UNITS } from '../../engine/units';
import type { Coefs, DevKind } from '../../engine/deviations';
import type { ViewFactory } from './types';

export const adevSampleCount = (duration: number, dt: number) => Math.min(1 << 18, Math.max(1024, Math.round(duration / dt)));

const TERM_KEYS: (keyof Coefs)[] = ['Q', 'F', 'N', 'B', 'K', 'D', 'R'];
const ASYMPTOTE_FORMULA: Record<keyof Coefs, string> = { Q: '(√3·Q/τ)', F: '(≈F/τ)', N: '(N/√τ)', B: '(0.664·B)', K: '(K·√(τ/3))', D: '(none)', R: '(R·τ/√2)' };

export const adevView: ViewFactory = (root, store, client) => {
  const controls = h('div', {});
  const chartEl = h('div', { class: 'chart' });
  const simRow = h('div', {});
  const info = h('div', {});
  root.replaceChildren(
    h('p', {},
      'This is the chart a datasheet describes. The solid curve is a simulated measurement of the selected device. ',
      'Each dashed line is one noise term by itself — its ', dfn('asymptote'), '. ',
      'Where the solid curve hugs a dashed line, that noise dominates at that averaging time. ',
      dfn('confidence', 'Faded points'), ' come from too little data. Do not trust them.'),
    controls, chartEl, simRow, info);
  const chart = new LogLogChart(chartEl, { xLabel: 'τ (s)', yLabel: 'deviation' });
  let pending: string | null = null;
  let lastKey = '';

  const update = (s: AppState) => {
    const d = s.bench.find(x => x.id === s.selected);
    if (!d) { info.textContent = 'No device selected.'; return; }
    const ds = s.scenario.byDomain[d.domain];
    // Rebuilding these rows destroys the element being edited; capture the focused control by its
    // stable data-key and restore it afterwards (same pattern as growth.ts / sidebar.ts).
    const activeKey = document.activeElement?.getAttribute('data-key') ?? null;
    controls.replaceChildren(
      segmented([{ value: 'adev', label: 'ADEV' }, { value: 'mdev', label: 'MDEV' }, { value: 'hdev', label: 'HDEV' }],
        s.scenario.devKind, v => store.update(st => ({ ...st, scenario: { ...st.scenario, devKind: v as DevKind } })), { key: 'adev:devkind' }),
      ' ', dfn('MDEV', 'why MDEV?'), ' · ', dfn('HDEV', 'why HDEV?'));
    simRow.replaceChildren(expander('adev:sim', `sim: span ${ds.duration} s · dt ${ds.dt} s · seed ${s.scenario.seed}`,
      h('div', { class: 'row' },
        numInput('span', ds.duration, v => store.update(st => updateDomain(st, d.domain, x => { x.duration = v; })), { unit: 's', min: 1, key: controlKey(['adev', 'span']) }),
        numInput('dt', ds.dt, v => store.update(st => updateDomain(st, d.domain, x => { x.dt = v; })), { unit: 's', min: 1e-4, key: controlKey(['adev', 'dt']) }),
        numInput('seed', s.scenario.seed, v => store.update(st => ({ ...st, scenario: { ...st.scenario, seed: v } })), { key: controlKey(['adev', 'seed']) }))));
    if (activeKey) root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus();
    const spec = benchToSpec(d);
    const n = adevSampleCount(ds.duration, ds.dt);
    const key = JSON.stringify([spec, n, ds.dt, s.scenario.seed, s.scenario.devKind, s.scenario.temperature, s.scenario.includeThermal]);
    if (key === lastKey) return;
    lastKey = key;
    if (pending) client.cancel(pending);
    info.textContent = `simulating ${n} samples…`;
    const units = DATASHEET_UNITS[d.domain];
    pending = client.request({ type: 'adev', id: client.nextId(), spec, dt: ds.dt, n, seed: s.scenario.seed, kind: s.scenario.devKind, profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal }, m => {
      pending = null;
      if (m.type !== 'adev') { info.textContent = m.type === 'error' ? m.message : ''; return; }
      const cutoff = n * ds.dt / 10;
      const reliable = Float64Array.from(m.dev, (v, i) => (m.tau[i]! <= cutoff ? v : NaN));
      const faded = Float64Array.from(m.dev, (v, i) => (m.tau[i]! > cutoff ? v : NaN));
      const active = TERM_KEYS.filter(k => spec.coefs[k] > 0);
      // Asymptotes are ADEV-specific: MDEV/HDEV have different slopes for the same noise, and the
      // Allan variance diverges for D, so D never gets an asymptote even under ADEV.
      const isAdev = s.scenario.devKind === 'adev';
      const overlay = isAdev ? active.filter(k => k !== 'D') : [];
      chart.setSeries([
        { label: `${s.scenario.devKind.toUpperCase()} (simulated)`, color: PALETTE[0]!, width: 2.5 },
        { label: 'unreliable (τ > record/10)', color: PALETTE[7]!, width: 1 },
        { label: '68% band lo', color: PALETTE[0]!, width: 0.5, band: true },
        { label: '68% band hi', color: PALETTE[0]!, width: 0.5, band: true },
        ...(isAdev ? [{ label: 'analytic total', color: '#e2ddf0', dash: [2, 3] }] : []),
        ...overlay.map((k, i) => ({ label: `${k} asymptote ${ASYMPTOTE_FORMULA[k]}`, color: PALETTE[(i + 1) % 8]!, dash: [8, 4], width: 1 })),
      ]);
      chart.setBands([[3, 4]]);
      chart.setData(m.tau, [reliable, faded, m.lo, m.hi, ...(isAdev ? [m.analyticTotal] : []), ...overlay.map(k => m.analytic[k])]);
      const slope: Record<keyof Coefs, string> = { Q: 'τ⁻¹', F: 'τ⁻¹', N: 'τ⁻¹ᐟ²', B: 'τ⁰', K: 'τ⁺¹ᐟ²', D: 'no asymptote (diverges)', R: 'τ⁺¹' };
      info.replaceChildren(
        h('table', {}, h('tr', {}, h('th', {}, 'coef'), h('th', {}, 'datasheet'), h('th', {}, 'SI'), ...(isAdev ? [h('th', {}, 'ADEV slope')] : [])),
          ...active.map(k => h('tr', {}, h('td', {}, dfn(k)), h('td', {}, `${d.coefs[k]} ${units[k]}`), h('td', {}, fmtSci(spec.coefs[k])), ...(isAdev ? [h('td', {}, slope[k])] : [])))),
        ...(isAdev ? [] : [h('p', {}, 'Asymptotes are drawn for ADEV only. MDEV and HDEV have different slopes for the same noise (see glossary).')]),
      );
    });
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); chart.destroy(); } };
};
