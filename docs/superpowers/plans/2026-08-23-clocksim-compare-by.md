# Compare-by (v1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Error-growth tab gains `Compare by: [strategy | device | thermal]` — one varying dimension per mode — and the v1 thermal-profile UI (profile select, lag, include-in-truth toggle) is removed, replaced by a sustained-ΔT family with a flowdown readout.

**Architecture:** Additive first, destructive last, so the tree compiles after every task: Task 1 adds `compareBy`/`compareMethod` to state; Task 2 adds the pure compute helpers (`thermalFamily`, `flowdown`, `computeDeviceCurves`, `NO_THERMAL`); Task 3 replaces `growth.ts` wholesale with the three-mode view; Task 4 removes `temperature`/`includeThermal` from state and every remaining consumer, and rewrites the copy (glossary, Guide, Devices lag field).

**Tech Stack:** TypeScript, vite, vitest, uPlot. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-clocksim-design.md` §10 (argues from §3.6, §9.4, §9.7). Where this plan and §10 disagree, §10 governs.

## Global Constraints

- Worker protocol unchanged (§10.5): every view sends `profile: { kind: 'none' }, includeThermal: false`. `src/engine/**` and `src/worker/**` are not modified by any task.
- ΔT levels are exactly `[0.1, 1, 10]` K; ΔT = 0 is the MC percentile envelope itself, never a separate computation.
- Chart grammar (§9.7): dashed = analytic formula, solid = simulated, red horizontal line = requirement. Thermal-family curves are solid (they inherit the simulated envelope).
- Never case-transform Greek letters or units: `σ`, `ΔT`, `τ` appear exactly as written; no CSS `text-transform` additions.
- Prose rule (§9.8): translate, don't simplify. Requirement/margin-oriented language.
- `npm test` and `npm run build` green at the end of every task; one commit per task ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The worst-case family adds linearly (`envelope + |tempco|·ΔT·t`), never RSS.

---

### Task 1: State — `compareBy` and `compareMethod` (additive)

**Files:**
- Modify: `src/ui/state.ts`
- Test: `tests/ui/store.test.ts`

**Interfaces:**
- Produces: `export type CompareBy = 'strategy' | 'device' | 'thermal'`; `Scenario.compareBy: CompareBy`; `Scenario.compareMethod: EstimateMethod`. Tasks 3–4 consume these. `temperature`/`includeThermal` are NOT removed here (Task 4 does that).

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('store', …)` block of `tests/ui/store.test.ts`:

```ts
  it('round-trips compareBy and compareMethod through the hash', () => {
    const s = defaultState();
    s.scenario.compareBy = 'thermal'; s.scenario.compareMethod = 'fudge';
    const back = fromHash(toHash(s));
    expect(back!.scenario.compareBy).toBe('thermal');
    expect(back!.scenario.compareMethod).toBe('fudge');
  });
  it('sanitizes bogus compareBy and compareMethod to defaults', () => {
    const s = defaultState();
    const raw = JSON.parse(atob(toHash(s).replace(/-/g, '+').replace(/_/g, '/'))) as { scenario: Record<string, unknown> };
    raw.scenario.compareBy = 'bogus';
    raw.scenario.compareMethod = 'nope';
    const h = btoa(JSON.stringify(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = fromHash(h);
    expect(back!.scenario.compareBy).toBe('strategy');
    expect(back!.scenario.compareMethod).toBe('constant');
  });
```

- [ ] **Step 2: Run to verify failure** — `npm test -- store` → FAIL (properties don't exist / sanitize drops them).

- [ ] **Step 3: Implement in `src/ui/state.ts`:**

1. Below the `View` type add:

```ts
/** Which single dimension the Error-growth chart varies (spec §10.1). */
export type CompareBy = 'strategy' | 'device' | 'thermal';
```

2. In `interface Scenario`, after `devKind: DevKind;` add:

```ts
  compareBy: CompareBy; compareMethod: EstimateMethod;
```

3. Next to `VALID_DEV_KINDS` add:

```ts
const VALID_COMPARE_BY = new Set<CompareBy>(['strategy', 'device', 'thermal']);
```

4. In `sanitizeScenario`, after the `devKind` line add:

```ts
  const compareBy = VALID_COMPARE_BY.has(o.compareBy as CompareBy) ? (o.compareBy as CompareBy) : defaults.compareBy;
  const compareMethod = VALID_ESTIMATE_METHODS.has(o.compareMethod as EstimateMethod) ? (o.compareMethod as EstimateMethod) : defaults.compareMethod;
