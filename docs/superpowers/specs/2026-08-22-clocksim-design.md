# clocksim — Allan deviation teaching simulator

**Date:** 2026-08-22
**Status:** approved design, pre-implementation

## 1. Purpose

A client-side web tool for building intuition about how the noise properties of
single-axis gyroscopes, accelerometers, and clocks (atomic and quartz) show up
in Allan deviation plots, and how those same properties determine error growth
during open-loop propagation:

1. How long does a gyro-propagated attitude take to accumulate a given 3σ
   pointing error (Farrenkopf / Bayard model)?
2. How much time error does an onboard clock accumulate over N seconds
   (2- or 3-state clock model, relativity ignored)?

The tool is for PDR-level error budgeting and device selection: "what error
can we reasonably expect from this device over this duration, and does it meet
the requirement with margin?" Duration is the independent variable and spans
seconds (tracker dropout) to months (clock between syncs); each noise term
dominates a different stretch of it.

The central lesson: the analytic covariance models used for budgeting
(Farrenkopf, Bayard, 3-state clock) are exact for white and random-walk noise
but cannot represent flicker (bias instability) or environmental effects. The
common workaround of feeding bias instability in as a random-walk coefficient
(`bayard_calc.m`: q₂ = B²/3600) is optimistic for durations shorter than
~3×T_m (the model timescale, see §3.4) and conservative beyond. The tool shows every reasonable analytic
estimate against Monte Carlo truth across the full duration span, so the user
can see which estimate is defensible at the duration their requirement names.

**Primary audience:** the author. **Secondary:** teammates learning the material.
Every term in the UI has a plain-English definition on hover/expand.

## 2. Scope

### In v1
- Devices: gyro (2-state), accelerometer (3-state), clock (2- or 3-state), all
  sharing one n-state integrator-chain engine.
- Exact power-law noise simulation (white PM, flicker PM, white FM, flicker FM,
  random-walk FM) plus linear drift, via the Kasdin (1995) fractional-difference
  filter. Gauss-Markov-sum flicker approximation as a contrast mode.
- ADEV, MDEV, HDEV with confidence bounds; analytic asymptotes overlaid.
- Requirements as first-class objects: (value, sigma level, duration); every
  view reports margin against the active requirement.
- Error-growth view over log time (1 s to ~1e7 s): stacked noise contributions
  (post-fix initial, ARW, BI, RRW, drift, thermal), a selectable set of
  analytic estimate methods, and the Monte Carlo envelope, with
  time-to-requirement for each.
- Two analytic sizing views: steady-state error vs fix cadence (gyro/accel
  "diminishing-returns knee") and ADEV crossover / holdover vs a reference
  (clocks).
- Bench of N device instances; presets with cited sources; all fields editable;
  custom presets import/export as JSON; full state in URL hash.
- Thermal: per-device tempco and first-order thermal lag driven by a shared
  ambient temperature profile (none / step / ramp / sinusoid).
- Compare view (clocks only): DMTD with DUT, reference, offset-oscillator
  roles, a white-PM measurement floor, and a common-mode rejection factor.
- Glossary layer and a handful of saved "lesson" states.
- Static build deployable to `translunar.github.io/tools/clocksim/`.

### Explicitly out of v1 (phase 2 candidates)
- Measurement updates (star tracker / GPS fixes) — open-loop only.
- Three-cornered hat, arbitrary comparison graphs, distribution-amplifier noise.
- Filter tuning / consistency analysis (NEES).
- Shared-enclosure thermal coupling, nonlinear tempco, hysteresis.
- Scale-factor, misalignment, g-sensitivity, relativity.
- Streaming/real-time noise generation (batch only).

## 3. Physics

### 3.1 Unifying model
A device is an n-state chain (n = 2 or 3) integrated from the rate-like state
downward, with independent white process noise injected at each level:

