# clocksim v1.1 UI Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the clocksim UI per spec §9: tabs-only navigation with Guide and Devices tabs, a minimal context strip, contextual per-tab controls, per-domain scenario defaults, visible Monte Carlo trajectories, the frozen/translunar dark visual style, and a plain-language prose rewrite.

**Architecture:** Pure-TypeScript DOM UI (no framework), uPlot charts, engine untouched. The state model changes once (per-domain scenarios), then each view is reworked to own its controls. One worker-protocol extension (MC trajectory subsample).

**Tech Stack:** TypeScript, Vite, Vitest, uPlot. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-clocksim-design.md` — §9 governs; §9.10 lists what must not change.

## Global Constraints

- `npm test` green and `npm run build` (which runs `tsc --noEmit`) clean **after every task**. The suite currently has 117 tests; none may be deleted except `tests/ui/lessons.test.ts` (Task 1) whose feature is removed by spec §9.6.
- `src/engine/**` math is untouched. The only worker change is the `mc` trajectory subsample (§9.10, Task 3).
- Prose standard (§9.8): *translate, don't simplify* — never inaccurate for the sake of accessibility; one idea per sentence; no colon-chained clause stacks. All user-visible copy written in a task must follow this.
- Visual tokens (§9.9), exact values: background `#0d0a14`, panel `#13101c`, text `#e2ddf0`, muted `#8a7fa8`, brand `#a87dc8`, secondary accent `#f4a7c0`, borders `#2a2040` and `#3d3060`, requirement-line red `#e2564a`. Fonts: Space Grotesk (headings/UI), Space Mono (numbers/coefficients). Dark-only.
- Chart grammar (§9.7): dashed = analytic formula, solid = simulated, red horizontal line = requirement.
- No emitted file may start with `_` (Jekyll drops them). Vite emits none by default; do not configure anything that would.
- Per-domain defaults (§9.5): see the table in Task 2 — copy those exact values.
- Every glossary key referenced by `dfn('term', …)` must exist in `GLOSSARY`. Keys are stable; only entry text changes (Task 13).
- Vitest runs in a node environment (no DOM). DOM-factory code is covered by `tsc --noEmit` and by use; pure functions get unit tests.

---

## File Structure

| File | Fate |
|---|---|
| `src/ui/lessons.ts`, `tests/ui/lessons.test.ts` | deleted (T1) |
| `src/ui/state.ts` | per-domain `Scenario` (T2) |
| `src/ui/store.ts` | `VALID_VIEWS` grows (T10, T12) |
| `src/worker/protocol.ts`, `src/worker/handler.ts` | `sample` field on mc responses (T3) |
| `index.html`, `src/ui/styles.css`, `src/ui/charts.ts`, `src/ui/format.ts` | dark theme (T4) |
| `src/ui/dom.ts` | `expander`, `segmented` helpers (T5) |
| `src/ui/views/adev.ts` | rework (T6) |
| `src/ui/views/growth.ts`, `growthCompute.ts` | rework + spaghetti (T2, T7) |
| `src/ui/views/sizing.ts`, `sizingCompute.ts` | rework (T2, T8) |
| `src/ui/views/compare.ts` | rework (T2, T9) |
| `src/ui/views/devices.ts` | new — editor moves here from sidebar (T10) |
| `src/ui/sidebar.ts` | rewritten as context strip (T11) |
| `src/ui/views/guide.ts` | new (T12) |
| `src/ui/glossary.ts` | all entries rewritten (T13) |
| `src/ui/app.ts` | lessons out (T1), tabs grow (T10, T12) |

---

### Task 1: Remove lessons

The Guide tab (Task 12) replaces lessons per spec §9.6. Removing lessons first shrinks every later task's ripple.

**Files:**
- Modify: `src/ui/app.ts`
- Delete: `src/ui/lessons.ts`, `tests/ui/lessons.test.ts`

- [ ] **Step 1: Edit `src/ui/app.ts`** — remove the import of `LESSONS` and the import of `select` from `./dom` (keep `h`); remove the `banner` and `lessonBox` variable declarations; remove `lessonBox` and `banner` from the `h('main', …)` children list; remove the entire `lessonBox.replaceChildren(…)` statement in `render`.
- [ ] **Step 2: Delete files**

```bash
git rm src/ui/lessons.ts tests/ui/lessons.test.ts
```

- [ ] **Step 3: Verify** — `npm test` green, `npm run build` clean, `npx vite dev` still renders tabs + views (no lesson dropdown, no banner).
- [ ] **Step 4: Commit** — `git commit -m "refactor(ui): remove lessons (superseded by Guide tab, spec §9.6)"`

---

### Task 2: Per-domain scenario state

**Files:**
- Modify: `src/ui/state.ts` (the `Scenario` type and everything around it)
- Modify: `src/ui/sidebar.ts`, `src/ui/views/adev.ts`, `src/ui/views/growth.ts`, `src/ui/views/growthCompute.ts`, `src/ui/views/compare.ts`, `src/ui/views/sizing.ts`, `src/ui/views/sizingCompute.ts` (mechanical re-pointing)
- Test: `tests/ui/store.test.ts` (additions + updates), `tests/ui/growthCompute.test.ts`, `tests/ui/sizingCompute.test.ts` (constructor updates)

**Interfaces (Produces — later tasks rely on these exact names):**

```ts
// src/ui/state.ts
import type { Domain } from '../engine/units';

export interface DomainScenario {
  duration: number; dt: number; fix: FixQuality;
  requirements: Requirement[]; activeRequirement: string | null;
}
export interface Scenario {
  runs: number; seed: number;
  byDomain: Record<Domain, DomainScenario>;
  driftKnowledge: number | null;
  temperature: TempProfile; includeThermal: boolean;
  Tm: number | 'auto'; estimateMethods: EstimateMethod[];
  devKind: DevKind;
  compare: { dut: string | null; ref: string | null; osc: string | null; leak: number; floorQ: number };
}
export function activeDomain(s: AppState): Domain;          // selected device's domain, 'gyro' if none
export function domScenario(s: AppState): DomainScenario;   // s.scenario.byDomain[activeDomain(s)]
export function activeReq(ds: DomainScenario): Requirement | null;
export function effectiveTm(sc: Scenario, dom: Domain): number;   // SIGNATURE CHANGE
export function updateDomain(s: AppState, dom: Domain, fn: (ds: DomainScenario) => void): AppState;
export function defaultDomainScenarios(): Record<Domain, DomainScenario>;
```

- [ ] **Step 1: Write failing tests** — append to `tests/ui/store.test.ts`:

```ts
import { defaultState, activeDomain, domScenario, updateDomain, effectiveTm } from '../../src/ui/state';
import { toHash, fromHash } from '../../src/ui/store';

describe('per-domain scenario (spec §9.5)', () => {
  it('has the spec §9.5 defaults per domain', () => {
    const b = defaultState().scenario.byDomain;
    expect(b.gyro).toMatchObject({ duration: 3600, dt: 0.1, fix: { sigma: 333e-6, cadence: 0.5, bias: 0 } });
    expect(b.accel).toMatchObject({ duration: 3600, dt: 0.1, fix: { sigma: 3, cadence: 1, bias: 0 } });
    expect(b.clock).toMatchObject({ duration: 86400, dt: 1, fix: { sigma: 10e-9, cadence: 1, bias: 0 } });
    expect(b.gyro.requirements[0]).toMatchObject({ value: Math.PI / 180, sigma: 3, duration: 600 });
    expect(b.accel.requirements[0]).toMatchObject({ value: 100, sigma: 3, duration: 600 });
    expect(b.clock.requirements[0]).toMatchObject({ value: 1e-6, sigma: 3, duration: 86400 });
    expect(defaultState().scenario.estimateMethods).toEqual(['fudge', 'constant']);
  });
  it('activeDomain follows the selected device; clock devices see clock scenario', () => {
    const s = defaultState();               // bench: lsm6dsl-gyro, csac, ocxo; selected gyro
    expect(activeDomain(s)).toBe('gyro');
    const s2 = { ...s, selected: 'csac' };
    expect(activeDomain(s2)).toBe('clock');
    expect(domScenario(s2).fix.sigma).toBe(10e-9);   // the cesium/rubidium bug fix
  });
  it('updateDomain patches one domain immutably', () => {
    const s = defaultState();
    const s2 = updateDomain(s, 'clock', ds => { ds.dt = 10; });
    expect(s2.scenario.byDomain.clock.dt).toBe(10);
    expect(s.scenario.byDomain.clock.dt).toBe(1);
    expect(s2.scenario.byDomain.gyro).toEqual(s.scenario.byDomain.gyro);
  });
  it('effectiveTm uses the domain requirement duration when auto', () => {
    const sc = defaultState().scenario;
    expect(effectiveTm(sc, 'gyro')).toBe(600);
    expect(effectiveTm(sc, 'clock')).toBe(86400);
    expect(effectiveTm({ ...sc, Tm: 42 }, 'gyro')).toBe(42);
  });
  it('hash round-trips per-domain scenarios', () => {
    const s = updateDomain(defaultState(), 'clock', ds => { ds.fix.sigma = 5e-9; });
    const back = fromHash(toHash(s))!;
    expect(back.scenario.byDomain.clock.fix.sigma).toBe(5e-9);
  });
  it('a legacy v1.0 flat-scenario hash degrades to defaults without crashing', () => {
    const legacy = { ...defaultState(), scenario: { duration: 3600, dt: 0.1, runs: 200, seed: 1, fix: { sigma: 333e-6, cadence: 0.5, bias: 0 } } };
    const back = fromHash(toHash(legacy as never));
    expect(back).not.toBeNull();
    expect(back!.scenario.byDomain.gyro.dt).toBe(0.1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/ui/store.test.ts` — expect FAIL (byDomain undefined).
- [ ] **Step 3: Rewrite the scenario section of `src/ui/state.ts`.** Replace the `Scenario` interface with the one in Interfaces above (add `import type { Domain } from '../engine/units';`). Add:

```ts
export function defaultDomainScenarios(): Record<Domain, DomainScenario> {
  return {
    gyro:  { duration: 3600,  dt: 0.1, fix: { sigma: 333e-6, cadence: 0.5, bias: 0 },
             requirements: [{ id: 'g1', value: Math.PI / 180, sigma: 3, duration: 600 }], activeRequirement: 'g1' },
    accel: { duration: 3600,  dt: 0.1, fix: { sigma: 3, cadence: 1, bias: 0 },
             requirements: [{ id: 'a1', value: 100, sigma: 3, duration: 600 }], activeRequirement: 'a1' },
    clock: { duration: 86400, dt: 1,   fix: { sigma: 10e-9, cadence: 1, bias: 0 },
             requirements: [{ id: 'c1', value: 1e-6, sigma: 3, duration: 86400 }], activeRequirement: 'c1' },
  };
}

export function activeDomain(s: AppState): Domain {
  return s.bench.find(d => d.id === s.selected)?.domain ?? 'gyro';
}
export function domScenario(s: AppState): DomainScenario {
  return s.scenario.byDomain[activeDomain(s)];
}
export function activeReq(ds: DomainScenario): Requirement | null {
  return ds.requirements.find(r => r.id === ds.activeRequirement) ?? null;
}
export function updateDomain(s: AppState, dom: Domain, fn: (ds: DomainScenario) => void): AppState {
  const byDomain = structuredClone(s.scenario.byDomain);
  fn(byDomain[dom]);
  return { ...s, scenario: { ...s.scenario, byDomain } };
}
```

Replace `effectiveTm` with:

```ts
export function effectiveTm(sc: Scenario, dom: Domain): number {
  if (sc.Tm !== 'auto') return sc.Tm;
  const ds = sc.byDomain[dom];
  const r = ds.requirements.find(x => x.id === ds.activeRequirement) ?? ds.requirements[0];
  return r ? r.duration : ds.duration;
}
```

Add a domain-scenario sanitizer and rebuild `sanitizeScenario` around it (keep `sanitizeFix`, `sanitizeRequirements`, `sanitizeTemperature`, `sanitizeCompare` as they are):

```ts
function sanitizeDomainScenario(raw: unknown, fallback: DomainScenario): DomainScenario {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const duration = isPositive(o.duration) ? o.duration : fallback.duration;
  const dt = isPositive(o.dt) ? o.dt : fallback.dt;
  const fix = sanitizeFix(o.fix, fallback.fix);
  const requirements = sanitizeRequirements(o.requirements, fallback.requirements);
  const activeRequirement =
    typeof o.activeRequirement === 'string' && requirements.some(r => r.id === o.activeRequirement)
      ? o.activeRequirement : (requirements[0]?.id ?? null);
  return { duration, dt, fix, requirements, activeRequirement };
}

export function sanitizeScenario(raw: unknown, defaults: Scenario): Scenario {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const runs = isPositive(o.runs) && Number.isInteger(o.runs) ? o.runs : defaults.runs;
  const seed = isFiniteNum(o.seed) ? o.seed : defaults.seed;
  const rawBy = o.byDomain && typeof o.byDomain === 'object' ? (o.byDomain as Record<string, unknown>) : {};
  const byDomain = {
    gyro: sanitizeDomainScenario(rawBy.gyro, defaults.byDomain.gyro),
    accel: sanitizeDomainScenario(rawBy.accel, defaults.byDomain.accel),
    clock: sanitizeDomainScenario(rawBy.clock, defaults.byDomain.clock),
  };
  const driftKnowledge = o.driftKnowledge === null ? null : isNonNegative(o.driftKnowledge) ? o.driftKnowledge : defaults.driftKnowledge;
  const temperature = sanitizeTemperature(o.temperature, defaults.temperature);
  const includeThermal = typeof o.includeThermal === 'boolean' ? o.includeThermal : defaults.includeThermal;
  const Tm = o.Tm === 'auto' ? 'auto' : isPositive(o.Tm) ? o.Tm : defaults.Tm;
  const filteredMethods = Array.isArray(o.estimateMethods)
    ? o.estimateMethods.filter((m): m is EstimateMethod => VALID_ESTIMATE_METHODS.has(m as EstimateMethod))
    : [];
  const estimateMethods = filteredMethods.length > 0 ? filteredMethods : defaults.estimateMethods;
  const devKind = VALID_DEV_KINDS.has(o.devKind as DevKind) ? (o.devKind as DevKind) : defaults.devKind;
  const compare = sanitizeCompare(o.compare, defaults.compare);
  return { runs, seed, byDomain, driftKnowledge, temperature, includeThermal, Tm, estimateMethods, devKind, compare };
}
```

In `defaultState()`, the scenario becomes:

```ts
scenario: {
  runs: 200, seed: 1,
  byDomain: defaultDomainScenarios(),
  driftKnowledge: null,
  temperature: { kind: 'none' }, includeThermal: true,
  Tm: 'auto', estimateMethods: ['fudge', 'constant'],
  devKind: 'adev',
  compare: { dut: 'csac', ref: 'ocxo', osc: 'ocxo', leak: 0, floorQ: 1e-12 },
},
```

- [ ] **Step 4: Re-point the consumers (mechanical; all these panels are rewritten in later tasks — keep edits minimal, just make them compile and behave):**

  - `src/ui/sidebar.ts` — in `scenarioPanel` and `requirementsPanel`, add at the top: `const dom = activeDomain(s); const ds = s.scenario.byDomain[dom];` and `const setD = (fn: (d: DomainScenario) => void) => store.update(st => updateDomain(st, dom, fn));`. Then: duration, dt, fix.sigma, fix.cadence, fix.bias controls read from `ds.*` and write via `setD`; the requirements rows read `ds.requirements` / `ds.activeRequirement` and write via `setD`; runs, seed, temperature, includeThermal, Tm, estimateMethods, devKind, driftKnowledge stay on `s.scenario.*` via the existing `set`. Import `activeDomain`, `updateDomain`, `type DomainScenario` from `./state`.
  - `src/ui/views/adev.ts` — `const ds = s.scenario.byDomain[d.domain];`; use `ds.duration`, `ds.dt` everywhere `s.scenario.duration` / `s.scenario.dt` appeared (including the cache key and the worker request); seed stays `s.scenario.seed`.
  - `src/ui/views/growthCompute.ts` — full replacement:

```ts
import type { DeviceSpec } from '../../engine/bench';
import { contributions, estimateSigma, timeToRequirement, type ContributionKey, type EstimateMethod, type EstimateOptions } from '../../engine/models';
import { logTimes } from '../../engine/montecarlo';
import { effectiveTm, type Requirement, type Scenario } from '../state';
import type { Domain } from '../../engine/units';

export interface GrowthInputs { spec: DeviceSpec; scenario: Scenario; dom: Domain; req: Requirement | null }
export interface MethodCurve { method: EstimateMethod; sigma: Float64Array; scaled: Float64Array; atReq: number | null; timeToReq: number | null; contributions: Record<ContributionKey, Float64Array> }

export function growthTimes(i: GrowthInputs): Float64Array {
  const ds = i.scenario.byDomain[i.dom];
  return logTimes(ds.dt, Math.max(ds.duration, i.req?.duration ?? 0));
}

export function valueAt(times: Float64Array, curve: Float64Array, t: number): number | null {
  if (t < times[0]! || t > times[times.length - 1]!) return null;
  for (let j = 1; j < times.length; j++) if (t <= times[j]!) {
    // Exact grid hits: return the stored sample directly rather than round-tripping through
    // log/exp, which can perturb an exact value (e.g. Math.exp(Math.log(3)) !== 3).
    if (t === times[j - 1]!) return curve[j - 1]!;
    if (t === times[j]!) return curve[j]!;
    const a = curve[j - 1]!, b = curve[j]!;
    if (!(a > 0) || !(b > 0)) return b;
    const f = (Math.log(t) - Math.log(times[j - 1]!)) / (Math.log(times[j]!) - Math.log(times[j - 1]!));
    return Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a)));
  }
  return curve[0]!;
}

export function computeEstimates(i: GrowthInputs, times: Float64Array): MethodCurve[] {
  const sc = i.scenario;
  const ds = sc.byDomain[i.dom];
  return sc.estimateMethods.map(method => {
    const o: EstimateOptions = { method, Tm: effectiveTm(sc, i.dom), fix: ds.fix, driftKnowledge: sc.driftKnowledge, dt: ds.dt, profile: sc.temperature, includeThermal: sc.includeThermal };
    const sigma = estimateSigma(i.spec, o, times);
    const k = i.req?.sigma ?? 1;
    const scaled = Float64Array.from(sigma, v => v * k);
    return { method, sigma, scaled, contributions: contributions(i.spec, o, times), atReq: i.req ? valueAt(times, scaled, i.req.duration) : null, timeToReq: i.req ? timeToRequirement(times, scaled, i.req.value) : null };
  });
}

export function mcSummary(times: Float64Array, env: { p68: Float64Array; p95: Float64Array; p997: Float64Array }, req: Requirement | null) {
  const curve = req?.sigma === 3 ? env.p997 : req?.sigma === 2 ? env.p95 : env.p68;
  return { curve, atReq: req ? valueAt(times, curve, req.duration) : null, timeToReq: req ? timeToRequirement(times, curve, req.value) : null };
}
```

  - `src/ui/views/growth.ts` — `const ds = s.scenario.byDomain[d.domain];`; `req` comes from `ds.requirements.find(r => r.id === ds.activeRequirement) ?? null`; `inputs = { spec, scenario: s.scenario, dom: d.domain, req }`; the cache key uses `ds.dt, ds.duration, ds.fix` in place of the old flat fields; `effectiveTm(s.scenario)` → `effectiveTm(s.scenario, d.domain)` (both call sites); `mcDuration = Math.max(ds.duration, req?.duration ?? 0)`; `samples = Math.round(mcDuration / ds.dt)`; the worker request passes `dt: ds.dt`, `fix: ds.fix`, `Tm: effectiveTm(s.scenario, d.domain)`; runs/seed stay `s.scenario.runs` / `s.scenario.seed`.
  - `src/ui/views/compare.ts` — DMTD is clocks-only, so it always uses the clock domain regardless of selection: `const cs = s.scenario.byDomain.clock;`; `adevSampleCount(cs.duration, cs.dt)`; `dt: cs.dt` in the request and cache key; in `renderReadout`, `req` from `cs.requirements`/`cs.activeRequirement`, `logTimes(cs.dt, Math.max(cs.duration, req.duration))`, `fix: cs.fix`, `effectiveTm(s.scenario, 'clock')`, `dt: cs.dt`.
  - `src/ui/views/sizingCompute.ts` — `computeKnee(devices, scenario, dom, req)` gains a `dom: Domain` parameter; inside, `const ds = scenario.byDomain[dom];` and use `ds.fix.sigma`, `ds.fix.bias`, `effectiveTm(scenario, dom)`.
  - `src/ui/views/sizing.ts` — pass `sel.domain` as the new `dom` argument; `req` from `s.scenario.byDomain[sel.domain]`.
  - `tests/ui/growthCompute.test.ts` and `tests/ui/sizingCompute.test.ts` — where they build a `Scenario` literal, build it as `const sc = defaultState().scenario;` (import `defaultState`) and override fields via `sc.byDomain.gyro.dt = …` etc.; add the new `dom` argument to `computeKnee` calls and `GrowthInputs`.

- [ ] **Step 5: Run** `npm test` — all green. `npm run build` clean.
- [ ] **Step 6: Manual check** — dev server: select CSAC on the bench, open Error growth. The cesium/rubidium symptom is gone: clock curves now start near nanoseconds, not hundreds of nanoseconds, and differ visibly between clocks.
- [ ] **Step 7: Commit** — `git commit -m "feat(state): per-domain scenario defaults (spec §9.5) — clocks no longer inherit gyro fix quality"`

---

### Task 3: Worker MC trajectory subsample

**Files:**
- Modify: `src/worker/protocol.ts`, `src/worker/handler.ts`
- Test: `tests/worker/protocol.test.ts`

**Interfaces (Produces):** `mc-progress` and `mc-done` messages gain `sample: Float64Array[]` — the first `min(25, runs)` runs' |error| curves on the `times` grid — and `p50: Float64Array` (the median, the §9.7 band floor). `export const SAMPLE_TRAJECTORIES = 25` from `protocol.ts`.

- [ ] **Step 1: Write failing test** — append to `tests/worker/protocol.test.ts` (mirror the existing mc test's request construction — same `spec`/`fix` fixtures already in that file):

```ts
it('mc responses carry a trajectory subsample for spaghetti (spec §9.7)', async () => {
  const messages: WorkerResponse[] = [];
  const req = { /* copy the MCRequest literal used by the existing mc test */ runs: 30 } as MCRequest;
  await handleRequest({ type: 'mc', id: 'x', req, batch: 10 }, m => messages.push(m));
  const done = messages.find(m => m.type === 'mc-done')!;
  expect(done.sample.length).toBe(25);
  for (const t of done.sample) {
    expect(t).toBeInstanceOf(Float64Array);
    expect(t.length).toBe(done.times.length);
  }
  expect(done.p50).toBeInstanceOf(Float64Array);
  expect(done.p50.length).toBe(done.times.length);
  for (let i = 0; i < done.times.length; i++) expect(done.p50[i]!).toBeLessThanOrEqual(done.p997[i]!);
});
it('subsample is capped by runs when runs < 25', async () => {
  const messages: WorkerResponse[] = [];
  const req = { /* same literal */ runs: 5 } as MCRequest;
  await handleRequest({ type: 'mc', id: 'x', req, batch: 10 }, m => messages.push(m));
  const done = messages.find(m => m.type === 'mc-done')!;
  expect(done.sample.length).toBe(5);
});
```

(Adapt the `req` literal from the file's existing mc test — do not invent new coefficients.)

- [ ] **Step 2: Run** `npx vitest run tests/worker/protocol.test.ts` — FAIL (`sample` missing).
- [ ] **Step 3: Implement.** In `protocol.ts`: `export const SAMPLE_TRAJECTORIES = 25;` and change both mc response variants to `{ type: 'mc-progress'; id: string; runs: number; times: Float64Array; p50: Float64Array; p68: Float64Array; p95: Float64Array; p997: Float64Array; sample: Float64Array[] }` (same for `mc-done`). In `handler.ts`, inside the `msg.type === 'mc'` branch:

```ts
const sample: Float64Array[] = [];
// in the run loop, replace env.add(runOne(...)) with:
const errs = runOne(msg.req, times, r);
env.add(errs);
if (sample.length < SAMPLE_TRAJECTORIES) sample.push(errs);
// and add to the snapshot() object:  sample,  p50: env.percentile(0.5)
```

- [ ] **Step 4: Run** `npm test` — green (the growth view compiles unchanged; it ignores the new field until Task 7).
- [ ] **Step 5: Commit** — `git commit -m "feat(worker): mc responses carry a 25-run trajectory subsample (spec §9.7)"`

---

### Task 4: Dark theme — frozen structure, translunar palette

**Files:**
- Modify: `index.html`, `src/ui/styles.css` (full rewrite), `src/ui/format.ts` (PALETTE), `src/ui/charts.ts` (axis colors, overlay-line colors)
- Test: existing suite (`tests/ui/charts.test.ts` may assert palette values — update any color assertions to the new palette)

- [ ] **Step 1: Fonts.** In `index.html` `<head>`, after the viewport meta:

```html
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Replace `src/ui/styles.css` entirely:**

