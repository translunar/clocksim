import { h, numInput, select, expander, controlKey } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci, fmtTime } from '../charts';
import { activeReq, benchToSpec, effectiveTm, updateDomain, type AppState, type Scenario } from '../state';
import { ERROR_UNIT } from '../../engine/units';
import { ESTIMATE_METHODS, type ContributionKey, type EstimateMethod } from '../../engine/models';
import { computeEstimates, growthTimes, mcSummary, valueAt } from './growthCompute';
import type { ViewFactory } from './types';

/**
 * Human-facing names for the estimate methods. The state/hash keys stay as they are
 * (`fudge`, `constant`, …) — this map exists only so the UI never shows raw jargon.
 * Pair it with `dfn(method, METHOD_LABEL[method])` so the glossary still explains each.
 */
export const METHOD_LABEL: Record<EstimateMethod, string> = {
  fudge: 'random-walk fudge', constant: 'constant bias', gm: 'Gauss-Markov', fittedK: 'fitted K',
};

const CONTRIB: ContributionKey[] = ['initial', 'Q', 'N', 'B', 'K', 'D', 'R', 'thermal'];
const PCT_LABEL: Record<1 | 2 | 3, string> = { 1: '68th', 2: '95.5th', 3: '99.7th' };
const GHOST_COLOR = 'rgba(201, 160, 220, 0.16)';
type Mc = { runs: number; times: Float64Array; p50: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array; sample: Float64Array[] };