| Level | Clock | Accelerometer | Gyro |
|---|---|---|---|
| ∫∫ | phase / time error x | position | — |
| ∫ | fractional frequency y | velocity | angle θ |
| rate-like | frequency drift (aging) | accel bias | rate bias b |

Open-loop error variance for the top-level integral:
`σ²(t) = q₁·t + q₂·t³/3 + q₃·t⁵/20 + (initial-covariance terms)`.
Gyro/2-state clock uses q₁, q₂; accelerometer/3-state clock uses all three.

### 3.2 Noise coefficients and ADEV asymptotes
Datasheet coefficients accepted by the editor (datasheet units → SI at the
engine boundary):

| Coef | Name | ADEV | Gyro unit | Clock equivalent |
|---|---|---|---|---|
| Q | quantization / white PM | σ = √3·Q/τ | rad | h₂ |
| N | angle random walk / white FM | σ = N/√τ | °/√h | h₀: σ² = h₀/(2τ) |
| B | bias instability / flicker FM | σ ≈ 0.664·B | °/h | h₋₁: σ² = 2ln2·h₋₁ |
| K | rate random walk / RW FM | σ = K·√(τ/3) | °/h/√h | h₋₂ |
| R | rate ramp / linear drift | σ = R·τ/√2 | °/h² | drift per day |

Flicker PM (τ⁻¹ under ADEV, τ⁻³ᐟ² vs τ⁻¹ separable under MDEV) is supported in
the generator and shown in the ADEV view as the motivation for MDEV.

### 3.3 Noise generation
`powerLaw(alpha, n, seed)`: white Gaussian noise filtered by the Kasdin
recursion `h₀ = 1, hₖ = hₖ₋₁·(k − 1 + α/2)/k`, convolved via FFT. Exact for
any α over the simulated span (filter length = series length). One code path
for all five noise types. Reference implementation: `allantools.noise`.

`gaussMarkovSum(taus, n, seed)`: sum of first-order Gauss-Markov processes
with log-spaced time constants, normalized to approximate 1/f over that band.
Used only as the "what the filter designer actually models" contrast.

Seeded PRNG (xoshiro128**); seed is part of the serialized state.

