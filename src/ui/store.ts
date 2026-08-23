import { type AppState, type View, defaultState, isBenchDevice, sanitizeScenario } from './state';

const VALID_VIEWS = new Set<View>(['devices', 'adev', 'growth', 'sizing', 'compare']);

export class Store {
  private listeners = new Set<(s: AppState) => void>();
  constructor(private state: AppState) {}
  get(): AppState { return this.state; }
  set(patch: Partial<AppState>): void { this.update(s => ({ ...s, ...patch })); }
  update(fn: (s: AppState) => AppState): void { this.state = fn(this.state); for (const l of this.listeners) l(this.state); }
  subscribe(fn: (s: AppState) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

const b64 = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};

export function toHash(s: AppState): string { return b64.enc(JSON.stringify(s)); }

export function fromHash(h: string): AppState | null {
  try {
    const raw = JSON.parse(b64.dec(h)) as Partial<AppState>;
    if (!raw || !Array.isArray(raw.bench) || !raw.bench.every(isBenchDevice) || !raw.scenario) return null;
    const d = defaultState();
    const bench = raw.bench;
    const scenario = sanitizeScenario(raw.scenario, d.scenario);
    const view: View = typeof raw.view === 'string' && VALID_VIEWS.has(raw.view as View) ? (raw.view as View) : 'adev';
    const selected =
      typeof raw.selected === 'string' && bench.some(b => b.id === raw.selected) ? raw.selected : (bench[0]?.id ?? null);
    return { bench, selected, scenario, view };
  } catch { return null; }
}
