import { h, numInput, select, expander, segmented, controlKey } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci, fmtTime } from '../charts';
import { activeReq, benchToSpec, effectiveTm, updateDomain, type AppState, type CompareBy, type Scenario } from '../state';
import { ERROR_UNIT } from '../../engine/units';
import { ESTIMATE_METHODS, type ContributionKey, type EstimateMethod } from '../../engine/models';
import { DELTA_T_LEVELS, NO_THERMAL, computeDeviceCurves, computeEstimates, flowdown, growthTimes, mcSummary, thermalFamily, valueAt } from './growthCompute';
import type { ViewFactory } from './types';

/**
 * Human-facing names for the estimate methods. The state/hash keys stay as they are
 * (`fudge`, `constant`, …) — this map exists only so the UI never shows raw jargon.
 * Pair it with `dfn(method, METHOD_LABEL[method])` so the glossary still explains each.
 */
export const METHOD_LABEL: Record<EstimateMethod, string> = {
  fudge: 'random-walk fudge', constant: 'constant bias', gm: 'Gauss-Markov', fittedK: 'fitted K',
};

// 'thermal' left this list in v1.2: the views always request no-thermal truth (spec §10.5),
// so the contribution could only ever be zero.
const CONTRIB: ContributionKey[] = ['initial', 'Q', 'N', 'B', 'K', 'D', 'R'];
const PCT_LABEL: Record<1 | 2 | 3, string> = { 1: '68th', 2: '95.5th', 3: '99.7th' };
const GHOST_COLOR = 'rgba(201, 160, 220, 0.16)';
type Mc = { runs: number; times: Float64Array; p50: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array; sample: Float64Array[] };

