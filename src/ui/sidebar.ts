import { h, numInput, select, controlKey } from './dom';
import { dfn } from './glossary';
import type { Store } from './store';
import { fromPreset, isBenchDevice, uniqueId, type AppState, type BenchDevice, type Requirement, type Scenario } from './state';
import { PRESETS } from '../presets';
import { DATASHEET_UNITS, ERROR_UNIT, type Domain } from '../engine/units';
import { ESTIMATE_METHODS } from '../engine/models';
import type { Coefs } from '../engine/deviations';

export const exportDevice = (d: BenchDevice): string => JSON.stringify(d, null, 2);
export function importDevice(json: string): BenchDevice | null {
  try { const v = JSON.parse(json); return isBenchDevice(v) ? v : null; } catch { return null; }
}
export const reqValueToSI = (domain: Domain, v: number) => ERROR_UNIT[domain].toSI(v);
export const reqValueFromSI = (domain: Domain, v: number) => ERROR_UNIT[domain].fromSI(v);

const COEF_KEYS: (keyof Coefs)[] = ['Q', 'F', 'N', 'B', 'K', 'D', 'R'];

function deviceEditor(d: BenchDevice, store: Store): HTMLElement {
  const patch = (fn: (x: BenchDevice) => void) => store.update(s => ({ ...s, bench: s.bench.map(x => { if (x.id !== d.id) return x; const c = structuredClone(x); fn(c); return c; }) }));
  const units = DATASHEET_UNITS[d.domain];
  const fields = COEF_KEYS.map(k => numInput(k, d.coefs[k], v => patch(x => { x.coefs[k] = v; x.inferred = x.inferred.filter(i => i !== k); }), { min: 0, term: k, unit: units[k] + (d.inferred.includes(k) ? ' · inferred' : ''), key: controlKey(['dev', d.id, k]) }));
  return h('fieldset', {},
    h('legend', {}, d.name, d.placeholder ? h('span', { class: 'placeholder' }, ' PLACEHOLDER') : null),
    h('label', {}, 'Name', h('input', { value: d.name, 'data-key': controlKey(['dev', d.id, 'name']), on: { change: e => patch(x => { x.name = (e.target as HTMLInputElement).value; }) } })),
    h('div', { class: 'inferred' }, `${d.domain}, ${d.states}-state · ${d.source}`),
    ...fields,
    d.domain !== 'accel' ? select('States', [{ value: '2', label: '2 (error, bias)' }, { value: '3', label: '3 (+ drift)' }], String(d.states), v => patch(x => { x.states = v === '3' ? 3 : 2; }), { key: controlKey(['dev', d.id, 'states']) }) : null,
    select('Flicker truth model', [{ value: 'exact', label: 'exact 1/f (Kasdin)' }, { value: 'gmSum', label: 'Gauss-Markov sum (approximation)' }], d.flickerMode, v => patch(x => { x.flickerMode = v === 'gmSum' ? 'gmSum' : 'exact'; }), { key: controlKey(['dev', d.id, 'flickerMode']) }),
    d.flickerMode === 'gmSum' ? h('label', {}, dfn('gmSum', 'GM correlation times (s, comma-separated)'), h('input', { value: d.gmTaus.join(','), 'data-key': controlKey(['dev', d.id, 'gmTaus']), on: { change: e => patch(x => { x.gmTaus = (e.target as HTMLInputElement).value.split(',').map(Number).filter(v => v > 0); }) } })) : null,
    h('label', {}, h('input', { type: 'checkbox', checked: d.thermal ? 'checked' : undefined, 'data-key': controlKey(['dev', d.id, 'thermalToggle']), on: { change: e => patch(x => { x.thermal = (e.target as HTMLInputElement).checked ? { tempco: 0, tauTh: 0 } : null; }) } }), ' ', dfn('thermal', 'Thermal sensitivity')),
    d.thermal ? h('div', { class: 'row' },
      numInput('tempco', d.thermal.tempco, v => patch(x => { if (x.thermal) x.thermal.tempco = v; }), { unit: units.tempco, key: controlKey(['dev', d.id, 'tempco']) }),
      numInput('thermal lag', d.thermal.tauTh, v => patch(x => { if (x.thermal) x.thermal.tauTh = v; }), { unit: 's', min: 0, key: controlKey(['dev', d.id, 'tauth']) })) : null,
    h('div', { class: 'row' },
      h('button', { on: { click: () => navigator.clipboard.writeText(exportDevice(d)).catch(() => {}) } }, 'Copy JSON'),
      h('button', { on: { click: () => store.update(s => ({ ...s, bench: s.bench.filter(x => x.id !== d.id), selected: s.selected === d.id ? (s.bench.find(x => x.id !== d.id)?.id ?? null) : s.selected })) } }, 'Remove')),
  );
}

