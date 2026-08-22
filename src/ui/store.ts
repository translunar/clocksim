import { type AppState, defaultState, isBenchDevice } from './state';

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
    return { bench: raw.bench, selected: raw.selected ?? raw.bench[0]?.id ?? null, scenario: { ...d.scenario, ...raw.scenario }, view: raw.view ?? 'adev' };
  } catch { return null; }
}
