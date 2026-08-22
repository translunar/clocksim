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

export function numInput(label: string, value: number, onChange: (v: number) => void, opts: { step?: number; min?: number; term?: string; unit?: string } = {}): HTMLElement {
  const input = h('input', { type: 'number', value: String(value), step: opts.step ?? 'any', min: opts.min, on: { change: e => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) onChange(v); } } });
  return h('label', {}, opts.term ? dfn(opts.term, label) : label, opts.unit ? ` [${opts.unit}]` : '', input);
}

export function select(label: string, options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLElement {
  const sel = h('select', { on: { change: e => onChange((e.target as HTMLSelectElement).value) } }, ...options.map(o => h('option', { value: o.value, selected: o.value === value ? 'selected' : undefined }, o.label)));
  return h('label', {}, label, sel);
}