```css
:root {
  color-scheme: dark;
  --bg: #0d0a14; --panel: #13101c; --panel-2: #1a1528;
  --fg: #e2ddf0; --muted: #8a7fa8; --line: #2a2040; --line-2: #3d3060;
  --brand: #a87dc8; --brand-2: #f4a7c0; --req: #e2564a; --warn: #ffc24a;
  --font-ui: "Space Grotesk", -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Space Mono", Menlo, monospace;
  font-family: var(--font-ui); font-size: 13px;
}
body { margin: 0; color: var(--fg); background: var(--bg); -webkit-font-smoothing: antialiased; }
#app { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; border-top: 3px solid var(--brand); }
h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 10px; color: var(--brand); }
h3 { font-size: 11px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); margin: 18px 0 6px; }
aside { border-right: 1px solid var(--line); padding: 12px; font-size: 13px; background: var(--panel); }
main { padding: 12px 20px; min-width: 0; }
p { line-height: 1.5; color: var(--fg); max-width: 72ch; }

nav.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
nav.tabs button { padding: 7px 12px; border: none; border-bottom: 2px solid transparent; background: none; color: var(--muted); cursor: pointer; font: 600 13px var(--font-ui); }
nav.tabs button:hover { color: var(--fg); }
nav.tabs button.active { color: var(--brand); border-bottom-color: var(--brand); }

fieldset { border: 1px solid var(--line); border-radius: 4px; margin: 0 0 10px; padding: 8px 10px; background: var(--panel); }
legend { font-size: 11px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); padding: 0 4px; }
label { display: block; margin: 4px 0; color: var(--fg); }
input, select, textarea, button { font-family: var(--font-ui); font-size: 13px; }
input[type="number"], input[type="text"], input:not([type]), textarea { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
label input, label select { width: 100%; box-sizing: border-box; background: var(--panel-2); color: var(--fg); border: 1px solid var(--line-2); border-radius: 4px; padding: 3px 6px; }
textarea { width: 100%; box-sizing: border-box; background: var(--panel-2); color: var(--fg); border: 1px solid var(--line-2); border-radius: 4px; }
button { background: var(--panel-2); color: var(--fg); border: 1px solid var(--line-2); border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: var(--brand); }

.row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
dfn { border-bottom: 1px dotted var(--brand); font-style: normal; cursor: help; color: var(--brand-2); }
.gloss { background: var(--panel-2); border-left: 3px solid var(--brand); padding: 6px 8px; margin: 4px 0; font-size: 12px; line-height: 1.5; }
.readout { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin: 10px 0; }
.readout div { border: 1px solid var(--line); border-radius: 4px; padding: 8px; background: var(--panel); }
.readout span { color: var(--muted); font-size: 12px; }
.readout b { display: block; font-size: 17px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.warn { color: var(--warn); }
.chart { width: 100%; }
.inferred { color: var(--muted); }
.placeholder { color: var(--warn); font-weight: bold; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { border: 1px solid var(--line); padding: 3px 8px; text-align: left; font-size: 12px; }
th { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
td { font-family: var(--font-mono); }

details.exp { margin: 6px 0; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); }
details.exp > summary { cursor: pointer; padding: 4px 8px; color: var(--muted); font-size: 12px; list-style: none; }
details.exp > summary::before { content: "▸ "; }
details.exp[open] > summary::before { content: "▾ "; }
details.exp > :not(summary) { padding: 0 8px 6px; }
.seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: 4px; overflow: hidden; margin: 4px 0; }
.seg button { border: none; border-radius: 0; padding: 4px 12px; color: var(--muted); background: var(--panel); }
.seg button.active { background: var(--brand); color: #0d0a14; font-weight: 600; }

.strip-dev { display: block; width: 100%; text-align: left; margin-bottom: 4px; padding: 5px 8px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px; color: var(--fg); }
.strip-dev.active { border-color: var(--brand); color: var(--brand-2); background: #1d1530; }
.strip-dev .sub { display: block; font-size: 10px; color: var(--muted); }

.guide section { max-width: 72ch; margin-bottom: 20px; }
.guide a { color: var(--brand); }

.u-legend { color: var(--fg) !important; font: 11px var(--font-mono) !important; }
.u-title { color: var(--fg) !important; }
.u-select { background: rgba(168, 125, 200, 0.15) !important; }
```

