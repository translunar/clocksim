import { dfn } from './glossary';

type Attrs = Record<string, unknown> & { on?: Record<string, (e: Event) => void>; class?: string };

export function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on' && v) for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className = String(v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

/**
 * Deterministic, slug-safe key for a control, built from panel/field name parts
 * (e.g. ['scenario', 'duration'] -> 'scenario:duration'). Used as the data-key
 * attribute so mountSidebar can restore focus and re-associate controls across
 * full re-renders.
 */
export function controlKey(parts: string[]): string {
  return parts
    .map(p => String(p).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x')
    .join(':');
}

export function numInput(label: string, value: number, onChange: (v: number) => void, opts: { step?: number; min?: number; term?: string; unit?: string; key?: string } = {}): HTMLElement {
  const input = h('input', { type: 'number', value: String(value), step: opts.step ?? 'any', min: opts.min, 'data-key': opts.key, on: { change: e => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) onChange(v); } } });
  return h('label', {}, opts.term ? dfn(opts.term, label) : label, opts.unit ? ` [${opts.unit}]` : '', input);
}

export function select(label: string | Node, options: { value: string; label: string }[], value: string, onChange: (v: string) => void, opts: { key?: string } = {}): HTMLElement {
  const sel = h('select', { 'data-key': opts.key, on: { change: e => onChange((e.target as HTMLSelectElement).value) } }, ...options.map(o => h('option', { value: o.value, selected: o.value === value ? 'selected' : undefined }, o.label)));
  return h('label', {}, label, sel);
}

/**
 * Collapsible `▸` section. Views re-render by replacing children wholesale, which would
 * collapse a native <details> every time — so open state is remembered per `key` in a
 * module-level map and re-applied on rebuild.
 */
const expanderOpen = new Map<string, boolean>();
export function expander(key: string, summary: string, ...children: (Node | string | null | undefined)[]): HTMLElement {
  return h('details', {
    class: 'exp', 'data-key': key, open: expanderOpen.get(key) ? 'open' : undefined,
    on: { toggle: e => expanderOpen.set(key, (e.target as HTMLDetailsElement).open) },
  }, h('summary', {}, summary), ...children);
}

export function segmented(options: { value: string; label: string }[], value: string, onChange: (v: string) => void, opts: { key?: string } = {}): HTMLElement {
  return h('div', { class: 'seg', 'data-key': opts.key, role: 'group' },
    ...options.map(o => h('button', { class: o.value === value ? 'active' : '', on: { click: () => { if (o.value !== value) onChange(o.value); } } }, o.label)));
}
