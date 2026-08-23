import './styles.css';
import { h, select } from './dom';
import { Store, toHash, fromHash } from './store';
import { defaultState, type AppState, type View } from './state';
import { mountSidebar } from './sidebar';
import { SimClient } from './workerClient';
import { LESSONS } from './lessons';
import { adevView } from './views/adev';
import { growthView } from './views/growth';
import { compareView } from './views/compare';
import { sizingView } from './views/sizing';
import type { ViewFactory, ViewHandle } from './views/types';

const VIEWS: Record<View, { label: string; make: ViewFactory }> = {
  adev: { label: 'Allan deviation', make: adevView },
  growth: { label: 'Error growth', make: growthView },
  compare: { label: 'Compare (DMTD)', make: compareView },
  sizing: { label: 'Sizing', make: sizingView },
};

export function mountApp(root: HTMLElement): void {
  const initial = (location.hash.length > 1 && fromHash(location.hash.slice(1))) || defaultState();
  const store = new Store(initial);
  const client = new SimClient();
  const aside = h('aside', {});
  const banner = h('div', { class: 'gloss', hidden: 'hidden' });
  const tabs = h('nav', { class: 'tabs' });
  const lessonBox = h('div', {});
  const viewRoot = h('div', {});
  const main = h('main', {}, h('h1', {}, 'clocksim'), tabs, lessonBox, banner, viewRoot);
  root.replaceChildren(aside, main);
  mountSidebar(aside, store);

  let current: { view: View; handle: ViewHandle } | null = null;
  const render = (s: AppState) => {
    tabs.replaceChildren(...(Object.keys(VIEWS) as View[]).map(v => h('button', { class: s.view === v ? 'active' : '', on: { click: () => store.set({ view: v }) } }, VIEWS[v].label)));
    lessonBox.replaceChildren(select('Load a lesson (optional — sets up the bench and scenario for a guided example)', [{ value: '', label: '—' }, ...LESSONS.map(l => ({ value: l.id, label: l.title }))], '', id => { const l = LESSONS.find(x => x.id === id); if (l) { store.update(cur => { const ls = l.state(); const extra = cur.bench.filter(d => !ls.bench.some(b => b.id === d.id)); return { ...ls, bench: [...ls.bench, ...extra] }; }); banner.textContent = l.blurb; banner.removeAttribute('hidden'); } }));
    if (!current || current.view !== s.view) { current?.handle.destroy(); viewRoot.replaceChildren(); current = { view: s.view, handle: VIEWS[s.view].make(viewRoot, store, client) }; }
    else current.handle.update(s);
    const hash = toHash(s);
    if (location.hash.slice(1) !== hash) history.replaceState(null, '', '#' + hash);
  };
  render(store.get());
  store.subscribe(render);
  window.addEventListener('hashchange', () => { const s = fromHash(location.hash.slice(1)); if (s && toHash(s) !== toHash(store.get())) store.update(() => s); });
}
