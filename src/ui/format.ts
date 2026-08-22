export const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

export function fmtSci(v: number): string {
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / 10 ** e;
  const ms = Number(m.toPrecision(3)).toString();
  return `${ms}e${e >= 0 ? '+' : ''}${e}`;
}

export function fmtTime(s: number): string {
  const base = s < 1000 ? `${Number(s.toPrecision(3))} s` : `${fmtSci(s)} s`;
  if (s >= 86400) return `${base} (${Number((s / 86400).toPrecision(3))} d)`;
  if (s >= 3600) return `${base} (${Number((s / 3600).toPrecision(3))} h)`;
  if (s >= 60) return `${base} (${Number((s / 60).toPrecision(3))} min)`;
  return base;
}