export const growthView: ViewFactory = (root, store, client) => {
  const controls = h('div', {});
  const mainEl = h('div', { class: 'chart' }), stackEl = h('div', { class: 'chart' }), readout = h('div', { class: 'readout' }), status = h('div', {}), simRow = h('div', {});
  const stackSection = h('div', {}, h('h3', {}, 'Contributions (first estimate method)'), stackEl);
  root.replaceChildren(
    h('p', {},
      'After the last external fix, nothing corrects the error — it grows. ',
      'Dashed lines are what the budget formulas predict. Faint traces are individual simulated runs. ',
      'The thick solid line is their ', dfn('percentile', 'percentile envelope'), '. ',
      'The red line is your ', dfn('requirement'), '. ',
      'Compare by strategy to judge the formulas, by device to shop the bench, by thermal to price a temperature-control error.'),
    h('p', { class: 'inferred' },
      'The analytic curves follow D. Bayard’s method (JPL EM-3455-00-005). This tool uses the same algebra as our open implementation: ',
      h('a', { href: 'https://github.com/translunar/bayard', target: '_blank', rel: 'noopener' }, 'translunar/bayard'), '.'),
    controls, mainEl, simRow, readout, status, stackSection);
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
   * via hasUserZoom(); with no zoom in force every batch rescales normally.
   */
  const renderAll = (s: AppState, mc: Mc | null, keepZoom = false): void => {
    const d = s.bench.find(x => x.id === s.selected);
    if (!d) return;
    const sc = s.scenario;
    const ds = sc.byDomain[d.domain];
    const spec = benchToSpec(d);
    const eu = ERROR_UNIT[d.domain];
    const req = activeReq(ds);
    const times = growthTimes({ spec, scenario: sc, dom: d.domain, req });
    const conv = (a: Float64Array) => Float64Array.from(a, eu.fromSI);
    const k = req?.sigma ?? 1;
    const reset = { resetScales: !(keepZoom && main.hasUserZoom()) };
    const reqLines = () => {
      main.clearLines();
      if (req) { main.addHLine(eu.fromSI(req.value), `requirement ${fmtSci(eu.fromSI(req.value))} ${eu.label} (${k}σ)`); main.addVLine(req.duration, fmtTime(req.duration)); }
    };
    stackSection.hidden = sc.compareBy !== 'strategy';

    if (sc.compareBy === 'device') {
      // §10.3: every bench device of the domain, one dashed formula curve each, no simulation.
      const devs = s.bench.filter(x => x.domain === d.domain);
      const curves = computeDeviceCurves(devs, sc, d.domain, req, times);
      main.setSeries(curves.map((c, i) => ({ label: `${c.name} (${METHOD_LABEL[sc.compareMethod]}, ${k}σ, formula)`, color: PALETTE[i % 8]!, dash: [6, 3] })));
      main.setBands([]);
      main.setData(times, curves.map(c => conv(c.scaled)), reset);
      main.setGhosts(times, [], GHOST_COLOR);
      reqLines();
      readout.replaceChildren(...curves.map(c => h('div', {},
        h('span', {}, `${c.name} at ${req ? fmtTime(req.duration) : '—'}`),
        h('b', {}, c.atReq === null ? '—' : `${fmtSci(eu.fromSI(c.atReq))} ${eu.label}`),
        `time to requirement: ${c.timeToReq === null ? 'never within span' : fmtTime(c.timeToReq)}`)));
      return;
    }

    if (sc.compareBy === 'thermal') {
      // §10.4: the MC envelope is the ΔT = 0 member; the family adds |tempco|·ΔT·t, worst case.
      const tempcoSI = spec.thermal?.tempco ?? 0;
      const grid = mc ? mc.times : times;
      const env = mc ? mcSummary(mc.times, mc, req).curve : null;
      const fam = mc && env && tempcoSI !== 0 ? thermalFamily(mc.times, env, tempcoSI) : DELTA_T_LEVELS.map(() => null);
      main.setSeries([
        { label: 'median of runs', color: PALETTE[0]!, width: 1, band: true },
        { label: `ΔT = 0 K — ${PCT_LABEL[k as 1 | 2 | 3]} %ile of ${sc.runs} runs`, color: PALETTE[0]!, width: 3, band: true },
        ...DELTA_T_LEVELS.map((dT, i) => ({ label: `ΔT = ${dT} K sustained`, color: PALETTE[(i + 1) % 8]!, width: 2 })),
      ]);
      main.setBands([[1, 2]]);
      main.setData(grid, [mc ? conv(mc.p50) : null, env ? conv(env) : null, ...fam.map(f => (f ? conv(f) : null))], reset);
      main.setGhosts(grid, mc ? mc.sample.map(conv) : [], GHOST_COLOR);
      reqLines();
      const envAtReq = mc && env && req ? valueAt(mc.times, env, req.duration) : null;
      const flowLabel = h('span', {}, dfn('flowdown', 'thermal flowdown'));
      const flowRow = tempcoSI === 0
        ? h('div', {}, flowLabel, h('b', {}, '—'), 'no temperature coefficient on this device — set one on the Devices tab')
        : !req
          ? h('div', {}, flowLabel, h('b', {}, '—'), 'set a requirement in the context strip to read a flowdown')
          : !mc || !env
            ? h('div', {}, flowLabel, h('b', {}, '…'))
            : (() => {
                const dT = flowdown(mc.times, env, tempcoSI, req);
                if (dT === null) return h('div', {}, flowLabel, h('b', {}, '—'));
                return dT <= 0
                  ? h('div', { class: 'warn' }, flowLabel, h('b', {}, 'requirement not met even at ΔT = 0'), 'the noise alone breaks the requirement — thermal control cannot save it')
                  : h('div', {}, flowLabel, h('b', {}, `hold sustained |ΔT| below ${Number(dT.toPrecision(2))} K`), 'quote it to the thermal team with margin');
              })();
      readout.replaceChildren(
        flowRow,
        h('div', {}, h('span', {}, `ΔT = 0 envelope at ${req ? fmtTime(req.duration) : '—'}`), h('b', {}, envAtReq == null ? (mc ? '—' : '…') : `${fmtSci(eu.fromSI(envAtReq))} ${eu.label}`)),
      );
      return;
    }

    // strategy mode — v1.1 behavior.
    const est = computeEstimates({ spec, scenario: sc, dom: d.domain, req }, times);
    const mcS = mc ? mcSummary(mc.times, mc, req) : null;
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
    main.setData(mc ? mc.times : times, [...est.map(c => conv(c.scaled)), medianCurve ? conv(medianCurve) : null, mcS ? conv(mcS.curve) : null], reset);
    main.setGhosts(mc ? mc.times : times, mc ? mc.sample.map(conv) : [], GHOST_COLOR);
    reqLines();
    readout.replaceChildren(
      ...est.map(c => h('div', {}, h('span', {}, dfn(c.method, METHOD_LABEL[c.method]), ` at ${req ? fmtTime(req.duration) : '—'}`), h('b', {}, c.atReq === null ? '—' : `${fmtSci(eu.fromSI(c.atReq))} ${eu.label}`), `time to requirement: ${c.timeToReq === null ? 'never within span' : fmtTime(c.timeToReq)}`)),
      h('div', {}, h('span', {}, 'simulated truth (percentile)'), h('b', {}, mcS?.atReq == null ? '…' : `${fmtSci(eu.fromSI(mcS.atReq))} ${eu.label}`), `time to requirement: ${mcS?.timeToReq == null ? (mc ? 'never within span' : '…') : fmtTime(mcS.timeToReq)}`),
      ...(mcS?.atReq != null ? est.map(c => h('div', { class: c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'warn' : '' }, h('span', {}, `truth / ${METHOD_LABEL[c.method]}`), h('b', {}, c.atReq ? (mcS.atReq! / c.atReq).toFixed(2) + '×' : '—'), c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'the formula is optimistic at this duration' : 'the formula is adequate or conservative here')) : []),
      h('div', {}, h('span', {}, 'T_m in use'), h('b', {}, fmtTime(effectiveTm(sc, d.domain)))),
    );
    const first = est[0];
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
    const mode = sc.compareBy;
    // Fix accuracy and turn-on bias are integrated-error quantities, so they are shown in the same
    // display unit as the context strip and every readout (deg / ns / m) rather than raw SI.
    const eu = ERROR_UNIT[d.domain];
    const fixUnit = `${eu.label} (1σ)`;
    // Rebuilding the panel destroys the element being typed in; remember which control had focus by
    // its stable data-key and put focus back afterwards, exactly as mountSidebar does. Only
    // user-driven store updates reach here — Monte Carlo progress ticks call renderAll directly.
    const activeKey = document.activeElement?.getAttribute('data-key') ?? null;
    controls.replaceChildren(
      h('div', { class: 'row' },
        h('label', {}, 'Compare by ', segmented(
          [{ value: 'strategy', label: 'strategy' }, { value: 'device', label: 'device' }, { value: 'thermal', label: 'thermal' }],
          mode, v => set(x => { x.compareBy = v as CompareBy; }), { key: 'growth:compareby' })),
        // §10.1: the single-method select exists only in device mode — strategy has its checkboxes,
        // and thermal compares against the simulated envelope, which no formula choice can alter.
        ...(mode === 'device'
          ? [select('method', ESTIMATE_METHODS.map(m => ({ value: m, label: METHOD_LABEL[m] })), sc.compareMethod, v => set(x => { x.compareMethod = v as EstimateMethod; }), { key: controlKey(['growth', 'comparemethod']) })]
          : [])),
      h('div', { class: 'row-3' },
        numInput('fix accuracy', eu.fromSI(ds.fix.sigma), v => setD(x => { x.fix.sigma = eu.toSI(v); }), { unit: fixUnit, min: 0, term: 'fix', key: controlKey(['growth', 'fixsigma']) }),
        numInput('fix bias', eu.fromSI(ds.fix.bias), v => setD(x => { x.fix.bias = eu.toSI(v); }), { unit: fixUnit, min: 0, term: 'turnOnBias', key: controlKey(['growth', 'fixbias']) }),
        numInput('fix cadence', ds.fix.cadence, v => setD(x => { x.fix.cadence = v; }), { unit: 's', min: 1e-6, key: controlKey(['growth', 'fixcadence']) })),
      // replaceChildren() is the native DOM method, which (unlike h()) rejects null children.
      ...(d.domain === 'clock' && d.states === 3
        ? [numInput('drift-rate uncertainty', sc.driftKnowledge ? Math.sqrt(sc.driftKnowledge) * 86400 : 0, v => set(x => { x.driftKnowledge = v > 0 ? (v / 86400) ** 2 : null; }), { unit: 'Δf/f per day, 1σ', term: 'driftKnowledge', min: 0, key: controlKey(['growth', 'driftknowledge']) }),
           ...(sc.driftKnowledge ? [] : [h('p', { class: 'inferred' }, '0 = aging assumed perfectly calibrated — optimistic beyond a few days; over months this term usually dominates.')])]
        : []),
      ...(mode === 'strategy'
        ? [expander('growth:methods', `more methods (active: ${sc.estimateMethods.map(m => METHOD_LABEL[m]).join(' + ')})`,
            h('div', {}, ...ESTIMATE_METHODS.map(m => h('label', { style: 'display:inline-block;margin-right:10px' },
              h('input', { type: 'checkbox', checked: sc.estimateMethods.includes(m) ? 'checked' : undefined, 'data-key': controlKey(['growth', 'method', m]), on: { change: e => set(x => { const on = (e.target as HTMLInputElement).checked; x.estimateMethods = on ? [...new Set([...x.estimateMethods, m])] : x.estimateMethods.filter(kk => kk !== m); }) } }), ' ', dfn(m, METHOD_LABEL[m])))),
            h('label', {}, dfn('Tm', 'model timescale T_m'), h('input', { value: sc.Tm === 'auto' ? 'auto' : String(sc.Tm), 'data-key': controlKey(['growth', 'tm']), on: { change: e => { const v = (e.target as HTMLInputElement).value.trim(); set(x => { x.Tm = v === 'auto' ? 'auto' : Math.max(1e-3, Number(v) || 1); }); } } })))]
        : []),
    );
    simRow.replaceChildren(expander('growth:sim', `sim: ${sc.runs} runs · span ${ds.duration} s · dt ${ds.dt} s · seed ${sc.seed}`,
      h('div', { class: 'row' },
        numInput('runs', sc.runs, v => set(x => { x.runs = Math.max(1, Math.round(v)); }), { min: 1, key: controlKey(['growth', 'runs']) }),
        numInput('span', ds.duration, v => setD(x => { x.duration = v; }), { unit: 's', min: 1, key: controlKey(['growth', 'span']) }),
        numInput('dt', ds.dt, v => setD(x => { x.dt = v; }), { unit: 's', min: 1e-4, key: controlKey(['growth', 'dt']) }),
        numInput('seed', sc.seed, v => set(x => { x.seed = v; }), { key: controlKey(['growth', 'seed']) }))));
    if (activeKey) root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus();

    if (mode === 'device') {
      // §10.3: formulas only. Cancel any running job and force a fresh MC on return to a simulated mode.
      if (pending) { client.cancel(pending); pending = null; }
      lastMc = null; lastKey = '';
      status.textContent = 'no simulation in this mode — every curve is a formula (runs and seed take effect in strategy and thermal)';
      renderAll(s, null);
      return;
    }

    const spec = benchToSpec(d);
    const req = activeReq(ds);
    const key = JSON.stringify([spec, ds.dt, ds.duration, sc.runs, sc.seed, ds.fix, sc.driftKnowledge, effectiveTm(sc, d.domain), req?.duration]); // estimateMethods/compareBy/compareMethod deliberately excluded: strategy and thermal share one MC job, and method toggles must not re-run it (renderAll recomputes the formula lines)
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
        pending = client.request({ type: 'mc', id: client.nextId(), batch: 10, req: { spec, dt: ds.dt, duration: mcDuration, runs: sc.runs, seed: sc.seed, ...NO_THERMAL, fix: ds.fix, driftKnowledge: sc.driftKnowledge, Tm: effectiveTm(sc, d.domain) } }, m => {
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
