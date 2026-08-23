import './styles.css';
import { h } from './dom';
import { Store, toHash, fromHash } from './store';
import { defaultState, type AppState, type View } from './state';
import { mountSidebar } from './sidebar';
import { SimClient } from './workerClient';
import { guideView } from './views/guide';
import { devicesView } from './views/devices';
import { adevView } from './views/adev';
import { growthView } from './views/growth';
import { sizingView } from './views/sizing';
import { compareView } from './views/compare';
import type { ViewFactory, ViewHandle } from './views/types';

const VIEWS: Record<View, { label: string; make: ViewFactory }> = {
  guide: { label: 'Guide', make: guideView },
  devices: { label: 'Devices', make: devicesView },
  adev: { label: 'ADEV', make: adevView },
  growth: { label: 'Error growth', make: growthView },
  sizing: { label: 'Sizing', make: sizingView },
  compare: { label: 'DMTD', make: compareView },
};

export function mountApp(root: HTMLElement): void {
  const initial = (location.hash.length > 1 && fromHash(location.hash.slice(1))) || defaultState();
  const store = new Store(initial);
  const client = new SimClient();
  const aside = h('aside', {});
  const tabs = h('nav', { class: 'tabs' });
  const viewRoot = h('div', {});
  const main = h('main', {}, h('h1', {}, 'clocksim'), tabs, viewRoot);
  root.replaceChildren(aside, main);
  mountSidebar(aside, store);

  let current: { view: View; handle: ViewHandle } | null = null;
  const render = (s: AppState) => {
    tabs.replaceChildren(...(Object.keys(VIEWS) as View[]).map(v => h('button', { class: s.view === v ? 'active' : '', on: { click: () => store.set({ view: v }) } }, VIEWS[v].label)));
    if (!current || current.view !== s.view) { current?.handle.destroy(); viewRoot.replaceChildren(); current = { view: s.view, handle: VIEWS[s.view].make(viewRoot, store, client) }; }
    else current.handle.update(s);
    const hash = toHash(s);
    if (location.hash.slice(1) !== hash) history.replaceState(null, '', '#' + hash);
  };
  render(store.get());
  store.subscribe(render);
  window.addEventListener('hashchange', () => { const s = fromHash(location.hash.slice(1)); if (s && toHash(s) !== toHash(store.get())) store.update(() => s); });
}