export const growthView: ViewFactory = (root, store, client) => {
  const controls = h('div', {});
  const mainEl = h('div', { class: 'chart' }), stackEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' }), status = h('div', {}), simRow = h('div', {});
  root.replaceChildren(
    h('p', {},
      'After the last external fix, nothing corrects the error — it grows. ',
      'Dashed lines are what the budget formulas predict (the ', dfn('fudge', "random-walk 'fudge'"), ' and the ', dfn('constant', 'constant-bias'), ' model by default). ',
      'Faint traces are individual simulated runs. ',
      'The thick solid line is their ', dfn('percentile', 'percentile envelope'), '. ',
      'The red line is your ', dfn('requirement'), '.'),
    h('p', { class: 'inferred' },
      'The analytic curves follow D. Bayard’s method (JPL EM-3455-00-005). This tool uses the same algebra as our open implementation: ',
      h('a', { href: 'https://github.com/translunar/bayard', target: '_blank', rel: 'noopener' }, 'translunar/bayard'), '.'),
    controls, mainEl, simRow, readout, status, h('h3', {}, 'Contributions (first estimate method)'), stackEl);
  const main = new LogLogChart(mainEl, { xLabel: 't since last fix (s)', yLabel: 'error' });
  const stack = new LogLogChart(stackEl, { xLabel: 't since last fix (s)', yLabel: 'σ contribution' });
  let pending: string | null = null, lastKey = '';
  let lastMc: Mc | null = null;

  /**
   * Charts + readouts only — never the control panel. It takes the state it draws from instead of
   * closing over `update`'s locals, so the worker callback can redraw from *current* state (a method
   * toggled mid-run stays toggled) without rebuilding any controls, which is what would steal focus
   * from a control the user is editing during a run.
   *
   * `keepZoom` marks a redraw of an unchanged scenario (the Monte Carlo progress ticks and the
   * key-unchanged re-render), where re-autoscaling would throw away a drag-zoom the user applied
   * mid-run. It only *permits* skipping autoscale — the chart still has to report an actual zoom
   * via hasUserZoom(). Skipping it unconditionally froze the y-scale at the formula-only range of
   * the first (mc = null) draw, clipping any envelope that grew above the formulas for the whole
   * run; with no zoom in force every batch rescales normally.
   */
  const renderAll = (s: AppState, mc: Mc | null, keepZoom = false): void => {
    const d = s.bench.find(x => x.id === s.selected);
    if (!d) return;
    const sc = s.scenario;
    const ds = sc.byDomain[d.domain];
    const spec = benchToSpec(d);
    const eu = ERROR_UNIT[d.domain];
    const req = activeReq(ds);
    const inputs = { spec, scenario: sc, dom: d.domain, req };
    const times = growthTimes(inputs);
    const est = computeEstimates(inputs, times);
    const conv = (a: Float64Array) => Float64Array.from(a, eu.fromSI);
    const k = req?.sigma ?? 1;

    // Plot MC-derived curves against the worker's own grid (I5 guard).
    const mcS = mc ? mcSummary(mc.times, mc, req) : null;
    // The band body runs from the median of |error| to the Nσ percentile envelope (§9.7).
    const medianCurve = mc ? mc.p50 : null;
    main.setSeries([
      ...est.map((c, i) => ({ label: `${METHOD_LABEL[c.method]} (${k}σ, formula)`, color: PALETTE[(i + 1) % 8]!, dash: [6, 3] })),
      { label: 'median of runs', color: PALETTE[0]!, width: 1, band: true },
      // Target run count, not the live mc.runs: setSeries rebuilds the uPlot instance whenever the
      // defs differ, so a label that ticked up each mc-progress batch destroyed the chart (and any
      // zoom) ~20 times per job. The status line under the chart carries the live progress instead.
      { label: `${PCT_LABEL[(req?.sigma ?? 1) as 1 | 2 | 3]} %ile of ${sc.runs} runs`, color: PALETTE[0]!, width: 3, band: true },
    ]);
    main.setBands([[est.length + 1, est.length + 2]]);
    main.setData(mc ? mc.times : times, [...est.map(c => conv(c.scaled)), medianCurve ? conv(medianCurve) : null, mcS ? conv(mcS.curve) : null], { resetScales: !(keepZoom && main.hasUserZoom()) });
    main.setGhosts(mc ? mc.times : times, mc ? mc.sample.map(conv) : [], GHOST_COLOR);
    main.clearLines();
    if (req) { main.addHLine(eu.fromSI(req.value), `requirement ${fmtSci(eu.fromSI(req.value))} ${eu.label} (${k}σ)`); main.addVLine(req.duration, fmtTime(req.duration)); }
    const first = est[0];
    const thermalAtReq = first && req ? valueAt(times, first.contributions.thermal, req.duration) : null;
    readout.replaceChildren(
      ...est.map(c => h('div', {}, h('span', {}, dfn(c.method, METHOD_LABEL[c.method]), ` at ${req ? fmtTime(req.duration) : '—'}`), h('b', {}, c.atReq === null ? '—' : `${fmtSci(eu.fromSI(c.atReq))} ${eu.label}`), `time to requirement: ${c.timeToReq === null ? 'never within span' : fmtTime(c.timeToReq)}`)),
      h('div', {}, h('span', {}, 'simulated truth (percentile)'), h('b', {}, mcS?.atReq == null ? '…' : `${fmtSci(eu.fromSI(mcS.atReq))} ${eu.label}`), `time to requirement: ${mcS?.timeToReq == null ? (mc ? 'never within span' : '…') : fmtTime(mcS.timeToReq)}`),
      ...(mcS?.atReq != null ? est.map(c => h('div', { class: c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'warn' : '' }, h('span', {}, `truth / ${METHOD_LABEL[c.method]}`), h('b', {}, c.atReq ? (mcS.atReq! / c.atReq).toFixed(2) + '×' : '—'), c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'the formula is optimistic at this duration' : 'the formula is adequate or conservative here')) : []),
      h('div', {}, h('span', {}, 'T_m in use'), h('b', {}, fmtTime(effectiveTm(sc, d.domain)))),
      h('div', {}, h('span', {}, dfn('thermal', 'thermal (truth only)')), h('b', {}, thermalAtReq == null ? '—' : `${fmtSci(eu.fromSI(thermalAtReq))} ${eu.label}`), 'the formulas never see this; only the simulated truth carries it'),
    );
    if (first) {
      const keys = CONTRIB.filter(key => first.contributions[key].some(v => v > 0));
      // Every contribution here is analytic (§9.7: dashed = formula).
      stack.setSeries(keys.map((key, i) => ({ label: key === 'B' ? `B (${METHOD_LABEL[first.method]})` : key, color: PALETTE[i % 8]!, dash: [6, 3] })));
      stack.setData(times, keys.map(key => conv(first.contributions[key])));
    }
  };

  const update = (s: AppState) => {
    const d = s.bench.find(x => x.id === s.selected);
    if (!d) return;
    const ds = s.scenario.byDomain[d.domain];
    const set = (fn: (x: Scenario) => void) => store.update(st => { const c = structuredClone(st.scenario); fn(c); return { ...st, scenario: c }; });
    const setD = (fn: (x: typeof ds) => void) => store.update(st => updateDomain(st, d.domain, fn));
    const sc = s.scenario;
    const profile = sc.temperature;
    const setKind = (v: string) => set(x => {
      x.temperature = v === 'step' ? { kind: 'step', amplitude: 5, at: 60 }
        : v === 'ramp' ? { kind: 'ramp', rate: 0.01 }
        : v === 'sinusoid' ? { kind: 'sinusoid', amplitude: 5, period: 5400 }
        : { kind: 'none' };
    });
    const profileFields = (): HTMLElement[] => {
      if (profile.kind === 'step') return [h('div', { class: 'row' },
        numInput('amplitude', profile.amplitude, v => set(x => { if (x.temperature.kind === 'step') x.temperature.amplitude = v; }), { unit: 'K', key: controlKey(['growth', 'step-amp']) }),
        numInput('at', profile.at, v => set(x => { if (x.temperature.kind === 'step') x.temperature.at = v; }), { unit: 's', key: controlKey(['growth', 'step-at']) }))];
      if (profile.kind === 'ramp') return [numInput('rate', profile.rate, v => set(x => { if (x.temperature.kind === 'ramp') x.temperature.rate = v; }), { unit: 'K/s', key: controlKey(['growth', 'ramp-rate']) })];
      if (profile.kind === 'sinusoid') return [h('div', { class: 'row' },
        numInput('amplitude', profile.amplitude, v => set(x => { if (x.temperature.kind === 'sinusoid') x.temperature.amplitude = v; }), { unit: 'K', key: controlKey(['growth', 'sin-amp']) }),
        numInput('period', profile.period, v => set(x => { if (x.temperature.kind === 'sinusoid') x.temperature.period = v; }), { unit: 's', key: controlKey(['growth', 'sin-period']) }))];
      return [];
    };
    // Fix accuracy and turn-on bias are integrated-error quantities, so they are shown in the same
    // display unit as the context strip and every readout (deg / ns / m) rather than raw SI.
    const eu = ERROR_UNIT[d.domain];
    const fixUnit = `${eu.label} (1σ)`;
    // Rebuilding the panel destroys the element being typed in; remember which control had focus by
    // its stable data-key and put focus back afterwards, exactly as mountSidebar does. Only
    // user-driven store updates reach here — Monte Carlo progress ticks call renderAll directly.
    const activeKey = document.activeElement?.getAttribute('data-key') ?? null;
    controls.replaceChildren(
      h('div', { class: 'row-3' },
        numInput('fix accuracy', eu.fromSI(ds.fix.sigma), v => setD(x => { x.fix.sigma = eu.toSI(v); }), { unit: fixUnit, min: 0, term: 'fix', key: controlKey(['growth', 'fixsigma']) }),
        numInput('fix bias', eu.fromSI(ds.fix.bias), v => setD(x => { x.fix.bias = eu.toSI(v); }), { unit: fixUnit, min: 0, term: 'turnOnBias', key: controlKey(['growth', 'fixbias']) }),
        numInput('fix cadence', ds.fix.cadence, v => setD(x => { x.fix.cadence = v; }), { unit: 's', min: 1e-6, key: controlKey(['growth', 'fixcadence']) })),
      // replaceChildren() is the native DOM method, which (unlike h()) rejects null children.
      ...(d.domain === 'clock' && d.states === 3
        ? [numInput('drift-rate uncertainty', sc.driftKnowledge ? Math.sqrt(sc.driftKnowledge) * 86400 : 0, v => set(x => { x.driftKnowledge = v > 0 ? (v / 86400) ** 2 : null; }), { unit: 'Δf/f per day, 1σ', term: 'driftKnowledge', min: 0, key: controlKey(['growth', 'driftknowledge']) }),
           ...(sc.driftKnowledge ? [] : [h('p', { class: 'inferred' }, '0 = aging assumed perfectly calibrated — optimistic beyond a few days; over months this term usually dominates.')])]
        : []),
      h('div', { class: 'row' },
        select('Temperature profile', [{ value: 'none', label: 'none' }, { value: 'step', label: 'step' }, { value: 'ramp', label: 'ramp' }, { value: 'sinusoid', label: 'sinusoid (orbital)' }], profile.kind, setKind, { key: controlKey(['growth', 'tempprofile']) }),
        h('label', {}, h('input', { type: 'checkbox', checked: sc.includeThermal ? 'checked' : undefined, 'data-key': controlKey(['growth', 'includethermal']), on: { change: e => set(x => { x.includeThermal = (e.target as HTMLInputElement).checked; }) } }), ' ', dfn('thermal', 'include thermal in truth'))),
      ...profileFields(),
      expander('growth:methods', `more methods (active: ${sc.estimateMethods.map(m => METHOD_LABEL[m]).join(' + ')})`,
        h('div', {}, ...ESTIMATE_METHODS.map(m => h('label', { style: 'display:inline-block;margin-right:10px' },
          h('input', { type: 'checkbox', checked: sc.estimateMethods.includes(m) ? 'checked' : undefined, 'data-key': controlKey(['growth', 'method', m]), on: { change: e => set(x => { const on = (e.target as HTMLInputElement).checked; x.estimateMethods = on ? [...new Set([...x.estimateMethods, m])] : x.estimateMethods.filter(k => k !== m); }) } }), ' ', dfn(m, METHOD_LABEL[m])))),
        h('label', {}, dfn('Tm', 'model timescale T_m'), h('input', { value: sc.Tm === 'auto' ? 'auto' : String(sc.Tm), 'data-key': controlKey(['growth', 'tm']), on: { change: e => { const v = (e.target as HTMLInputElement).value.trim(); set(x => { x.Tm = v === 'auto' ? 'auto' : Math.max(1e-3, Number(v) || 1); }); } } }))),
    );
    simRow.replaceChildren(expander('growth:sim', `sim: ${sc.runs} runs · span ${ds.duration} s · dt ${ds.dt} s · seed ${sc.seed}`,
      h('div', { class: 'row' },
        numInput('runs', sc.runs, v => set(x => { x.runs = Math.max(1, Math.round(v)); }), { min: 1, key: controlKey(['growth', 'runs']) }),
        numInput('span', ds.duration, v => setD(x => { x.duration = v; }), { unit: 's', min: 1, key: controlKey(['growth', 'span']) }),
        numInput('dt', ds.dt, v => setD(x => { x.dt = v; }), { unit: 's', min: 1e-4, key: controlKey(['growth', 'dt']) }),
        numInput('seed', sc.seed, v => set(x => { x.seed = v; }), { key: controlKey(['growth', 'seed']) }))));
    if (activeKey) root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus();

    const spec = benchToSpec(d);
    const req = activeReq(ds);

    const key = JSON.stringify([spec, ds.dt, ds.duration, sc.runs, sc.seed, ds.fix, sc.driftKnowledge, sc.temperature, sc.includeThermal, effectiveTm(sc, d.domain), req?.duration]); // estimateMethods deliberately excluded: toggling a method must not re-run the MC (renderAll recomputes the formula lines)
    if (key !== lastKey) {
      lastKey = key;
      if (pending) { client.cancel(pending); pending = null; }
      lastMc = null;
      renderAll(s, null);
      const mcDuration = Math.max(ds.duration, req?.duration ?? 0);
      const samples = Math.round(mcDuration / ds.dt);
      if (samples > 2_000_000) {
        status.textContent = 'simulation skipped: span/dt exceeds 2,000,000 samples — open "sim" and increase dt or shorten the span';
      } else {
        status.textContent = 'simulating runs…';
        pending = client.request({ type: 'mc', id: client.nextId(), batch: 10, req: { spec, dt: ds.dt, duration: mcDuration, runs: sc.runs, seed: sc.seed, profile: sc.temperature, includeThermal: sc.includeThermal, fix: ds.fix, driftKnowledge: sc.driftKnowledge, Tm: effectiveTm(sc, d.domain) } }, m => {
          if (m.type === 'mc-progress' || m.type === 'mc-done') {
            // Draw from current state, not from the state that issued the request: a method toggled
            // mid-run must survive the next batch. Charts and readouts only — no control rebuild.
            lastMc = m;
            const cur = store.get();
            renderAll(cur, m, true);
            status.textContent = m.type === 'mc-done' ? `done: ${m.runs} runs` : `${m.runs} / ${cur.scenario.runs} runs`;
          }
          if (m.type === 'mc-done' || m.type === 'error') { pending = null; if (m.type === 'error') status.textContent = m.message; }
        });
      }
    } else renderAll(s, lastMc, true);
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); main.destroy(); stack.destroy(); } };
};