function benchPanel(s: AppState, store: Store): HTMLElement {
  const addFrom = (id: string) => { const p = PRESETS.find(x => x.id === id); if (!p) return; const newId = uniqueId(p.id, s.bench.map(b => b.id)); store.update(st => ({ ...st, bench: [...st.bench, fromPreset(p, newId)], selected: newId })); };
  const importBox = h('textarea', { rows: 3, placeholder: 'Paste device JSON to import', 'data-key': 'bench:import' });
  const importMsg = h('span', { class: 'warn', 'data-key': 'bench:import-msg' });
  return h('fieldset', {}, h('legend', {}, 'Bench'),
    select('Selected device', s.bench.map(d => ({ value: d.id, label: d.name })), s.selected ?? '', v => store.set({ selected: v }), { key: 'bench:selected' }),
    select('Add preset', [{ value: '', label: '—' }, ...PRESETS.map(p => ({ value: p.id, label: `${p.domain}: ${p.name}` }))], '', addFrom, { key: 'bench:addpreset' }),
    importBox,
    h('div', { class: 'row' },
      h('button', {
        on: {
          click: () => {
            const d = importDevice((importBox as HTMLTextAreaElement).value);
            if (d) {
              importMsg.textContent = '';
              store.update(st => ({ ...st, bench: [...st.bench.filter(x => x.id !== d.id), d], selected: d.id }));
            } else {
              importMsg.textContent = 'Invalid device JSON';
            }
          },
        },
      }, 'Import JSON'),
      importMsg),
    ...s.bench.filter(d => d.id === s.selected).map(d => deviceEditor(d, store)),
  );
}

