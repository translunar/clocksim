import { h } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci } from '../charts';
import { benchToSpec, type AppState } from '../state';
import { DATASHEET_UNITS } from '../../engine/units';
import type { Coefs } from '../../engine/deviations';
import type { ViewFactory } from './types';

export const adevSampleCount = (duration: number, dt: number) => Math.min(1 << 18, Math.max(1024, Math.round(duration / dt)));

const TERM_KEYS: (keyof Coefs)[] = ['Q', 'F', 'N', 'B', 'K', 'D', 'R'];
const ASYMPTOTE_FORMULA: Record<keyof Coefs, string> = { Q: '(√3·Q/τ)', F: '(≈F/τ)', N: '(N/√τ)', B: '(0.664·B)', K: '(K·√(τ/3))', D: '(none)', R: '(R·τ/√2)' };

export const adevView: ViewFactory = (root, store, client) => {
  const chartEl = h('div', { class: 'chart' });
  const info = h('div', {});
  root.replaceChildren(h('p', {}, dfn('ADEV', 'Allan deviation'), ' of the simulated rate-like series. Each dashed line is the ', dfn('asymptote', 'analytic asymptote'), ' for one coefficient — the ADEV that noise term alone would give; the dotted line is their combined total. Where the solid curve hugs a dashed line, that term dominates. ', dfn('confidence', 'Faded points are unreliable.')), chartEl, info);
  const chart = new LogLogChart(chartEl, { xLabel: 'τ (s)', yLabel: 'deviation' });
  let pending: string | null = null;
  let lastKey = '';

  const update = (s: AppState) => {
    const d = s.bench.find(x => x.id === s.selected);
    if (!d) { info.textContent = 'No device selected.'; return; }
    const spec = benchToSpec(d);
    const n = adevSampleCount(s.scenario.duration, s.scenario.dt);
    const key = JSON.stringify([spec, n, s.scenario.dt, s.scenario.seed, s.scenario.devKind, s.scenario.temperature, s.scenario.includeThermal]);
    if (key === lastKey) return;
    lastKey = key;
    if (pending) client.cancel(pending);
    info.textContent = `simulating ${n} samples…`;
    const units = DATASHEET_UNITS[d.domain];
    pending = client.request({ type: 'adev', id: client.nextId(), spec, dt: s.scenario.dt, n, seed: s.scenario.seed, kind: s.scenario.devKind, profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal }, m => {
      pending = null;
      if (m.type !== 'adev') { info.textContent = m.type === 'error' ? m.message : ''; return; }
      const cutoff = n * s.scenario.dt / 10;
      const reliable = Float64Array.from(m.dev, (v, i) => (m.tau[i]! <= cutoff ? v : NaN));
      const faded = Float64Array.from(m.dev, (v, i) => (m.tau[i]! > cutoff ? v : NaN));
      const active = TERM_KEYS.filter(k => spec.coefs[k] > 0);
      // The analytic asymptotes (and their RSS total) are ADEV-specific: MDEV/HDEV have different
      // slopes for the same noise types (I4), and D has no attainable ADEV asymptote at all — the
      // Allan variance diverges for it (I7) — so it's excluded from the overlay even under ADEV.
      const isAdev = s.scenario.devKind === 'adev';
      const overlay = isAdev ? active.filter(k => k !== 'D') : [];
      chart.setSeries([
        { label: `${s.scenario.devKind.toUpperCase()} (simulated)`, color: PALETTE[0]!, width: 2.5 },
        { label: 'unreliable (τ > record/10)', color: PALETTE[7]!, width: 1 },
        { label: '68% band lo', color: PALETTE[0]!, width: 0.5, band: true },
        { label: '68% band hi', color: PALETTE[0]!, width: 0.5, band: true },
        ...(isAdev ? [{ label: 'analytic total', color: '#000', dash: [2, 3] }] : []),
        ...overlay.map((k, i) => ({ label: `${k} asymptote ${ASYMPTOTE_FORMULA[k]}`, color: PALETTE[(i + 1) % 8]!, dash: [8, 4], width: 1 })),
      ]);
      chart.setBands([[3, 4]]);
      chart.setData(m.tau, [reliable, faded, m.lo, m.hi, ...(isAdev ? [m.analyticTotal] : []), ...overlay.map(k => m.analytic[k])]);
      const slope: Record<keyof Coefs, string> = { Q: 'τ⁻¹', F: 'τ⁻¹', N: 'τ⁻¹ᐟ²', B: 'τ⁰', K: 'τ⁺¹ᐟ²', D: 'no asymptote (diverges)', R: 'τ⁺¹' };
      info.replaceChildren(
        h('table', {}, h('tr', {}, h('th', {}, 'coef'), h('th', {}, 'datasheet'), h('th', {}, 'SI'), ...(isAdev ? [h('th', {}, 'ADEV slope')] : [])),
          ...active.map(k => h('tr', {}, h('td', {}, dfn(k)), h('td', {}, `${d.coefs[k]} ${units[k]}`), h('td', {}, fmtSci(spec.coefs[k])), ...(isAdev ? [h('td', {}, slope[k])] : [])))),
        ...(isAdev ? [] : [h('p', {}, 'Analytic asymptotes are shown for ADEV only; MDEV/HDEV have different slopes (see glossary).')]),
      );
    });
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); chart.destroy(); } };
};
