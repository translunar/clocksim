import { h } from '../dom';
import { dfn } from '../glossary';
import { toHash } from '../store';
import { defaultState, fromPreset, updateDomain, type AppState } from '../state';
import { PRESETS } from '../../presets';
import type { ViewFactory } from './types';

const P = (id: string) => fromPreset(PRESETS.find(p => p.id === id)!);

/** Each example is a plain URL hash — loading one is just navigation (spec §9.6). */
function ex(build: () => AppState): string { return '#' + toHash(build()); }

/**
 * Exported so a test can decode every hash: these are built at module load with
 * `PRESETS.find(...)!`, so a renamed preset id would otherwise throw at app boot.
 */
export const EXAMPLES = {
  slopes: ex(() => { const s = defaultState(); const g = P('stim300-gyro'); g.coefs.K = 0.05; s.bench = [g]; s.selected = g.id; return { ...updateDomain(s, 'gyro', ds => { ds.duration = 36000; ds.dt = 0.1; }), view: 'adev' as const }; }),
  fudge: ex(() => { const s = defaultState(); s.bench = [P('lsm6dsl-gyro')]; s.selected = 'lsm6dsl-gyro'; s.scenario.Tm = 3600; s.scenario.estimateMethods = ['fudge', 'constant', 'gm']; return { ...s, view: 'growth' as const }; }),
  clocks: ex(() => { const s = defaultState(); s.bench = [P('cesium-5071a'), P('prs10-rb')]; s.selected = 'cesium-5071a'; s.scenario.runs = 100; return { ...s, view: 'growth' as const }; }),
  dmtd: ex(() => { const s = defaultState(); s.bench = [P('rafs'), P('cesium-5071a'), P('tcxo'), P('ocxo')]; s.selected = 'rafs'; s.scenario.compare = { dut: 'rafs', ref: 'cesium-5071a', osc: 'tcxo', leak: 0, floorQ: 1e-12 }; return { ...s, view: 'compare' as const }; }),
  thermal: ex(() => { const s = defaultState(); const o = P('ocxo'); o.thermal = { tempco: 0.02, tauTh: 600 }; s.bench = [o]; s.selected = 'ocxo'; s.scenario.compareBy = 'thermal'; return { ...updateDomain(s, 'clock', ds => { ds.duration = 6 * 3600; ds.requirements = [{ id: 'c1', value: 1e-6, sigma: 3, duration: 3 * 3600 }]; ds.activeRequirement = 'c1'; }), view: 'growth' as const }; }),
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
      h('p', { class: 'inferred' },
        'The analytic curves follow D. Bayard’s method (JPL EM-3455-00-005). This tool uses the same algebra as our open implementation: ',
        h('a', { href: 'https://github.com/translunar/bayard', target: '_blank', rel: 'noopener' }, 'translunar/bayard'), '.'),
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
      h('h3', {}, 'Thermal: a requirement you hand the thermal team'),
      h('p', {},
        'An ADEV is measured on a bench at constant temperature; your mission is not so lucky. ',
        'The thermal view asks one question: how much sustained temperature offset can this device absorb and still meet the requirement? ',
        'The answer is a number in kelvin. It is not yours to tune — it is a requirement you ', dfn('flowdown', 'flow down'), ' to the thermal team, with margin.'),
      link(EXAMPLES.thermal)),
  ));
  return { update: () => {}, destroy: () => root.replaceChildren() };
};