- [ ] **Step 3: `src/ui/format.ts`** — replace `PALETTE` (no red — red is reserved for requirement lines):

```ts
export const PALETTE = ['#c9a0dc', '#ffc24a', '#7bd88f', '#6cc7e8', '#f4a7c0', '#b8b0ff', '#e8a06c', '#98a2b3'];
```

- [ ] **Step 4: `src/ui/charts.ts`** — dark axes and colored overlay lines:
  - The `lines` array entries gain a color: `{ axis: 'x' | 'y'; v: number; label: string; color: string }`.
  - `addHLine(y: number, label: string, color = '#e2564a')` and `addVLine(x: number, label: string, color = '#8a7fa8')` store it. (Requirement lines are the only `addHLine` callers today, so red-by-default implements §9.7.)
  - In the draw hook, replace the fixed `#111` styles with per-line `ctx.strokeStyle = l.color; ctx.fillStyle = l.color;` and set `ctx.font = '11px "Space Mono", monospace';`.
  - In the uPlot options, give both axes dark colors: `{ label: …, values: …, stroke: '#8a7fa8', grid: { stroke: '#2a2040' }, ticks: { stroke: '#2a2040' } }` (keep the y-axis `size: 80`).
- [ ] **Step 5: `src/ui/views/adev.ts`** — the `'analytic total'` series color `'#000'` → `'#e2ddf0'`.
- [ ] **Step 6: Verify** — `npm test` (fix any palette assertions in `tests/ui/charts.test.ts`), `npm run build`, then eyeball the dev server: dark everywhere, purple accents, red requirement line on Error growth, no illegible chart text.
- [ ] **Step 7: Commit** — `git commit -m "feat(ui): dark theme — frozen structure, translunar palette (spec §9.9)"`

---

### Task 5: DOM helpers — expander and segmented control

**Files:**
- Modify: `src/ui/dom.ts`

**Interfaces (Produces):**

```ts
export function expander(key: string, summary: string, ...children: (Node | string | null | undefined)[]): HTMLElement;
export function segmented(options: { value: string; label: string }[], value: string, onChange: (v: string) => void, opts?: { key?: string }): HTMLElement;
```

- [ ] **Step 1: Implement** (append to `dom.ts`):

