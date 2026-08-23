export const PALETTE = ['#c9a0dc', '#ffc24a', '#7bd88f', '#6cc7e8', '#f4a7c0', '#b8b0ff', '#e8a06c', '#98a2b3'];

export function fmtSci(v: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''; // uPlot passes null for unlabeled log ticks
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / 10 ** e;
  const ms = Number(m.toPrecision(3)).toString();
  return `${ms}e${e >= 0 ? '+' : ''}${e}`;
}

/**
 * Pad or truncate a list of y-series to exactly `count` arrays so a chart's data always matches
 * its series definitions. Missing series are filled with an array of `null` the length of `x`
 * (uPlot renders `null` as a gap); extra series are dropped. Existing arrays are passed through
 * unchanged. Without this, handing uPlot fewer y-arrays than configured series throws inside
 * uPlot's internals (accScale reads `data[i].length` for every series).
 */
export function alignSeries(x: number[], ys: (number | null)[][], count: number): (number | null)[][] {
  const out = ys.slice(0, count);
  while (out.length < count) out.push(x.map(() => null));
  return out;
}

export function fmtTime(s: number): string {
  const base = s < 1000 ? `${Number(s.toPrecision(3))} s` : `${fmtSci(s)} s`;
  if (s >= 86400) return `${base} (${Number((s / 86400).toPrecision(3))} d)`;
  if (s >= 3600) return `${base} (${Number((s / 3600).toPrecision(3))} h)`;
  if (s >= 60) return `${base} (${Number((s / 60).toPrecision(3))} min)`;
  return base;
}
