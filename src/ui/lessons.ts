import { defaultState, fromPreset, type AppState } from './state';
import { PRESETS } from '../presets';

const P = (id: string) => fromPreset(PRESETS.find(p => p.id === id)!);

export const LESSONS: { id: string; title: string; blurb: string; state: () => AppState }[] = [
  {
    id: 'slopes', title: '1. Reading slopes off an ADEV plot',
    blurb: 'A tactical MEMS gyro with white, flicker and random-walk noise all present. Each coefficient is drawn as a dashed asymptote; the simulated curve follows the upper envelope. Toggle MDEV to see why it exists.',
    state: () => { const s = defaultState(); const g = P('stim300-gyro'); g.coefs.K = 0.05; s.bench = [g]; s.selected = g.id; s.scenario.duration = 36000; s.scenario.dt = 0.1; s.view = 'adev'; return s; },
  },
  {
    id: 'fudge', title: '2. When the one-hour fudge lets you down',
    blurb: 'Consumer MEMS gyro, 10-minute outage, 1° requirement at 3σ, star-tracker fixes every 0.5 s before the outage. The fudge (q2 = B²/1 h) is several times optimistic at 10 minutes; the constant-B estimate tracks the Monte Carlo truth. Slide T_m to see the sensitivity.',
    state: () => { const s = defaultState(); s.bench = [P('lsm6dsl-gyro')]; s.selected = 'lsm6dsl-gyro'; s.scenario.Tm = 3600; s.scenario.estimateMethods = ['fudge', 'constant', 'gm']; s.scenario.requirements = [{ id: 'r1', value: Math.PI / 180, sigma: 3, duration: 600 }]; s.scenario.activeRequirement = 'r1'; s.scenario.duration = 3600; s.view = 'growth'; return s; },
  },
  {
    id: 'cesium', title: '3. Cesium: where the 2-state model is nearly exact',
    blurb: 'A cesium beam standard is white-FM out to days with a floor far below anything that matters over a day, so every estimate method agrees with the truth. Compare against the rubidium preset to see flicker and aging reappear.',
    state: () => { const s = defaultState(); s.bench = [P('cesium-5071a'), P('prs10-rb')]; s.selected = 'cesium-5071a'; s.scenario.dt = 1; s.scenario.duration = 86400; s.scenario.fix = { sigma: 10e-9, cadence: 1, bias: 0 }; s.scenario.requirements = [{ id: 'r1', value: 1e-6, sigma: 3, duration: 86400 }]; s.scenario.activeRequirement = 'r1'; s.scenario.runs = 100; s.view = 'growth'; return s; },
  },
  {
    id: 'dmtd', title: '4. DMTD: the offset oscillator does not matter (until it does)',
    blurb: 'Compare a RAFS against a cesium reference through a DMTD whose offset oscillator is a TCXO. With zero leak the measured difference ignores the TCXO entirely; set leak to 0.01 and watch it come back at long τ.',
    state: () => { const s = defaultState(); s.bench = [P('rafs'), P('cesium-5071a'), P('tcxo'), P('ocxo')]; s.selected = 'rafs'; s.scenario.dt = 1; s.scenario.duration = 86400; s.scenario.compare = { dut: 'rafs', ref: 'cesium-5071a', osc: 'tcxo', leak: 0, floorQ: 1e-12 }; s.view = 'compare'; return s; },
  },
  {
    id: 'thermal', title: '5. Thermal: what the ADEV never told you',
    blurb: 'An OCXO on a 90-minute orbital temperature swing of ±5 K with a 10-minute thermal lag. The analytic estimate never sees it; the Monte Carlo truth does. Change the thermal lag to see what an enclosure buys.',
    state: () => { const s = defaultState(); const o = P('ocxo'); o.thermal = { tempco: 0.02, tauTh: 600 }; s.bench = [o]; s.selected = 'ocxo'; s.scenario.dt = 1; s.scenario.duration = 6 * 3600; s.scenario.temperature = { kind: 'sinusoid', amplitude: 5, period: 5400 }; s.scenario.fix = { sigma: 10e-9, cadence: 1, bias: 0 }; s.scenario.requirements = [{ id: 'r1', value: 1e-6, sigma: 3, duration: 3 * 3600 }]; s.scenario.activeRequirement = 'r1'; s.view = 'growth'; return s; },
  },
];