```ts
/**
 * Collapsible `▸` section. Views re-render by replacing children wholesale, which would
 * collapse a native <details> every time — so open state is remembered per `key` in a
 * module-level map and re-applied on rebuild.
 */
const expanderOpen = new Map<string, boolean>();
export function expander(key: string, summary: string, ...children: (Node | string | null | undefined)[]): HTMLElement {
  return h('details', {
    class: 'exp', 'data-key': key, open: expanderOpen.get(key) ? 'open' : undefined,
    on: { toggle: e => expanderOpen.set(key, (e.target as HTMLDetailsElement).open) },
  }, h('summary', {}, summary), ...children);
}

export function segmented(options: { value: string; label: string }[], value: string, onChange: (v: string) => void, opts: { key?: string } = {}): HTMLElement {
  return h('div', { class: 'seg', 'data-key': opts.key, role: 'group' },
    ...options.map(o => h('button', { class: o.value === value ? 'active' : '', on: { click: () => { if (o.value !== value) onChange(o.value); } } }, o.label)));
}
```

- [ ] **Step 2: Verify** — `npm test` green, `npm run build` clean (vitest is node-env; these DOM factories are covered by typecheck and by the view tasks that use them).
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): expander and segmented-control helpers"`

---

### Task 6: ADEV tab rework

**Files:**
- Modify: `src/ui/views/adev.ts` (full replacement below)

**Interfaces:** Consumes `segmented`, `expander` (T5), `domScenario`/`updateDomain` (T2). `adevSampleCount` export must survive (compare.ts imports it).

- [ ] **Step 1: Replace `src/ui/views/adev.ts` with:**

```ts
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
    controls.replaceChildren(
      segmented([{ value: 'adev', label: 'ADEV' }, { value: 'mdev', label: 'MDEV' }, { value: 'hdev', label: 'HDEV' }],
        s.scenario.devKind, v => store.update(st => ({ ...st, scenario: { ...st.scenario, devKind: v as DevKind } })), { key: 'adev:devkind' }),
      ' ', dfn('MDEV', 'why MDEV?'), ' · ', dfn('HDEV', 'why HDEV?'));
    simRow.replaceChildren(expander('adev:sim', `sim: span ${ds.duration} s · dt ${ds.dt} s · seed ${s.scenario.seed}`,
      h('div', { class: 'row' },
        numInput('span', ds.duration, v => store.update(st => updateDomain(st, d.domain, x => { x.duration = v; })), { unit: 's', min: 1, key: controlKey(['adev', 'span']) }),
        numInput('dt', ds.dt, v => store.update(st => updateDomain(st, d.domain, x => { x.dt = v; })), { unit: 's', min: 1e-4, key: controlKey(['adev', 'dt']) }),
        numInput('seed', s.scenario.seed, v => store.update(st => ({ ...st, scenario: { ...st.scenario, seed: v } })), { key: controlKey(['adev', 'seed']) }))));
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
```

- [ ] **Step 2: Verify** — `npm test`, `npm run build`, dev server: toggle switches deviation kind; expanding "sim" and editing span/dt/seed re-simulates; sidebar's old devKind dropdown (still present until T11) stays in sync.
- [ ] **Step 3: Commit** — `git commit -m "feat(adev): segmented ADEV/MDEV/HDEV toggle, sim expander, plain-language intro (spec §9.4, §9.8)"`

---

### Task 7: Error-growth tab rework — contextual controls + visible Monte Carlo

**Files:**
- Modify: `src/ui/views/growth.ts` (full replacement), `src/ui/charts.ts` (add `setGhosts`)

**Interfaces:** Consumes `sample` (T3), `expander` (T5), per-domain state (T2). Adds to `LogLogChart`:

```ts
setGhosts(x: Float64Array, ys: Float64Array[], color: string): void  // faint canvas polylines, no legend
```

- [ ] **Step 1: `charts.ts` — add ghosts.** New private field `private ghosts: { x: Float64Array; ys: Float64Array[]; color: string } | null = null;`, method:

```ts
/** Faint overlay trajectories (MC spaghetti) drawn in the draw hook — no series, no legend. */
setGhosts(x: Float64Array, ys: Float64Array[], color: string): void {
  this.ghosts = ys.length ? { x, ys, color } : null;
  this.scheduleRepaint();
}
```

In the draw hook, **before** the overlay-lines loop:

```ts
if (self.ghosts) {
  ctx.save(); ctx.strokeStyle = self.ghosts.color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
  for (const t of self.ghosts.ys) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < self.ghosts.x.length; i++) {
      const yv = t[i]!;
      if (!(yv > 0) || !Number.isFinite(yv)) { started = false; continue; }  // log scale: skip ≤0 (|error| dips at zero crossings)
      const px = u.valToPos(self.ghosts.x[i]!, 'x', true), py = u.valToPos(yv, 'y', true);
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    }
    ctx.stroke();
  }
  ctx.restore();
}
```

Also clear ghosts in `destroy()` (`this.ghosts = null;`).

- [ ] **Step 2: Replace `src/ui/views/growth.ts` with:**

```ts
import { h, numInput, select, expander, controlKey } from '../dom';
import { dfn } from '../glossary';
import { LogLogChart, PALETTE, fmtSci, fmtTime } from '../charts';
import { benchToSpec, effectiveTm, updateDomain, type AppState, type Scenario } from '../state';
import { ERROR_UNIT } from '../../engine/units';
import { ESTIMATE_METHODS, type ContributionKey } from '../../engine/models';
import type { TempProfile } from '../../engine/thermal';
import { computeEstimates, growthTimes, mcSummary, valueAt } from './growthCompute';
import type { ViewFactory } from './types';

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
      'Dashed lines are what the budget formulas predict (', dfn('fudge'), ' and ', dfn('constant'), ' by default). ',
      'Faint traces are individual simulated runs. ',
      'The thick solid line is their ', dfn('percentile', 'percentile envelope'), '. ',
      'The red line is your ', dfn('requirement'), '.'),
    controls, mainEl, simRow, readout, status, h('h3', {}, 'Contributions (first estimate method)'), stackEl);
  const main = new LogLogChart(mainEl, { xLabel: 't since last fix (s)', yLabel: 'error' });
  const stack = new LogLogChart(stackEl, { xLabel: 't since last fix (s)', yLabel: 'σ contribution' });
  let pending: string | null = null, lastKey = '';
  let lastMc: Mc | null = null;

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
    const fixUnit = d.domain === 'gyro' ? 'rad, 1σ' : d.domain === 'accel' ? 'm, 1σ' : 's, 1σ';
    controls.replaceChildren(
      h('div', { class: 'row' },
        numInput('fix accuracy', ds.fix.sigma, v => setD(x => { x.fix.sigma = v; }), { unit: fixUnit, min: 0, term: 'fix', key: controlKey(['growth', 'fixsigma']) }),
        numInput('fix cadence', ds.fix.cadence, v => setD(x => { x.fix.cadence = v; }), { unit: 's', min: 1e-6, key: controlKey(['growth', 'fixcadence']) })),
      d.domain === 'clock' && d.states === 3
        ? numInput('drift-rate uncertainty', sc.driftKnowledge ? Math.sqrt(sc.driftKnowledge) * 86400 : 0, v => set(x => { x.driftKnowledge = v > 0 ? (v / 86400) ** 2 : null; }), { unit: 'Δf/f per day, 1σ', term: 'driftKnowledge', min: 0, key: controlKey(['growth', 'driftknowledge']) })
        : null,
      h('div', { class: 'row' },
        select('Temperature profile', [{ value: 'none', label: 'none' }, { value: 'step', label: 'step' }, { value: 'ramp', label: 'ramp' }, { value: 'sinusoid', label: 'sinusoid (orbital)' }], profile.kind, setKind, { key: controlKey(['growth', 'tempprofile']) }),
        h('label', {}, h('input', { type: 'checkbox', checked: sc.includeThermal ? 'checked' : undefined, 'data-key': controlKey(['growth', 'includethermal']), on: { change: e => set(x => { x.includeThermal = (e.target as HTMLInputElement).checked; }) } }), ' ', dfn('thermal', 'include thermal in truth'))),
      ...profileFields(),
      expander('growth:methods', `more methods (active: ${sc.estimateMethods.join(' + ')})`,
        h('div', {}, ...ESTIMATE_METHODS.map(m => h('label', { style: 'display:inline-block;margin-right:10px' },
          h('input', { type: 'checkbox', checked: sc.estimateMethods.includes(m) ? 'checked' : undefined, 'data-key': controlKey(['growth', 'method', m]), on: { change: e => set(x => { const on = (e.target as HTMLInputElement).checked; x.estimateMethods = on ? [...new Set([...x.estimateMethods, m])] : x.estimateMethods.filter(k => k !== m); }) } }), ' ', dfn(m)))),
        h('label', {}, dfn('Tm', 'model timescale T_m'), h('input', { value: sc.Tm === 'auto' ? 'auto' : String(sc.Tm), 'data-key': controlKey(['growth', 'tm']), on: { change: e => { const v = (e.target as HTMLInputElement).value.trim(); set(x => { x.Tm = v === 'auto' ? 'auto' : Math.max(1e-3, Number(v) || 1); }); } } }))),
    );
    simRow.replaceChildren(expander('growth:sim', `sim: ${sc.runs} runs · span ${ds.duration} s · dt ${ds.dt} s · seed ${sc.seed}`,
      h('div', { class: 'row' },
        numInput('runs', sc.runs, v => set(x => { x.runs = Math.max(1, Math.round(v)); }), { min: 1, key: controlKey(['growth', 'runs']) }),
        numInput('span', ds.duration, v => setD(x => { x.duration = v; }), { unit: 's', min: 1, key: controlKey(['growth', 'span']) }),
        numInput('dt', ds.dt, v => setD(x => { x.dt = v; }), { unit: 's', min: 1e-4, key: controlKey(['growth', 'dt']) }),
        numInput('seed', sc.seed, v => set(x => { x.seed = v; }), { key: controlKey(['growth', 'seed']) }))));

    const spec = benchToSpec(d);
    const eu = ERROR_UNIT[d.domain];
    const req = ds.requirements.find(r => r.id === ds.activeRequirement) ?? null;
    const inputs = { spec, scenario: sc, dom: d.domain, req };
    const times = growthTimes(inputs);
    const est = computeEstimates(inputs, times);
    const conv = (a: Float64Array) => Float64Array.from(a, eu.fromSI);
    const k = req?.sigma ?? 1;

    const renderAll = (mc: Mc | null) => {
      // Plot MC-derived curves against the worker's own grid (I5 guard).
      const mcS = mc ? mcSummary(mc.times, mc, req) : null;
      // The band body runs from the median of |error| to the Nσ percentile envelope (§9.7).
      const medianCurve = mc ? mc.p50 : null;
      main.setSeries([
        ...est.map((c, i) => ({ label: `${c.method} (${k}σ, formula)`, color: PALETTE[(i + 1) % 8]!, dash: [6, 3] })),
        { label: 'median of runs', color: PALETTE[0]!, width: 1, band: true },
        { label: mc ? `${PCT_LABEL[(req?.sigma ?? 1) as 1 | 2 | 3]} %ile of ${mc.runs} runs` : 'percentile envelope', color: PALETTE[0]!, width: 3, band: true },
      ]);
      main.setBands([[est.length + 1, est.length + 2]]);
      main.setData(mc ? mc.times : times, [...est.map(c => conv(c.scaled)), medianCurve ? conv(medianCurve) : null, mcS ? conv(mcS.curve) : null]);
      main.setGhosts(mc ? mc.times : times, mc ? mc.sample.map(conv) : [], GHOST_COLOR);
      main.clearLines();
      if (req) { main.addHLine(eu.fromSI(req.value), `requirement ${fmtSci(eu.fromSI(req.value))} ${eu.label} (${k}σ)`); main.addVLine(req.duration, fmtTime(req.duration)); }
      const first = est[0];
      const thermalAtReq = first && req ? valueAt(times, first.contributions.thermal, req.duration) : null;
      readout.replaceChildren(
        ...est.map(c => h('div', {}, h('span', {}, dfn(c.method), ` at ${req ? fmtTime(req.duration) : '—'}`), h('b', {}, c.atReq === null ? '—' : `${fmtSci(eu.fromSI(c.atReq))} ${eu.label}`), `time to requirement: ${c.timeToReq === null ? 'never within span' : fmtTime(c.timeToReq)}`)),
        h('div', {}, h('span', {}, 'simulated truth (percentile)'), h('b', {}, mcS?.atReq == null ? '…' : `${fmtSci(eu.fromSI(mcS.atReq))} ${eu.label}`), `time to requirement: ${mcS?.timeToReq == null ? (mc ? 'never within span' : '…') : fmtTime(mcS.timeToReq)}`),
        ...(mcS?.atReq != null ? est.map(c => h('div', { class: c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'warn' : '' }, h('span', {}, `truth / ${c.method}`), h('b', {}, c.atReq ? (mcS.atReq! / c.atReq).toFixed(2) + '×' : '—'), c.atReq && mcS.atReq! / c.atReq > 1.2 ? 'the formula is optimistic at this duration' : 'the formula is adequate or conservative here')) : []),
        h('div', {}, h('span', {}, 'T_m in use'), h('b', {}, fmtTime(effectiveTm(sc, d.domain)))),
        h('div', {}, h('span', {}, dfn('thermal', 'thermal (truth only)')), h('b', {}, thermalAtReq == null ? '—' : `${fmtSci(eu.fromSI(thermalAtReq))} ${eu.label}`), 'the formulas never see this; only the simulated truth carries it'),
      );
      if (first) {
        const keys = CONTRIB.filter(key => first.contributions[key].some(v => v > 0));
        stack.setSeries(keys.map((key, i) => ({ label: key === 'B' ? `B (${first.method})` : key, color: PALETTE[i % 8]! })));
        stack.setData(times, keys.map(key => conv(first.contributions[key])));
      }
    };

    const key = JSON.stringify([spec, ds.dt, ds.duration, sc.runs, sc.seed, ds.fix, sc.driftKnowledge, sc.temperature, sc.includeThermal, effectiveTm(sc, d.domain), req?.duration]); // estimateMethods deliberately excluded: toggling a method must not re-run the MC (renderAll(lastMc) recomputes the formula lines)
    if (key !== lastKey) {
      lastKey = key;
      if (pending) { client.cancel(pending); pending = null; }
      lastMc = null;
      renderAll(null);
      const mcDuration = Math.max(ds.duration, req?.duration ?? 0);
      const samples = Math.round(mcDuration / ds.dt);
      if (samples > 2_000_000) {
        status.textContent = 'simulation skipped: span/dt exceeds 2,000,000 samples — open "sim" and increase dt or shorten the span';
      } else {
        status.textContent = 'simulating runs…';
        pending = client.request({ type: 'mc', id: client.nextId(), batch: 10, req: { spec, dt: ds.dt, duration: mcDuration, runs: sc.runs, seed: sc.seed, profile: sc.temperature, includeThermal: sc.includeThermal, fix: ds.fix, driftKnowledge: sc.driftKnowledge, Tm: effectiveTm(sc, d.domain) } }, m => {
          if (m.type === 'mc-progress' || m.type === 'mc-done') { lastMc = m; renderAll(m); status.textContent = m.type === 'mc-done' ? `done: ${m.runs} runs` : `${m.runs} / ${sc.runs} runs`; }
          if (m.type === 'mc-done' || m.type === 'error') { pending = null; if (m.type === 'error') status.textContent = m.message; }
        });
      }
    } else renderAll(lastMc);
  };
  update(store.get());
  return { update, destroy: () => { if (pending) client.cancel(pending); main.destroy(); stack.destroy(); } };
};
```