function scenarioPanel(s: AppState, store: Store): HTMLElement {
  const sc = s.scenario;
  const dev = s.bench.find(d => d.id === s.selected);
  const domain: Domain = dev?.domain ?? 'gyro';
  const eu = ERROR_UNIT[domain];
  const set = (fn: (x: Scenario) => void) => store.update(st => { const c = structuredClone(st.scenario); fn(c); return { ...st, scenario: c }; });
  const profile = sc.temperature;
  const profileFields = (): HTMLElement[] => {
    switch (profile.kind) {
      case 'none': return [];
      case 'step': return [numInput('step amplitude', profile.amplitude, v => set(x => { x.temperature = { kind: 'step', amplitude: v, at: profile.at }; }), { unit: 'K', key: controlKey(['scenario', 'stepAmplitude']) }), numInput('step at', profile.at, v => set(x => { x.temperature = { kind: 'step', amplitude: profile.amplitude, at: v }; }), { unit: 's', min: 0, key: controlKey(['scenario', 'stepAt']) })];
      case 'ramp': return [numInput('ramp rate', profile.rate, v => set(x => { x.temperature = { kind: 'ramp', rate: v }; }), { unit: 'K/s', key: controlKey(['scenario', 'rampRate']) })];
      case 'sinusoid': return [numInput('amplitude', profile.amplitude, v => set(x => { x.temperature = { kind: 'sinusoid', amplitude: v, period: profile.period }; }), { unit: 'K', key: controlKey(['scenario', 'sinAmplitude']) }), numInput('period', profile.period, v => set(x => { x.temperature = { kind: 'sinusoid', amplitude: profile.amplitude, period: v }; }), { unit: 's', min: 1, key: controlKey(['scenario', 'sinPeriod']) })];
    }
  };
  const setKind = (k: string) => set(x => { x.temperature = k === 'step' ? { kind: 'step', amplitude: 5, at: 0 } : k === 'ramp' ? { kind: 'ramp', rate: 0.001 } : k === 'sinusoid' ? { kind: 'sinusoid', amplitude: 5, period: 5400 } : { kind: 'none' }; });
  return h('fieldset', {}, h('legend', {}, 'Scenario'),
    h('div', { class: 'row' },
      numInput('duration', sc.duration, v => set(x => { x.duration = v; }), { unit: 's', min: 1, key: controlKey(['scenario', 'duration']) }),
      numInput('sample dt', sc.dt, v => set(x => { x.dt = v; }), { unit: 's', min: 1e-4, key: controlKey(['scenario', 'dt']) }),
      numInput('MC runs', sc.runs, v => set(x => { x.runs = Math.max(1, Math.round(v)); }), { min: 1, step: 1, key: controlKey(['scenario', 'runs']) }),
      numInput('seed', sc.seed, v => set(x => { x.seed = Math.round(v); }), { step: 1, key: controlKey(['scenario', 'seed']) })),
    h('div', { class: 'row' },
      numInput('last-fix 1σ', reqValueFromSI(domain, sc.fix.sigma), v => set(x => { x.fix.sigma = reqValueToSI(domain, v); }), { unit: eu.label, term: 'fix', min: 0, key: controlKey(['scenario', 'fixSigma']) }),
      numInput('fix cadence Δ', sc.fix.cadence, v => set(x => { x.fix.cadence = v; }), { unit: 's', min: 1e-3, key: controlKey(['scenario', 'fixCadence']) }),
      numInput('fix bias', reqValueFromSI(domain, sc.fix.bias), v => set(x => { x.fix.bias = reqValueToSI(domain, v); }), { unit: eu.label, term: 'turnOnBias', min: 0, key: controlKey(['scenario', 'fixBias']) })),
    domain === 'clock' && dev?.states === 3 ? numInput('drift-rate uncertainty', sc.driftKnowledge ? Math.sqrt(sc.driftKnowledge) * 86400 : 0, v => set(x => { x.driftKnowledge = v > 0 ? (v / 86400) ** 2 : null; }), { unit: 'Δf/f per day, 1σ', term: 'driftKnowledge', min: 0, key: controlKey(['scenario', 'driftKnowledge']) }) : null,
    select('Temperature profile', [{ value: 'none', label: 'none' }, { value: 'step', label: 'step' }, { value: 'ramp', label: 'ramp' }, { value: 'sinusoid', label: 'sinusoid (orbital)' }], profile.kind, setKind, { key: controlKey(['scenario', 'tempProfile']) }),
    ...profileFields(),
    h('label', {}, h('input', { type: 'checkbox', checked: sc.includeThermal ? 'checked' : undefined, 'data-key': controlKey(['scenario', 'includeThermal']), on: { change: e => set(x => { x.includeThermal = (e.target as HTMLInputElement).checked; }) } }), ' include thermal in truth'),
    h('label', {}, dfn('Tm', 'Model timescale T_m'), h('input', { value: sc.Tm === 'auto' ? 'auto' : String(sc.Tm), 'data-key': controlKey(['scenario', 'tm']), on: { change: e => { const v = (e.target as HTMLInputElement).value.trim(); set(x => { x.Tm = v === 'auto' ? 'auto' : Math.max(1e-3, Number(v) || 1); }); } } })),
    h('div', {}, 'Estimate methods: ', ...ESTIMATE_METHODS.map(m => h('label', { style: 'display:inline-block;margin-right:8px' }, h('input', { type: 'checkbox', checked: sc.estimateMethods.includes(m) ? 'checked' : undefined, 'data-key': controlKey(['scenario', 'estimateMethod', m]), on: { change: e => set(x => { const on = (e.target as HTMLInputElement).checked; x.estimateMethods = on ? [...new Set([...x.estimateMethods, m])] : x.estimateMethods.filter(k => k !== m); }) } }), ' ', dfn(m)))),
    h('div', {},
      select(dfn('ADEV', 'Deviation'), [{ value: 'adev', label: 'ADEV' }, { value: 'mdev', label: 'MDEV' }, { value: 'hdev', label: 'HDEV' }], sc.devKind, v => set(x => { x.devKind = v as Scenario['devKind']; }), { key: controlKey(['scenario', 'devKind']) }),
      h('div', { class: 'row' }, 'see also: ', dfn('MDEV'), ' · ', dfn('HDEV'))),
  );
}