```

and add `compareBy, compareMethod` to the returned object.

5. In `defaultState()`'s scenario, after `devKind: 'adev',` add:

```ts
      compareBy: 'strategy', compareMethod: 'constant',
```

- [ ] **Step 4: Run tests** — `npm test` → all pass (previous count + 2).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(state): compareBy and compareMethod scenario fields (spec §10.1)"` (with the Co-Authored-By trailer, as on every task).

---

### Task 2: Compute helpers — `NO_THERMAL`, `thermalFamily`, `flowdown`, `computeDeviceCurves`

**Files:**
- Modify: `src/ui/views/growthCompute.ts`
- Test: `tests/ui/growthCompute.test.ts`

**Interfaces:**
- Consumes: `Scenario.compareMethod` from Task 1; `estimateSigma`, `timeToRequirement`, `valueAt` already in the file's import scope; `BenchDevice`/`benchToSpec` from `../state`.
- Produces (Task 3 consumes verbatim):
  - `export const NO_THERMAL: { profile: { kind: 'none' }; includeThermal: false }`
  - `export const DELTA_T_LEVELS: number[]` (exactly `[0.1, 1, 10]`)
  - `export function thermalFamily(times: Float64Array, envelope: Float64Array, tempcoSI: number): Float64Array[]`
  - `export function flowdown(times: Float64Array, envelope: Float64Array, tempcoSI: number, req: Requirement): number | null`
  - `export interface DeviceCurve { id: string; name: string; scaled: Float64Array; atReq: number | null; timeToReq: number | null }`
  - `export function computeDeviceCurves(devices: BenchDevice[], sc: Scenario, dom: Domain, req: Requirement | null, times: Float64Array): DeviceCurve[]`

- [ ] **Step 1: Write the failing tests** — append to `tests/ui/growthCompute.test.ts` (extend the import line with `NO_THERMAL, DELTA_T_LEVELS, thermalFamily, flowdown, computeDeviceCurves`):

```ts
describe('compare-by compute (spec §10)', () => {
  const t = Float64Array.from([1, 10, 100]);
  const req = { id: 'r', value: 4, sigma: 3 as const, duration: 10 };
  it('thermalFamily adds |tempco|·ΔT·t to the envelope, sign-blind', () => {
    const fam = thermalFamily(t, Float64Array.from([1, 1, 1]), -2e-3);
    expect(DELTA_T_LEVELS).toEqual([0.1, 1, 10]);
    expect(fam.length).toBe(3);
    expect(fam[0]![2]).toBeCloseTo(1 + 2e-3 * 0.1 * 100, 12);
    expect(fam[2]![1]).toBeCloseTo(1 + 2e-3 * 10 * 10, 12);
  });
  it('flowdown solves (req − envelope(t_req)) / (|tempco|·t_req)', () => {
    expect(flowdown(t, Float64Array.from([1, 2, 3]), 0.01, req)).toBeCloseTo((4 - 2) / (0.01 * 10), 12);
    expect(flowdown(t, Float64Array.from([1, 2, 3]), -0.01, req)).toBeCloseTo((4 - 2) / (0.01 * 10), 12);
  });
  it('flowdown degenerate cases: ≤ 0 when noise alone violates; null without a tempco', () => {
    expect(flowdown(t, Float64Array.from([1, 5, 9]), 0.01, req)!).toBeLessThanOrEqual(0);
    expect(flowdown(t, Float64Array.from([1, 2, 3]), 0, req)).toBeNull();
  });
  it('computeDeviceCurves: one kσ curve per device under the single compareMethod', () => {
    const s2 = defaultState();
    const gyros = s2.bench.filter(d => d.domain === 'gyro');
    const grid = growthTimes({ spec, scenario: s2.scenario, dom: 'gyro', req: s2.scenario.byDomain.gyro.requirements[0]! });
    const curves = computeDeviceCurves(gyros, s2.scenario, 'gyro', s2.scenario.byDomain.gyro.requirements[0]!, grid);
    expect(curves.map(c => c.id)).toEqual(gyros.map(d => d.id));
    expect(curves[0]!.atReq).not.toBeNull();
    expect(curves[0]!.scaled[5]).toBeGreaterThan(0);
  });
  it('NO_THERMAL is the no-thermal request fragment', () => {
    expect(NO_THERMAL).toEqual({ profile: { kind: 'none' }, includeThermal: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- growthCompute` → FAIL (exports missing).

