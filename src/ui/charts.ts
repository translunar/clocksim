import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fmtSci } from './format';
export { PALETTE, fmtSci, fmtTime } from './format';

export interface SeriesDef { label: string; color: string; dash?: number[]; width?: number; band?: boolean }

export class LogLogChart {
  private plot: uPlot | null = null;
  private defs: SeriesDef[] = [];
  private lines: { axis: 'x' | 'y'; v: number; label: string }[] = [];
  private data: uPlot.AlignedData = [[]];
  private bands: [number, number][] = [];

  constructor(private el: HTMLElement, private opts: { xLabel: string; yLabel: string; title?: string }) {
    new ResizeObserver(() => this.plot?.setSize(this.size())).observe(el);
  }
  private size() { return { width: Math.max(300, this.el.clientWidth), height: Math.max(240, Math.round(this.el.clientWidth * 0.55)) }; }

  setSeries(defs: SeriesDef[]): void { this.defs = defs; this.rebuild(); }
  setBands(pairs: [number, number][]): void { this.bands = pairs; this.rebuild(); }
  addHLine(y: number, label: string): void { this.lines.push({ axis: 'y', v: y, label }); this.plot?.redraw(); }
  addVLine(x: number, label: string): void { this.lines.push({ axis: 'x', v: x, label }); this.plot?.redraw(); }
  clearLines(): void { this.lines = []; this.plot?.redraw(); }
  destroy(): void { this.plot?.destroy(); this.plot = null; }

  setData(x: Float64Array, ys: (Float64Array | null)[]): void {
    const clean = (a: Float64Array | null) => a ? Array.from(a, v => (v > 0 && Number.isFinite(v) ? v : null)) : Array.from(x, () => null);
    this.data = [Array.from(x), ...ys.map(clean)] as uPlot.AlignedData;
    if (this.plot) this.plot.setData(this.data); else this.rebuild();
  }

  private rebuild(): void {
    this.plot?.destroy();
    const self = this;
    const o: uPlot.Options = {
      ...this.size(), title: this.opts.title,
      scales: { x: { distr: 3, log: 10 }, y: { distr: 3, log: 10 } },
      axes: [
        { label: this.opts.xLabel, values: (_u, v) => v.map(fmtSci) },
        { label: this.opts.yLabel, values: (_u, v) => v.map(fmtSci), size: 80 },
      ],
      series: [{ label: 't' }, ...this.defs.map(d => ({ label: d.label, stroke: d.color, width: d.width ?? 2, dash: d.dash, fill: d.band ? d.color + '22' : undefined, points: { show: false } }))],
      bands: this.bands.map(([a, b]) => ({ series: [a, b], fill: (this.defs[a - 1]?.color ?? '#888') + '22' })),
      legend: { live: true },
      hooks: {
        draw: [u => {
          const ctx = u.ctx; ctx.save(); ctx.strokeStyle = '#111'; ctx.setLineDash([6, 4]); ctx.font = '12px sans-serif'; ctx.fillStyle = '#111';
          for (const l of self.lines) {
            if (l.axis === 'y') { const py = u.valToPos(l.v, 'y', true); ctx.beginPath(); ctx.moveTo(u.bbox.left, py); ctx.lineTo(u.bbox.left + u.bbox.width, py); ctx.stroke(); ctx.fillText(l.label, u.bbox.left + 6, py - 4); }
            else { const px = u.valToPos(l.v, 'x', true); ctx.beginPath(); ctx.moveTo(px, u.bbox.top); ctx.lineTo(px, u.bbox.top + u.bbox.height); ctx.stroke(); ctx.fillText(l.label, px + 4, u.bbox.top + 14); }
          }
          ctx.restore();
        }],
      },
    };
    this.plot = new uPlot(o, this.data, this.el);
  }
}