### 3.4 Analytic estimates ("what the budget says")
Port of the Bayard 2-state gyro model from the fixed `bayard.py`
(translunar/bayard PR #2), generalized to the 3-state chain:

- Steady-state post-fix initial covariance from last-fix quality
  `r = Δ·σ_fix²`: `l = √(q₁ + 2√(r q₂))`, `p₁₁ = √r·l`, `p₁₂ = √(r q₂)`,
  `p₂₂ = √q₂·l`.
- `p(t) = q₂/3·t³ + p₂₂·t² + (2p₁₂ + q₁)·t + p₁₁ + b²` (2-state); 3-state
  adds the q₃ and third-row terms per Bayard's accelerometer formulation.
- 3-state takes an explicit drift-knowledge input `p₃₃` (how well the
  drift/aging rate was characterized at the last sync or before launch); for
  months-scale clocks `√p₃₃·t²/2` is the dominant term.
- The model never sees flicker or thermal terms — by design.

The Bayard model is exact for white + random-walk noise. The user-selectable
part is how bias instability B enters it. Four **estimate methods**, all
computed and plotted simultaneously; each has a glossary entry stating its
assumption and the duration range where it is defensible, and the active
requirement's duration highlights which applies.

**Time variables.** Only three are user inputs: `t` (duration since last fix —
the requirement's duration and the error-growth x-axis), `Δ` (fix cadence
before the outage), and `T_m` (**model timescale**: the single timescale at
which an approximate method is pinned to equal the flicker floor). `T_m`
defaults to the active requirement's `t`; the user changes it for sensitivity
studies, to reproduce an inherited analysis (Bayard used 1 h), or to hold one
set of numbers across several requirements. ADEV's averaging window τ is a
plot axis, never an input.

| Method | B enters as | Honest when |
|---|---|---|
| `fudge` | q₂ = B²/T_m — the `bayard_calc.m` mapping | as a bound if T_m ≤ t/3; optimistic for t < 3·T_m by ≈√(t/3T_m) |
| `constant` | random-constant bias, p₂₂ = B², no process noise: σ_θ ≈ B·t | minutes to hours; slightly low at very long t (flicker log growth) |
| `gm` | first-order Gauss-Markov, σ = B, correlation time τ_c = T_m | t < T_m; optimistic ∝ √(t/2T_m) beyond |
| `fittedK` | B ignored; K taken from the spec (or fit to the simulated ADEV's τ^{+1/2} region) | once the ADEV has turned up; still missing the floor |

The error-growth view also decomposes the estimate into stacked contributions
— post-fix initial, ARW (N√t), BI (per method), RRW (K t^{3/2}/√3), drift
(√p₃₃ t²/2), thermal (tempco·ΔT·t) — so the user can see which term a device
change actually buys down.

### 3.5 Monte Carlo truth
Default 200 runs × 10⁵ samples in a Web Worker, streamed so the envelope
sharpens as runs complete. Each run draws its initial state from the same
Bayard initial covariance the model uses, so model and truth start from the
same place. Envelope = percentiles of |error| across runs; the "3σ" curve is
the 99.7th percentile, not 3× sample σ. All five noise types plus drift and
thermal are simulated.

### 3.6 Thermal
Shared ambient profile `T_amb(t)` ∈ {none, step, ramp, sinusoid(period, amp)}.
Per device: `τ_th` (first-order lag; 0 = none), `T_ref`, `tempco`.
`T_dev' = (T_amb − T_dev)/τ_th`; rate offset `= tempco·(T_dev − T_ref)`.
Included in simulated ADEV and error growth (toggleable); invisible to the
analytic model.

### 3.7 Compare / DMTD (clocks)
Roles drawn from the bench: DUT, reference, offset oscillator (default OCXO
preset). Measured phase difference:
`x_meas = x_DUT − x_REF + ε·x_OSC + floor`, where `ε` is the common-mode
rejection leakage (default 0, user-settable) and `floor` is white PM at a
user-set level (ps class). View shows ADEV of DUT, REF, OSC individually and
of `x_meas`. Lessons: swapping the offset oscillator changes almost nothing at
ε = 0; raising ε brings its noise back at long τ.

### 3.8 Stated limits (shown in UI)
Flicker exact only over the simulated span; ADEV points beyond ~τ_max/10
are drawn faded; no relativity, scale factor, misalignment, or measurement
updates.

### 3.9 Analytic sizing views (closed-loop, no simulation)
- **Steady-state knee (gyro/accel):** `√p₁₁` vs fix cadence Δ for each bench
  device, with the requirement line. Shows where error becomes fix-limited and
  a better device buys nothing, and conversely the slowest cadence each device
  tolerates.
- **ADEV crossover / holdover (clock):** in Compare, when a device is marked
  "reference," mark the τ where the DUT's ADEV crosses the reference's (the
  natural disciplining time constant) and report open-loop holdover time to
  the requirement from that point.

### 3.10 Requirements
`{ value, sigma: 1|2|3, duration }` in the domain's natural unit (deg, ns,
m). Views report: predicted error at `duration` per estimate method and from
Monte Carlo; time-to-requirement per method and from Monte Carlo; the
truth/estimate ratio at `duration`. Multiple requirements may be defined; one
is active.

## 4. Architecture

Plain TypeScript, no UI framework, Vite build, Vitest tests. Engine is pure
(no DOM) and runs in a Web Worker; main thread renders with uPlot.

```
src/
  engine/
    noise.ts        powerLaw, gaussMarkovSum, prng
    deviations.ts   adev, mdev, hdev, confidence, analyticAdev(coefs)
    bench.ts        DeviceSpec, simulate(spec, dt, n, seed, env), compare(...)
    models.ts       bayard2, bayard3, initialCovariance, estimate methods,
                    contribution decomposition, steady-state vs cadence
    units.ts        datasheet ↔ SI conversions
    thermal.ts      ambient profiles, device lag
  worker/
    sim.worker.ts   runs MC batches, posts typed arrays + progress
  ui/
    store.ts        reactive state, URL-hash (de)serialization
    sidebar/        bench editor, preset picker, scenario panel
    views/          adev.ts, growth.ts, compare.ts, sizing.ts
    charts/         uPlot wrappers, log axes, bands
    glossary.ts     term → definition
  presets/
    *.json          one file per device, with `source` field
  lessons/
    *.json          saved states + one-line framing
fixtures/           python-generated oracles (see §5)
tools/
    gen_fixtures.py allantools + fixed bayard.py
```

**Data flow:** UI edit → store → serialize to hash → worker message
`{bench, scenario}` → worker streams `{runIndex, series}` → store accumulates
percentiles → views re-render. Engine functions are also importable directly
for tests and for a future Node/notebook use.

**DeviceSpec** (SI, post-conversion):
```
{ id, name, domain: 'clock'|'gyro'|'accel', states: 2|3,
  Q, N, B, K, R,                  // noise coefficients (SI)
  flickerMode: 'exact'|'gmSum',   // truth generator for B
  thermal: { tempco, tauTh, Tref } | null,
  source: string, editable: true }
```

**Scenario:** `{ duration, dt, runs, seed, lastFix: {sigma, cadence, bias},
driftKnowledge: p33 | null, temperature: profile, modelTimescale: Tm | 'auto',
estimateMethods: Set<'fudge'|'constant'|'gm'|'fittedK'>, requirements:
Requirement[], activeRequirement }`. `'auto'` means T_m follows the active
requirement's duration.

## 5. Testing

- `fixtures/` generated by `tools/gen_fixtures.py` and committed:
  - Kasdin noise for each α at a fixed seed sequence (compare PSD slope and
    ADEV slope, not sample-by-sample, since PRNGs differ).
  - ADEV/MDEV/HDEV of known series from `allantools`, compared to 1e-9.
  - Bayard σ(t) from fixed `bayard.py` for jpl_mimu + BCT fix at
    t ∈ {1, 60, 3600} s, compared to 1e-12.
  - Estimate methods: `constant` reproduces B·t; `gm` → `constant` as T_m→∞;
    `fudge` equals Bayard with q₂ = B²/T_m. Contribution stack RSSes to
    the total.
  - Monte Carlo envelope for a pure-flicker spec grows ≈ B·t (within the log
    factor) — the one test that checks the truth side against theory.
- Unit tests: unit conversions round-trip; analytic asymptotes match simulated
  ADEV within confidence bounds for single-noise-type specs; thermal lag step
  response; DMTD with ε = 0 is independent of offset oscillator.
- One smoke test that the worker protocol round-trips a small scenario.

## 6. Presets (initial roster; each editable, each cites its source)

Gyros: MEMS consumer (LSM6DSL), MEMS tactical (STIM300), FOG (Epson M-G364),
RLG nav-grade (LN-100 class), Honeywell MIMU class.
Accelerometers: MEMS consumer, tactical, nav-grade (QA2000 class).
Clocks: TCXO, OCXO, CSAC, rubidium (commercial), RAFS (from open PTTI
literature if found; otherwise marked "placeholder — enter datasheet values"),
miniRAFS (same caveat), cesium beam, hydrogen maser.
Fix sources for scenario panel: star tracker NEA/cadence, GPS 1PPS sync.

## 7. Deployment

`vite build` → `dist/` copied into `translunar.github.io/tools/clocksim/`
(separate manual step; no coupling to Jekyll beyond a link).

## 8. Open questions deferred to implementation
- Exact MC defaults (runs × samples) after measuring worker throughput.
- Whether uPlot's band rendering is adequate for percentile envelopes or a
  small custom draw hook is needed.