- [ ] **Step 3: Implement in `src/ui/views/growthCompute.ts`:**

1. Extend the imports: from `../state` also import `benchToSpec` and `type BenchDevice`.
2. Add near the top:

```ts
/** Thermal left the UI in v1.2 (spec §10.5): every request a view builds says "no thermal". */
export const NO_THERMAL = { profile: { kind: 'none' } as const, includeThermal: false as const };

/** Sustained temperature-offset levels of the §10.4 family. ΔT = 0 is the envelope itself. */
export const DELTA_T_LEVELS = [0.1, 1, 10];
```

3. In `computeEstimates`, replace `profile: sc.temperature, includeThermal: sc.includeThermal` with `...NO_THERMAL` in the `EstimateOptions` object.
4. Append:

```ts
/** Worst-case family (spec §10.4): envelope plus |tempco|·ΔT·t at each sustained level. Linear, not RSS — a sustained offset is a deterministic bias. */
export function thermalFamily(times: Float64Array, envelope: Float64Array, tempcoSI: number): Float64Array[] {
  return DELTA_T_LEVELS.map(dT => Float64Array.from(envelope, (v, i) => v + Math.abs(tempcoSI) * dT * times[i]!));
}

/**
 * Flowdown (spec §10.4): the largest sustained |ΔT| that still meets the requirement at its
 * duration. May be ≤ 0 (the noise alone already violates); null when no readout can be formed
 * (tempco is zero, or the requirement duration lies outside the grid).
 */
export function flowdown(times: Float64Array, envelope: Float64Array, tempcoSI: number, req: Requirement): number | null {
  if (tempcoSI === 0) return null;
  const e = valueAt(times, envelope, req.duration);
  if (e === null) return null;
  return (req.value - e) / (Math.abs(tempcoSI) * req.duration);
}

export interface DeviceCurve { id: string; name: string; scaled: Float64Array; atReq: number | null; timeToReq: number | null }

/** One analytic kσ curve per bench device of the domain, all under `scenario.compareMethod` (spec §10.3). */
export function computeDeviceCurves(devices: BenchDevice[], sc: Scenario, dom: Domain, req: Requirement | null, times: Float64Array): DeviceCurve[] {
  const ds = sc.byDomain[dom];
  const k = req?.sigma ?? 1;
  return devices.map(d => {
    const o: EstimateOptions = { method: sc.compareMethod, Tm: effectiveTm(sc, dom), fix: ds.fix, driftKnowledge: sc.driftKnowledge, dt: ds.dt, ...NO_THERMAL };
    const scaled = Float64Array.from(estimateSigma(benchToSpec(d), o, times), v => v * k);
    return { id: d.id, name: d.name, scaled, atReq: req ? valueAt(times, scaled, req.duration) : null, timeToReq: req ? timeToRequirement(times, scaled, req.value) : null };
  });
}
```