- [ ] **Step 3: Verify** — `npm test`, `npm run build`. Dev server, Error growth: faint spaghetti behind a shaded band, thick envelope labeled `99.7th %ile of 200 runs`, dashed formula lines, red requirement. Sidebar's duplicated scenario controls (until T11) stay in sync with the new on-tab controls.
- [ ] **Step 4: Commit** — `git commit -m "feat(growth): contextual controls, MC spaghetti + band + honest envelope label (spec §9.4, §9.7)"`

---

### Task 8: Sizing tab rework

**Files:**
- Modify: `src/ui/views/sizing.ts` (full replacement), `src/ui/views/sizingCompute.ts` (parameterized grid)
- Test: `tests/ui/sizingCompute.test.ts`

- [ ] **Step 1: Failing test** — in `tests/ui/sizingCompute.test.ts` add:

```ts
it('cadenceGrid accepts a custom range', () => {
  const g = cadenceGrid(1, 100);
  expect(g[0]!).toBeCloseTo(1);
  expect(g[g.length - 1]!).toBeCloseTo(100);
});
```

- [ ] **Step 2: `sizingCompute.ts`** — replace the fixed grid with:

```ts
export function cadenceGrid(lo = 0.01, hi = 1e4): Float64Array {
  const out: number[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) out.push(lo * Math.pow(hi / lo, i / n));
  return Float64Array.from(out);
}
```

`computeKnee` gains `grid: Float64Array` as its last parameter and uses it instead of the module constant (delete `CADENCE_GRID`/`buildCadenceGrid`). Update existing test call sites: `computeKnee(devices, scenario, dom, req, cadenceGrid())`.

- [ ] **Step 3: Replace `src/ui/views/sizing.ts` with:**

```ts
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
```

