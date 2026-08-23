import { h, numInput, select, controlKey, expander } from './dom';
import { dfn } from './glossary';
import type { Store } from './store';
import { activeDomain, activeReq, defaultDomainScenarios, updateDomain, uniqueId, type AppState, type DomainScenario, type Requirement } from './state';
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
    const active = activeReq(ds);

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
      ...(s.bench.length === 0 ? [h('p', { class: 'inferred' }, 'Bench is empty — add a device on the Devices tab.')] : []),
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
        h('button', { 'data-key': 'req:add', on: { click: () => setD(x => { const id = uniqueId('r' + (x.requirements.length + 1), x.requirements.map(y => y.id)); x.requirements.push({ id, value: reqValueToSI(dom, 1), sigma: 3, duration: defaultDomainScenarios()[dom].requirements[0]!.duration }); x.activeRequirement ??= id; }) } }, 'Add requirement')),
    );
    if (activeKey) root.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)?.focus();
  };
  render(store.get());
  store.subscribe(render);
}