- [ ] **Step 4: Run tests** — `npm test` → all pass. (Behavioral note, expected: `computeEstimates` no longer sees thermal, so the strategy chart's thermal contribution is now always zero — the UI row still exists until Tasks 3–4 and will read `—`.)
- [ ] **Step 5: Commit** — `feat(growth): compare-by compute helpers — thermal family, flowdown, device curves (spec §10.3–10.4)`.

---

### Task 3: Growth view — three modes

**Files:**
- Modify: `src/ui/views/growth.ts` (full replacement below)

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce; `segmented(options, value, onChange, {key})` and `select(label, options, value, onChange, {key})` from `../dom`; `LogLogChart.setSeries/setBands/setData/setGhosts/clearLines/addHLine/addVLine/hasUserZoom` unchanged from v1.1.
- Produces: `METHOD_LABEL` re-exported unchanged (compare.ts does not import it; nothing else consumes this file).

Mode behavior (from §10.2–10.4), encoded in the file below:
- **strategy**: v1.1 path minus the thermal readout row and minus `'thermal'` in the contributions list; the temperature-profile controls are gone.
- **device**: no worker request at all; dashed curve per bench device of the active domain; contributions stack hidden; method select visible.
- **thermal**: same MC request as strategy; median band + envelope (ΔT = 0) + three solid family curves; dashed formulas hidden; flowdown readout with all four degenerate cases.
- The `▸ sim` expander stays in all three modes (span/dt shape the x-grid everywhere); runs/seed simply have no effect in device mode, and the status line says so.
- The MC cache key keeps its v1.1 fields minus `temperature`/`includeThermal`; `compareBy`/`compareMethod` stay OUT of the key — strategy ↔ thermal share one MC job, and toggling to device mode cancels it (`lastKey = ''` forces a re-run on return).

- [ ] **Step 1: Replace `src/ui/views/growth.ts` in full with:**

```ts
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
```

Note: `dfn('flowdown', …)` refers to a glossary key added in Task 4. Until then the term renders unexplained but nothing throws (`dfn` falls back to plain text for unknown keys — verify this; if it instead throws, use the plain string `'thermal flowdown'` here and let Task 4 swap in the `dfn`, and say so in your report).

- [ ] **Step 2: Type-check and test** — `npm run build && npm test` → clean, all pass (this file has no unit tests of its own; the repo has no jsdom).
- [ ] **Step 3: Manual smoke** — `npm run dev`, open the Error-growth tab: three segmented options; device mode instant and dashed-only with the stack hidden; thermal mode shows envelope + three solid curves for a device with a tempco (e.g. add the OCXO preset) and the flowdown readout.
- [ ] **Step 4: Commit** — `feat(growth): Compare-by — strategy | device | thermal modes (spec §10)`.

---

### Task 4: Removals and copy — state fields, plumbing, Devices lag, glossary, Guide

**Files:**
- Modify: `src/ui/state.ts`, `src/ui/views/adev.ts`, `src/ui/views/compare.ts`, `src/ui/views/devices.ts`, `src/ui/glossary.ts`, `src/ui/views/guide.ts`
- Test: `tests/ui/store.test.ts`, `tests/ui/glossary.test.ts`

**Interfaces:**
- Consumes: `NO_THERMAL` from Task 2; `CompareBy` fields from Task 1.
- Produces: `Scenario` without `temperature`/`includeThermal` (the final v1.2 shape). Nothing after this task consumes the removed fields — this task deletes every remaining reference.

- [ ] **Step 1: Write the failing tests:**

Append inside `describe('store', …)` in `tests/ui/store.test.ts`:

```ts
  it('drops the legacy temperature/includeThermal fields from old hashes', () => {
    const s = defaultState();
    const raw = JSON.parse(atob(toHash(s).replace(/-/g, '+').replace(/_/g, '/'))) as { scenario: Record<string, unknown> };
    raw.scenario.temperature = { kind: 'sinusoid', amplitude: 5, period: 5400 };
    raw.scenario.includeThermal = true;
    const h = btoa(JSON.stringify(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = fromHash(h);
    expect(back).not.toBeNull();
    expect('temperature' in back!.scenario).toBe(false);
    expect('includeThermal' in back!.scenario).toBe(false);
  });
```

Append to `tests/ui/glossary.test.ts` (match its existing import style):

```ts
  it('defines the v1.2 thermal entries', () => {
    expect(GLOSSARY.thermal.long).toMatch(/sustained/);
    expect(GLOSSARY.flowdown.short).toMatch(/another team/);
  });
```

- [ ] **Step 2: Run to verify failure** — `npm test -- store glossary` → the glossary test FAILS (no `flowdown` entry); the store test may already pass by construction — run it anyway and note the result.

- [ ] **Step 3: Implement:**

1. **`src/ui/state.ts`** — delete the `temperature: TempProfile; includeThermal: boolean;` lines from `Scenario`; delete the whole `sanitizeTemperature` function; delete the `import type { TempProfile } from '../engine/thermal';` line; in `sanitizeScenario` delete the `temperature` and `includeThermal` lines and remove both from the returned object; in `defaultState()` delete `temperature: { kind: 'none' }, includeThermal: true,`.
2. **`src/ui/views/adev.ts`** — import `NO_THERMAL` from `./adev`'s sibling `./growthCompute`; change the cache key to `JSON.stringify([spec, n, ds.dt, s.scenario.seed, s.scenario.devKind])` and the request to spread `...NO_THERMAL` in place of `profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal`.
3. **`src/ui/views/compare.ts`** — same substitution in the `estimateSigma` options inside `renderReadout`: replace `profile: s.scenario.temperature, includeThermal: s.scenario.includeThermal` with `...NO_THERMAL` (import it from `./growthCompute`).
4. **`src/ui/views/devices.ts`** — in the thermal expander, delete the `numInput('thermal lag', …)` control (keep the checkbox and the tempco input; `tauTh` stays in the JSON untouched — when the checkbox creates a fresh block it stays `{ tempco: 0, tauTh: 0 }`).
5. **`src/ui/glossary.ts`** — replace the `thermal` entry and add `flowdown` directly after it:

```ts
  thermal: { short: 'Bias shift caused by a temperature offset', long: 'Temperature coefficient times temperature offset equals rate bias, and a sustained offset therefore grows error linearly in time: tempco · ΔT · t. A bench ADEV never shows this — the bench is temperature-controlled — so the chart states it separately, as a family of what-if curves at 0.1, 1, and 10 K held indefinitely. If the 1 K curve breaks your requirement, the device needs thermal control tighter than 1 K. The curves are worst case by construction: the offset is taken as a steady bias, not a noise, so it adds linearly, and no credit is taken for lag or cancellation.' },
  flowdown: { short: 'A requirement you hand to another team', long: 'The thermal view ends in a number: hold sustained |ΔT| below X K and the requirement survives. That number is not a design knob here — it becomes the thermal team\'s requirement, and passing it across disciplines is called flowdown. Quote it with margin: if the chart says 1.3 K, ask for 1 K.' },
```

6. **`src/ui/views/guide.ts`** — replace the `thermal` example and its Guide section:

```ts
  thermal: ex(() => { const s = defaultState(); const o = P('ocxo'); o.thermal = { tempco: 0.02, tauTh: 600 }; s.bench = [o]; s.selected = 'ocxo'; s.scenario.compareBy = 'thermal'; return { ...updateDomain(s, 'clock', ds => { ds.duration = 6 * 3600; ds.requirements = [{ id: 'c1', value: 1e-6, sigma: 3, duration: 3 * 3600 }]; ds.activeRequirement = 'c1'; }), view: 'growth' as const }; }),
```

```ts
    h('section', {},
      h('h3', {}, 'Thermal: a requirement you hand the thermal team'),
      h('p', {},
        'An ADEV is measured on a bench at constant temperature; your mission is not so lucky. ',
        'The thermal view asks one question: how much sustained temperature offset can this device absorb and still meet the requirement? ',
        'The answer is a number in kelvin. It is not yours to tune — it is a requirement you ', dfn('flowdown', 'flow down'), ' to the thermal team, with margin.'),
      link(EXAMPLES.thermal)),
```

7. If Task 3 reported that it used a plain string instead of `dfn('flowdown', …)` in `growth.ts`, swap the `dfn` in now.

- [ ] **Step 4: Run everything** — `npm test && npm run build` → all pass, clean build. `grep -rn "includeThermal\|scenario.temperature" src/ui/` must return nothing.
- [ ] **Step 5: Commit** — `feat(ui): retire the thermal-profile UI — sustained-ΔT flowdown replaces it (spec §10.5)`.

---

## Self-review (done at plan-writing time)

- Spec coverage: §10.1 → T1 + T3 controls; §10.2 → T3 strategy branch; §10.3 → T2 `computeDeviceCurves` + T3 device branch; §10.4 → T2 `thermalFamily`/`flowdown` + T3 thermal branch incl. all four degenerate readouts; §10.5 → T2 `NO_THERMAL` + T4 removals; §10.6 → tests in T1/T2/T4.
- Compile-order: every task leaves a compiling tree (fields added before used; removed only after the last consumer is rewritten).
- Type consistency: `thermalFamily(times, envelope, tempcoSI)` and `flowdown(times, envelope, tempcoSI, req)` use the same argument order in T2 definitions, T2 tests, and T3 call sites; `DeviceCurve` fields match T3's usage (`c.name`, `c.scaled`, `c.atReq`, `c.timeToReq`).