(`computeKnee`'s slowest-cadence scan iterates the passed `grid`.)

- [ ] **Step 4: Verify** — `npm test`, `npm run build`, dev server: sweep-range inputs redraw; fix accuracy edits move all curves.
- [ ] **Step 5: Commit** — `git commit -m "feat(sizing): on-tab fix accuracy + sweep range, §9.8 intro"`

---

### Task 9: DMTD tab rework

**Files:**
- Modify: `src/ui/views/compare.ts`

- [ ] **Step 1: Edit `compare.ts`:**
  - Replace the intro `<p>` with:

```ts
h('p', {},
  'To compare two good clocks you need a measurement quieter than both. ',
  'A ', dfn('DMTD'), ' mixes each clock against a shared offset oscillator. ',
  'The offset oscillator is common to both channels, so its noise cancels in the difference — unless some fraction ', dfn('leak', 'leaks'), ' through. ',
  'The ', dfn('floor'), ' is the electronics noise below which nothing can be measured. ',
  'The ', dfn('crossover'), ' marks where the device under test becomes noisier than the reference.'),
```

  - Add a `▸ sim` expander after the controls row (import `expander`, `controlKey` from `../dom`, `updateDomain` from `../state`), bound to the **clock** domain:

```ts
const simRow = h('div', {});
// in root.replaceChildren: …, controls, simRow, chartEl, readout
// in update(), after controls.replaceChildren(…):
simRow.replaceChildren(expander('dmtd:sim', `sim: span ${cs.duration} s · dt ${cs.dt} s · seed ${s.scenario.seed}`,
  h('div', { class: 'row' },
    numInput('span', cs.duration, v => store.update(st => updateDomain(st, 'clock', x => { x.duration = v; })), { unit: 's', min: 1, key: controlKey(['dmtd', 'span']) }),
    numInput('dt', cs.dt, v => store.update(st => updateDomain(st, 'clock', x => { x.dt = v; })), { unit: 's', min: 1e-3, key: controlKey(['dmtd', 'dt']) }),
    numInput('seed', s.scenario.seed, v => store.update(st => ({ ...st, scenario: { ...st.scenario, seed: v } })), { key: controlKey(['dmtd', 'seed']) }))));
```

  - In `renderReadout`, relabel the holdover line's `span` text to `'DUT holdover to requirement (constant-B formula…'` — same content, the word "estimate" → "formula" for grammar consistency.
- [ ] **Step 2: Verify** — `npm test`, `npm run build`, dev server: DMTD renders, sim expander edits clock dt/span and re-simulates.
- [ ] **Step 3: Commit** — `git commit -m "feat(dmtd): sim expander on the clock domain, plain-language intro"`

---

### Task 10: Devices tab

**Files:**
- Create: `src/ui/views/devices.ts`
- Modify: `src/ui/state.ts` (View union), `src/ui/store.ts` (VALID_VIEWS), `src/ui/app.ts` (registry)
- Test: rename `tests/ui/sidebar.test.ts` → `tests/ui/devices.test.ts` in Task 11 (not here — export move happens in T11)

The editor code moves **by copy** from `sidebar.ts` now; Task 11 deletes the sidebar originals. Transient duplication (both places show an editor between T10 and T11) is deliberate — every commit stays fully functional.

- [ ] **Step 1: `src/ui/state.ts`** — `export type View = 'devices' | 'adev' | 'growth' | 'sizing' | 'compare';` and in `src/ui/store.ts` add `'devices'` to `VALID_VIEWS`.
- [ ] **Step 2: Create `src/ui/views/devices.ts`:**

```ts
import { h, numInput, select, controlKey, expander } from '../dom';
import { dfn } from '../glossary';
import type { Store } from '../store';
import { fromPreset, isBenchDevice, uniqueId, type AppState, type BenchDevice } from '../state';
import { PRESETS } from '../../presets';
import { DATASHEET_UNITS } from '../../engine/units';
import type { Coefs } from '../../engine/deviations';
import type { ViewFactory } from './types';

export const exportDevice = (d: BenchDevice): string => JSON.stringify(d, null, 2);
export function importDevice(json: string): BenchDevice | null {
  try { const v = JSON.parse(json); return isBenchDevice(v) ? v : null; } catch { return null; }
}

const COEF_KEYS: (keyof Coefs)[] = ['Q', 'F', 'N', 'B', 'K', 'D', 'R'];

function deviceEditor(d: BenchDevice, store: Store): HTMLElement {
  const patch = (fn: (x: BenchDevice) => void) => store.update(s => ({ ...s, bench: s.bench.map(x => { if (x.id !== d.id) return x; const c = structuredClone(x); fn(c); return c; }) }));
  const units = DATASHEET_UNITS[d.domain];
  const fields = COEF_KEYS.map(k => numInput(k, d.coefs[k], v => patch(x => { x.coefs[k] = v; x.inferred = x.inferred.filter(i => i !== k); }), { min: 0, term: k, unit: units[k] + (d.inferred.includes(k) ? ' · inferred' : ''), key: controlKey(['dev', d.id, k]) }));
  return h('fieldset', {},
    h('legend', {}, d.name, d.placeholder ? h('span', { class: 'placeholder' }, ' PLACEHOLDER') : null),
    h('label', {}, 'Name', h('input', { value: d.name, 'data-key': controlKey(['dev', d.id, 'name']), on: { change: e => patch(x => { x.name = (e.target as HTMLInputElement).value; }) } })),
    h('div', { class: 'inferred' }, `${d.domain}, ${d.states}-state · ${d.source}`),
    h('div', { class: 'row' }, ...fields),
    expander(`dev:${d.id}:thermal`, d.thermal ? 'thermal (on)' : 'thermal (off)',
      h('label', {}, h('input', { type: 'checkbox', checked: d.thermal ? 'checked' : undefined, 'data-key': controlKey(['dev', d.id, 'thermalToggle']), on: { change: e => patch(x => { x.thermal = (e.target as HTMLInputElement).checked ? { tempco: 0, tauTh: 0 } : null; }) } }), ' ', dfn('thermal', 'temperature sensitivity')),
      d.thermal ? h('div', { class: 'row' },
        numInput('tempco', d.thermal.tempco, v => patch(x => { if (x.thermal) x.thermal.tempco = v; }), { unit: units.tempco, key: controlKey(['dev', d.id, 'tempco']) }),
        numInput('thermal lag', d.thermal.tauTh, v => patch(x => { if (x.thermal) x.thermal.tauTh = v; }), { unit: 's', min: 0, key: controlKey(['dev', d.id, 'tauth']) })) : null),
    expander(`dev:${d.id}:model`, 'model options',
      d.domain !== 'accel' ? select('States', [{ value: '2', label: '2 (error, bias)' }, { value: '3', label: '3 (+ drift)' }], String(d.states), v => patch(x => { x.states = v === '3' ? 3 : 2; }), { key: controlKey(['dev', d.id, 'states']) }) : null,
      select('Flicker truth model', [{ value: 'exact', label: 'exact 1/f (Kasdin)' }, { value: 'gmSum', label: 'Gauss-Markov sum (approximation)' }], d.flickerMode, v => patch(x => { x.flickerMode = v === 'gmSum' ? 'gmSum' : 'exact'; }), { key: controlKey(['dev', d.id, 'flickerMode']) }),
      d.flickerMode === 'gmSum' ? h('label', {}, dfn('gmSum', 'GM correlation times (s, comma-separated)'), h('input', { value: d.gmTaus.join(','), 'data-key': controlKey(['dev', d.id, 'gmTaus']), on: { change: e => patch(x => { x.gmTaus = (e.target as HTMLInputElement).value.split(',').map(Number).filter(v => v > 0); }) } })) : null),
    h('div', { class: 'row' },
      h('button', { on: { click: () => navigator.clipboard.writeText(exportDevice(d)).catch(() => {}) } }, 'Copy JSON'),
      h('button', { on: { click: () => store.update(s => ({ ...s, bench: s.bench.filter(x => x.id !== d.id), selected: s.selected === d.id ? (s.bench.find(x => x.id !== d.id)?.id ?? null) : s.selected })) } }, 'Remove')),
  );
}

export const devicesView: ViewFactory = (root, store) => {
  const update = (s: AppState) => {
    const addFrom = (id: string) => { const p = PRESETS.find(x => x.id === id); if (!p) return; const newId = uniqueId(p.id, s.bench.map(b => b.id)); store.update(st => ({ ...st, bench: [...st.bench, fromPreset(p, newId)], selected: newId })); };
    const importBox = h('textarea', { rows: 3, placeholder: 'Paste device JSON to import', 'data-key': 'devices:import' }) as HTMLTextAreaElement;
    const importMsg = h('span', { class: 'warn', 'data-key': 'devices:import-msg' });
    const activeKey = document.activeElement?.getAttribute('data-key') ?? null;
    const prevImport = root.querySelector<HTMLTextAreaElement>('[data-key="devices:import"]');
    const importValue = prevImport?.value ?? '';
    root.replaceChildren(
      h('p', {},
        'Every device on the bench is defined by seven noise coefficients, straight from its datasheet. ',
        'Add a preset, then edit any number — each preset cites its source. ',
        'Placeholder presets carry made-up values; replace them with real datasheet numbers.'),
      h('div', { class: 'row' },
        select('Add preset', [{ value: '', label: '—' }, ...PRESETS.map(p => ({ value: p.id, label: `${p.domain}: ${p.name}` }))], '', addFrom, { key: 'devices:addpreset' }),
        h('div', {}, importBox, h('button', {
          on: {
            click: () => {
              const d = importDevice(importBox.value);
              if (!d) { importMsg.textContent = 'invalid device JSON'; return; }
              importMsg.textContent = '';
              store.update(st => { const id = uniqueId(d.id, st.bench.map(b => b.id)); return { ...st, bench: [...st.bench, { ...d, id }], selected: id }; });
            },
          },
        }, 'Import'), importMsg)),
      ...s.bench.map(d => deviceEditor(d, store)),
    );
    const newImport = root.querySelector<HTMLTextAreaElement>('[data-key="devices:import"]');
    if (newImport) newImport.value = importValue;
    if (activeKey) root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus();
  };
  update(store.get());
  return { update, destroy: () => root.replaceChildren() };
};
```

- [ ] **Step 3: `src/ui/app.ts`** — rebuild `VIEWS` in spec §9.1 tab order (object key order is tab order): `devices, adev, growth, sizing, compare` — i.e. `devices: { label: 'Devices', make: devicesView }` first, Sizing **before** DMTD. Rename the compare label: `compare: { label: 'DMTD', make: compareView }`.
- [ ] **Step 4: Verify** — `npm test`, `npm run build`; dev server: Devices tab edits coefficients, thermal/model expanders hold state across re-renders, import/export round-trips.
- [ ] **Step 5: Commit** — `git commit -m "feat(devices): Devices tab — the one place devices are edited (spec §9.3)"`

---

### Task 11: Context strip

**Files:**
- Modify: `src/ui/sidebar.ts` (full replacement below)
- Move test: `git mv tests/ui/sidebar.test.ts tests/ui/devices.test.ts` and point its `exportDevice`/`importDevice` import at `../../src/ui/views/devices`

- [ ] **Step 1: Replace `src/ui/sidebar.ts` with:**

```ts
import { h, numInput, select, controlKey, expander } from './dom';
import { dfn } from './glossary';
import type { Store } from './store';
import { activeDomain, updateDomain, uniqueId, type AppState, type DomainScenario, type Requirement } from './state';
import { ERROR_UNIT, type Domain } from '../engine/units';

export const reqValueToSI = (domain: Domain, v: number) => ERROR_UNIT[domain].toSI(v);
export const reqValueFromSI = (domain: Domain, v: number) => ERROR_UNIT[domain].fromSI(v);

/** The always-visible context strip: which device, which requirement. Nothing else (spec §9.2). */
export function mountSidebar(root: HTMLElement, store: Store): void {
  const render = (s: AppState) => {
    const activeKey = document.activeElement?.getAttribute('data-key') ?? null;
    const dom = activeDomain(s);
    const ds = s.scenario.byDomain[dom];
    const setD = (fn: (d: DomainScenario) => void) => store.update(st => updateDomain(st, dom, fn));
    const eu = ERROR_UNIT[dom];
    const active = ds.requirements.find(r => r.id === ds.activeRequirement) ?? null;

    const reqRow = (r: Requirement) => h('div', { class: 'row' },
      h('label', {}, h('input', { type: 'radio', name: 'activeReq', checked: ds.activeRequirement === r.id ? 'checked' : undefined, 'data-key': controlKey(['req', r.id, 'active']), on: { change: () => setD(x => { x.activeRequirement = r.id; }) } }), ' active'),
      numInput('value', reqValueFromSI(dom, r.value), v => setD(x => { const q = x.requirements.find(y => y.id === r.id); if (q) q.value = reqValueToSI(dom, v); }), { unit: eu.label, min: 0, key: controlKey(['req', r.id, 'value']) }),
      select('sigma', [{ value: '1', label: '1σ' }, { value: '2', label: '2σ' }, { value: '3', label: '3σ' }], String(r.sigma), v => setD(x => { const q = x.requirements.find(y => y.id === r.id); if (q) q.sigma = Number(v) as 1 | 2 | 3; }), { key: controlKey(['req', r.id, 'sigma']) }),
      numInput('duration', r.duration, v => setD(x => { const q = x.requirements.find(y => y.id === r.id); if (q) q.duration = v; }), { unit: 's', min: 1, key: controlKey(['req', r.id, 'duration']) }),
      h('button', { 'data-key': controlKey(['req', r.id, 'remove']), on: { click: () => setD(x => { x.requirements = x.requirements.filter(y => y.id !== r.id); if (x.activeRequirement === r.id) x.activeRequirement = x.requirements[0]?.id ?? null; }) } }, 'remove'));

    root.replaceChildren(
      h('h3', {}, 'Device'),
      ...s.bench.map(d => h('button', {
        class: 'strip-dev' + (d.id === s.selected ? ' active' : ''),
        'data-key': controlKey(['strip', d.id]),
        on: { click: () => store.set({ selected: d.id }) },
      }, d.name, h('span', { class: 'sub' }, d.domain))),
      s.bench.length === 0 ? h('p', { class: 'inferred' }, 'Bench is empty — add a device on the Devices tab.') : null,
      h('h3', {}, dfn('requirement', 'Requirement')),
      active
        ? h('div', {},
            numInput('value', reqValueFromSI(dom, active.value), v => setD(x => { const q = x.requirements.find(y => y.id === x.activeRequirement); if (q) q.value = reqValueToSI(dom, v); }), { unit: eu.label, min: 0, key: 'strip:req-value' }),
            h('div', { class: 'row' },
              select('sigma', [{ value: '1', label: '1σ' }, { value: '2', label: '2σ' }, { value: '3', label: '3σ' }], String(active.sigma), v => setD(x => { const q = x.requirements.find(y => y.id === x.activeRequirement); if (q) q.sigma = Number(v) as 1 | 2 | 3; }), { key: 'strip:req-sigma' }),
              numInput('duration', active.duration, v => setD(x => { const q = x.requirements.find(y => y.id === x.activeRequirement); if (q) q.duration = v; }), { unit: 's', min: 1, key: 'strip:req-duration' })))
        : h('p', { class: 'inferred' }, 'No requirement set for this domain.'),
      expander('strip:allreqs', `all ${dom} requirements (${ds.requirements.length})`,
        ...ds.requirements.map(reqRow),
        h('button', { 'data-key': 'req:add', on: { click: () => setD(x => { const id = uniqueId('r' + (x.requirements.length + 1), x.requirements.map(y => y.id)); x.requirements.push({ id, value: reqValueToSI(dom, 1), sigma: 3, duration: 600 }); x.activeRequirement ??= id; }) } }, 'Add requirement')),
    );
    if (activeKey) root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus();
  };
  render(store.get());
  store.subscribe(render);
}
```

- [ ] **Step 2: Move the test** — `git mv tests/ui/sidebar.test.ts tests/ui/devices.test.ts`; change its first import to `import { exportDevice, importDevice } from '../../src/ui/views/devices';` (the `controlKey`/`uniqueId` blocks are unchanged).
- [ ] **Step 3: Verify** — `npm test`, `npm run build`; dev server: strip shows devices + requirement only; selecting CSAC switches the requirement panel to clock units (ns); every chart tab still has all its controls; nothing on any tab is now unreachable (fix quality → Growth/Sizing, temp → Growth, methods/Tm → Growth expander, dt/span/seed/runs → sim expanders, devKind → ADEV toggle, editor → Devices).
- [ ] **Step 4: Commit** — `git commit -m "feat(strip): sidebar reduced to device + requirement context strip (spec §9.2)"`

---

### Task 12: Guide tab

**Files:**
- Create: `src/ui/views/guide.ts`
- Modify: `src/ui/state.ts` (View union → add `'guide'`), `src/ui/store.ts` (VALID_VIEWS), `src/ui/app.ts` (registry — `guide` first in tab order)

- [ ] **Step 1: Create `src/ui/views/guide.ts`:**

```ts
import { h } from '../dom';
import { dfn } from '../glossary';
import { toHash } from '../store';
import { defaultState, fromPreset, updateDomain, type AppState } from '../state';
import { PRESETS } from '../../presets';
import type { ViewFactory } from './types';

const P = (id: string) => fromPreset(PRESETS.find(p => p.id === id)!);

/** Each example is a plain URL hash — loading one is just navigation (spec §9.6). */
function ex(build: () => AppState): string { return '#' + toHash(build()); }

const EXAMPLES = {
  slopes: ex(() => { const s = defaultState(); const g = P('stim300-gyro'); g.coefs.K = 0.05; s.bench = [g]; s.selected = g.id; return { ...updateDomain(s, 'gyro', ds => { ds.duration = 36000; ds.dt = 0.1; }), view: 'adev' as const }; }),
  fudge: ex(() => { const s = defaultState(); s.bench = [P('lsm6dsl-gyro')]; s.selected = 'lsm6dsl-gyro'; s.scenario.Tm = 3600; s.scenario.estimateMethods = ['fudge', 'constant', 'gm']; return { ...s, view: 'growth' as const }; }),
  clocks: ex(() => { const s = defaultState(); s.bench = [P('cesium-5071a'), P('prs10-rb')]; s.selected = 'cesium-5071a'; s.scenario.runs = 100; return { ...s, view: 'growth' as const }; }),
  dmtd: ex(() => { const s = defaultState(); s.bench = [P('rafs'), P('cesium-5071a'), P('tcxo'), P('ocxo')]; s.selected = 'rafs'; s.scenario.compare = { dut: 'rafs', ref: 'cesium-5071a', osc: 'tcxo', leak: 0, floorQ: 1e-12 }; return { ...s, view: 'compare' as const }; }),
  thermal: ex(() => { const s = defaultState(); const o = P('ocxo'); o.thermal = { tempco: 0.02, tauTh: 600 }; s.bench = [o]; s.selected = 'ocxo'; s.scenario.temperature = { kind: 'sinusoid', amplitude: 5, period: 5400 }; return { ...updateDomain(s, 'clock', ds => { ds.duration = 6 * 3600; ds.requirements = [{ id: 'c1', value: 1e-6, sigma: 3, duration: 3 * 3600 }]; ds.activeRequirement = 'c1'; }), view: 'growth' as const }; }),
};

const link = (hash: string) => h('p', {}, h('a', { href: hash }, 'load this example →'));

export const guideView: ViewFactory = (root) => {
  root.replaceChildren(h('div', { class: 'guide' },
    h('section', {},
      h('h3', {}, 'What this tool is'),
      h('p', {},
        'You are picking a gyro, an accelerometer, or a clock for a mission. ',
        'The datasheet gives you noise coefficients. The mission gives you a ', dfn('requirement'), '. ',
        'This tool connects the two: it simulates the device, grows the error the way physics does, and tells you whether the requirement holds — and whether the usual budget formulas would have told you the truth.'),
      h('p', {},
        'Dashed curves are formulas. Solid curves are simulations. The red line is your requirement. ',
        'Every underlined term explains itself when you click it.')),
    h('section', {},
      h('h3', {}, 'Reading slopes off an ADEV plot'),
      h('p', {},
        'Each noise type draws a straight line with its own slope on a log-log ', dfn('ADEV'), ' plot. ',
        'White noise falls as 1/√τ. The bias-instability floor is flat. Random walk rises as √τ. ',
        'A real device shows all of them; the measured curve rides along whichever is largest. ',
        'That is how you read coefficients off a plot — find the straight sections, read their heights.'),
      link(EXAMPLES.slopes)),
    h('section', {},
      h('h3', {}, 'When the one-hour fudge lets you down'),
      h('p', {},
        'A common budget trick feeds bias instability into the formulas as if it were random walk, sized at one hour (the ', dfn('fudge'), '). ',
        'For a ten-minute outage that formula is roughly 4× optimistic. ',
        'The ', dfn('constant'), ' model — treat the bias as an unknown constant — has the right shape and is the honest single number for an outage budget. ',
        'Load the example and compare both dashed lines against the simulated truth.'),
      link(EXAMPLES.fudge)),
    h('section', {},
      h('h3', {}, 'Cesium versus rubidium'),
      h('p', {},
        'A cesium beam is white-frequency noise all the way out to days, so the 2-state formula is nearly exact for it. ',
        'A rubidium is quieter at one second but flickers and ages, so its formulas drift away from the truth over a day. ',
        'This is the cleanest illustration of when the analytic model can be trusted.'),
      link(EXAMPLES.clocks)),
    h('section', {},
      h('h3', {}, 'DMTD: the offset oscillator does not matter — until it does'),
      h('p', {},
        'A ', dfn('DMTD'), ' compares two clocks through a shared offset oscillator. ',
        'Because it is shared, its noise cancels — a cheap TCXO can referee two atomic clocks. ',
        'Set the ', dfn('leak'), ' to 0.01 and watch the TCXO reappear at long τ.'),
      link(EXAMPLES.dmtd)),
    h('section', {},
      h('h3', {}, 'Thermal: what the ADEV never told you'),
      h('p', {},
        'An ADEV is measured on a bench at constant temperature. ',
        'Your mission is not at constant temperature. ',
        'A tempco times an orbital temperature swing produces error the formulas never see; only the simulated truth carries it. ',
        'Load the example and compare the thermal readout against the formula lines.'),
      link(EXAMPLES.thermal)),
  ));
  return { update: () => {}, destroy: () => root.replaceChildren() };
};
```

- [ ] **Step 2: Register** — `View` union becomes `'guide' | 'devices' | 'adev' | 'growth' | 'sizing' | 'compare'`; add `'guide'` to `VALID_VIEWS`; app registry starts `guide: { label: 'Guide', make: guideView }`, giving the final §9.1 tab order `Guide · Devices · ADEV · Error growth · Sizing · DMTD`. Default view for a fresh load stays `'adev'`.
- [ ] **Step 3: Verify** — `npm test`, `npm run build`; dev server: each "load this example" link navigates (hashchange handler picks it up) and lands on the right tab with the right bench.
- [ ] **Step 4: Commit** — `git commit -m "feat(guide): Guide tab with hash-link examples replaces lesson machinery (spec §9.6)"`

---

### Task 13: Glossary rewrite

**Files:**
- Modify: `src/ui/glossary.ts` — replace every entry's text. **Keys are unchanged** (`tests/ui/glossary.test.ts` and every `dfn()` call depend on them).

- [ ] **Step 1: Replace the `GLOSSARY` object body with** (each entry: what it is, why you care, formula last — spec §9.8):

```ts
export const GLOSSARY: Record<string, { short: string; long: string }> = {
  asymptote: { short: 'What one noise term alone would draw on the plot', long: 'Each dashed line is one noise coefficient by itself — the ADEV that term alone would produce. The dotted line is all of them combined. Where the solid measured curve hugs a dashed line, that noise dominates at that averaging time. The corners between dashed lines are where one noise hands over to the next. That is how you read coefficients off a measured plot. Formulas: √3·Q/τ, N/√τ, 0.664·B (flat), K·√(τ/3), R·τ/√2.' },
  ADEV: { short: 'Allan deviation: how noisy the device is at each averaging time', long: 'Take the rate signal. Average it in windows of length τ. The Allan deviation is the typical difference between one window and the next. Short τ shows fast noise; long τ shows slow wander. On a log-log plot every noise type is a straight line with its own slope, so one curve summarizes the whole noise character of a device. It describes the rate, not the accumulated error — the Error growth tab does that.' },
  MDEV: { short: 'A variant that tells white phase noise from flicker phase noise', long: 'On an ordinary ADEV plot, white phase noise and flicker phase noise look the same: both fall as 1/τ. The modified Allan deviation averages phase inside each window first, and that splits them: white phase falls as τ^-3/2, flicker phase as 1/τ. Use it when the short-τ end of your plot slopes at -1 and you need to know which of the two you have — measurement-chain noise or the device itself.' },
  HDEV: { short: 'A variant that is blind to steady drift', long: 'A drifting clock (rubidium, anything that ages) buries its long-τ noise under the drift on an ADEV plot. The Hadamard deviation uses second differences of frequency, which cancels a steady drift exactly, so you can read the random noise underneath. GPS operations budget in Hadamard for exactly this reason.' },
  Q: { short: 'White noise added directly to the output (quantization)', long: 'Q is white noise sitting directly on the integrated output — angle for a gyro, time for a clock. It comes from quantization and readout. It does not accumulate: its contribution to the error budget is bounded at Q, no matter how long you wait. On the ADEV plot it is the steep 1/τ line at short τ (height √3·Q/τ).' },
  F: { short: 'Flicker (1/f) phase noise', long: 'F is 1/f noise on the phase. On an ADEV plot it looks identical to Q — both fall as roughly 1/τ — which is the whole reason MDEV exists. It is rarely a datasheet number; it is here so you can see the MDEV separation work.' },
  N: { short: 'White rate noise — angle random walk for gyros', long: 'N is white noise on the rate itself. It is the most-quoted datasheet number: angle random walk (°/√h) for gyros, σy(1 s) for clocks. On the ADEV plot it is the 1/√τ line, and N is the value at τ = 1 s. Integrated, it makes the error grow as N·√t — fast at first, slower later.' },
  B: { short: 'Bias instability — the floor of the ADEV plot, and the term that bites', long: 'B is the slow random wander of the bias during a run: 1/f noise on the rate. It is the flat floor of the ADEV plot, at height 0.664·B. You cannot calibrate it out, because it never settles. Once fixes stop, it grows the error as roughly B·t, which makes it the dominant term for outages longer than a few minutes on most devices. No simple filter model captures it exactly — that is what the estimate methods are about.' },
  K: { short: 'Rate random walk — the bias goes for a walk', long: 'K is white noise on the derivative of the bias, so the bias itself wanders off like a random walk. On the ADEV plot it is the rising √τ line at long τ (height K·√(τ/3)). Integrated twice, it grows the error as K·t^1.5/√3. It is the process-noise term a 2-state Kalman filter carries on its bias state.' },
  D: { short: 'Random walk of the drift rate (3-state devices)', long: 'D puts white noise on the drift rate itself — the aging rate of a clock wanders. The Allan variance does not even converge for this noise: a D-only device\'s ADEV keeps growing with record length and has no fixed slope, so no asymptote is drawn for it. HDEV handles it. D is usually tiny; what matters over months is its cousin, the uncertainty in the initial drift rate.' },
  R: { short: 'Steady drift: clock aging, gyro rate ramp', long: 'R is a deterministic, steady change of the rate with time. Left alone it grows the error as R·t²/2. Because it is deterministic, it can be estimated and removed. A 3-state device carries a drift state, so this tool treats its nominal aging as compensated on both the formula and the simulation — what remains is the uncertainty of that estimate (drift-rate uncertainty). A 2-state device has nowhere to put the compensation, so R appears in full.' },
  turnOnBias: { short: 'A different constant offset every power-up', long: 'Turn-on bias is a new constant offset each time the device powers on. It is not noise: the first few external fixes estimate it, and it is effectively gone before any outage starts. What survives is the small leftover uncertainty, which is the starting point of the error-growth curve. Do not confuse it with bias instability, which keeps wandering during the run.' },
  thermal: { short: 'Bias shift caused by temperature change', long: 'Temperature coefficient times temperature change equals bias shift. The device temperature follows the environment through a lag (thermal mass). An ADEV measured on a constant-temperature bench never shows this, and the budget formulas never include it — so it is shown as its own line, carried only by the simulated truth. If it dominates, you need thermal control or compensation, not a better device.' },
  Bayard: { short: 'The closed-form error-growth formula this tool uses', long: 'Bayard (JPL, 2000) wrote down exactly how the error covariance grows after the last external fix, for white rate noise plus a random-walk bias: P(t) = p11 + 2·p12·t + p22·t² + q1·t + q2·t³/3, starting from the steady-state post-fix covariance. It is exact for those two noises and has no term at all for flicker — which is why the estimate methods exist.' },
  fix: { short: 'How good and how frequent the external measurement was', long: 'Before the outage, something external (star tracker, GPS pulse) was correcting the device. Its 1σ accuracy and its cadence set the starting error when fixes stop — better or more frequent fixes lower the starting point. They do nothing about the growth rate afterward; that belongs to the device.' },
  requirement: { short: 'The error you are allowed at a given time, at a given confidence', long: 'A requirement is three numbers: an error value, a sigma level, and a duration — for example 1° at 3σ after 600 s. Every tab reports margin against the active requirement. The most useful single number at PDR is the ratio of simulated truth to the formula at that duration: it says how optimistic your budget method is for this device.' },
  Tm: { short: 'The one timescale where a flicker approximation is exact', long: 'Flicker noise has no exact filter model, so every approximation picks one timescale T_m where it is pinned to the true flicker floor. Near T_m the approximation is honest; away from it, it drifts. T_m defaults to the active requirement\'s duration, which is the honest choice. Change it to see how sensitive an inherited analysis was to someone else\'s arbitrary pick (Bayard used 1 hour).' },
  fudge: { short: 'Flicker fed into the formula as random walk — wrong shape, adjustable size', long: 'The classic trick: convert bias instability into a random-walk coefficient sized to match the flicker floor at T_m (q2 = B²/T_m). The resulting error grows as t^1.5, but real flicker grows as t — so for durations shorter than about 3·T_m the fudge is optimistic (about 4× at 10 minutes with a 1-hour T_m), and beyond that it is conservative. Defensible only as a bound, with T_m no larger than a third of your duration.' },
  constant: { short: 'Treat the bias as an unknown constant of size B', long: 'Assume the bias is some fixed unknown number with standard deviation B. The error then grows as B·t — the right shape and about the right size for flicker over minutes to hours. For an open-loop outage budget this is the honest single-term estimate. It is a poor model to run inside a live filter, which would eventually convince itself it knows the constant perfectly.' },
  gm: { short: 'Bias as an exponentially-forgetting process', long: 'The IEEE-952 default: a bias that wanders but forgets its past over a correlation time T_m. Below T_m it behaves like the constant model. Beyond T_m it forgets too much: the error grows only as √t, slower than real flicker, so it turns quietly optimistic for long durations. Its virtue is for running filters — bounded variance with live process noise keeps a filter healthy.' },
  fittedK: { short: 'Use only the measured random-walk line; ignore the floor', long: 'If the long-τ end of the ADEV has turned up into a √τ line, fit K directly from it — no fudge needed. Exact for the random-walk part, silent about the flicker floor, so it is optimistic across the whole flat region. Combine it with the constant model to cover both.' },
  gmSum: { short: 'Flicker built from several forgetting processes', long: 'A sum of Gauss-Markov processes with correlation times a decade apart imitates 1/f noise over that band. This is what a filter designer who needs a Markov flicker model actually builds. Switch the truth generator to it to see where the imitation departs from real flicker outside its band.' },
  DMTD: { short: 'How two good clocks are compared: mix both against a third', long: 'Both clocks are mixed against a common offset oscillator tuned a few hertz away, and the slow beat notes are timed. The offset oscillator is common to both channels, so its noise cancels in the difference — which is why a cheap oscillator can referee two atomic clocks. What is left is the electronics floor and whatever fails to cancel.' },
  leak: { short: 'The fraction of offset-oscillator noise that fails to cancel', long: 'The two DMTD channels are never perfectly identical, so a small fraction ε of the offset oscillator\'s noise survives into the measurement. At ε = 0 the offset oscillator is invisible. At ε = 0.01 a poor one reappears at long τ. This knob is the difference between "the OCXO does not matter" and "the OCXO matters".' },
  floor: { short: 'The electronics noise limit of the measurement', long: 'Mixers, detectors, and counters add white phase noise at the picosecond level. On the measured ADEV it is a 1/τ line at short τ, and nothing below it can be seen. If the floor sits above the clocks you are comparing, you are measuring your electronics, not your clocks.' },
  crossover: { short: 'Where the local clock becomes noisier than its reference', long: 'A disciplined clock (GPSDO, steered RAFS) trusts its reference at long τ and itself at short τ. The natural handoff is where their ADEV curves cross; the disciplined combination roughly follows the lower of the two. After losing the reference, holdover error grows from that point.' },
  knee: { short: 'Where a better device stops buying you anything', long: 'With periodic fixes, the steady-state error depends on both device noise and fix quality. Past some device grade, the error is fix-limited: a better device buys nothing. Conversely, for a given device there is a slowest fix cadence that still meets the requirement. That trade — device grade against fix duty cycle — is the PDR decision this chart shows.' },
  percentile: { short: 'The simulated "3σ" is a percentile, not 3 × a standard deviation', long: 'The envelope takes the absolute error across all simulated runs and reads the 99.7th percentile directly (or 95.5th, or 68th, matching the requirement\'s sigma level). Multiplying a standard deviation by 3 assumes the errors are Gaussian; flicker\'s accumulated error is not. Percentiles stay honest either way.' },
  confidence: { short: 'How trustworthy each measured ADEV point is', long: 'Every ADEV point is estimated from a finite record. Long-τ points come from only a handful of independent samples, so they scatter. The band shows the ±1σ statistical uncertainty; points beyond a tenth of the record length are drawn faded and should not be read at all.' },
  driftKnowledge: { short: 'How well the drift rate was known at the last sync', long: 'For a 3-state clock, the aging rate is estimated before launch or at the last sync. What enters the budget over months is not the aging itself — that is compensated — but the uncertainty of the estimate. That uncertainty grows the time error as (uncertainty)·t²/2 and usually dominates everything else at month scales.' },
};
```

- [ ] **Step 2: Verify** — `npm test` (glossary tests assert key coverage — must pass unmodified), `npm run build`. Skim every entry once against §9.8: no colon-chained stacks, nothing inaccurate.
- [ ] **Step 3: Commit** — `git commit -m "docs(glossary): rewrite every entry to the §9.8 prose standard"`

---

### Task 14: Final verification (controller-run)

- [ ] **Step 1:** `npm test` — full suite green.
- [ ] **Step 2:** `npm run build` — clean; confirm `ls dist` and `ls dist/assets` show no `_`-prefixed files.
- [ ] **Step 3:** Headless pixel probe (controller's existing puppeteer-core harness): load the dev server, walk all six tabs via hash, assert each chart canvas has nonzero colored pixels and no console errors; click one Guide example link and confirm it lands on the right tab.
- [ ] **Step 4:** Whole-branch review (subagent-driven-development final review), then merge per `superpowers:finishing-a-development-branch`.