function requirementsPanel(s: AppState, store: Store): HTMLElement {
  const dev = s.bench.find(d => d.id === s.selected);
  const domain: Domain = dev?.domain ?? 'gyro';
  const eu = ERROR_UNIT[domain];
  const set = (fn: (x: Scenario) => void) => store.update(st => { const c = structuredClone(st.scenario); fn(c); return { ...st, scenario: c }; });
  const row = (r: Requirement) => h('div', { class: 'row' },
    h('label', {}, h('input', { type: 'radio', name: 'activeReq', checked: s.scenario.activeRequirement === r.id ? 'checked' : undefined, 'data-key': controlKey(['req', r.id, 'active']), on: { change: () => set(x => { x.activeRequirement = r.id; }) } }), ' active'),
    numInput('value', reqValueFromSI(domain, r.value), v => set(x => { const q = x.requirements.find(y => y.id === r.id); if (q) q.value = reqValueToSI(domain, v); }), { unit: eu.label, min: 0, key: controlKey(['req', r.id, 'value']) }),
    select('sigma', [{ value: '1', label: '1σ' }, { value: '2', label: '2σ' }, { value: '3', label: '3σ' }], String(r.sigma), v => set(x => { const q = x.requirements.find(y => y.id === r.id); if (q) q.sigma = Number(v) as 1 | 2 | 3; }), { key: controlKey(['req', r.id, 'sigma']) }),
    numInput('duration', r.duration, v => set(x => { const q = x.requirements.find(y => y.id === r.id); if (q) q.duration = v; }), { unit: 's', min: 1, key: controlKey(['req', r.id, 'duration']) }),
    h('button', { 'data-key': controlKey(['req', r.id, 'remove']), on: { click: () => set(x => { x.requirements = x.requirements.filter(y => y.id !== r.id); if (x.activeRequirement === r.id) x.activeRequirement = x.requirements[0]?.id ?? null; }) } }, 'remove'));
  return h('fieldset', {}, h('legend', {}, dfn('requirement', 'Requirements')),
    ...s.scenario.requirements.map(row),
    h('button', { 'data-key': 'req:add', on: { click: () => set(x => { const id = uniqueId('r' + (x.requirements.length + 1), x.requirements.map(y => y.id)); x.requirements.push({ id, value: reqValueToSI(domain, 1), sigma: 3, duration: 600 }); x.activeRequirement ??= id; }) } }, 'Add requirement'));
}

export function mountSidebar(root: HTMLElement, store: Store): void {
  const render = (s: AppState) => {
    const activeKey = document.activeElement?.getAttribute('data-key') ?? null;
    const prevImport = root.querySelector<HTMLTextAreaElement>('[data-key="bench:import"]');
    const importValue = prevImport?.value ?? '';
    root.replaceChildren(benchPanel(s, store), scenarioPanel(s, store), requirementsPanel(s, store));
    const newImport = root.querySelector<HTMLTextAreaElement>('[data-key="bench:import"]');
    if (newImport) newImport.value = importValue;
    if (activeKey) {
      const toFocus = root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`);
      toFocus?.focus();
    }
  };
  render(store.get());
  store.subscribe(render);
}
