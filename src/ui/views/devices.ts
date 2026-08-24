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
        numInput('tempco', d.thermal.tempco, v => patch(x => { if (x.thermal) x.thermal.tempco = v; }), { unit: units.tempco, key: controlKey(['dev', d.id, 'tempco']) })) : null),
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
