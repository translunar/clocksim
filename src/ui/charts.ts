import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fmtSci, alignSeries } from './format';
export { PALETTE, fmtSci, fmtTime, alignSeries } from './format';

export interface SeriesDef { label: string; color: string; dash?: number[]; width?: number; band?: boolean }

export class LogLogChart {
  private plot: uPlot | null = null;
  private defs: SeriesDef[] = [];
  private lines: { axis: 'x' | 'y'; v: number; label: string; color: string }[] = [];
  private data: uPlot.AlignedData = [[]];
  private bands: [number, number][] = [];
  private ghosts: { x: Float64Array; ys: Float64Array[]; color: string } | null = null;
  private ro: ResizeObserver;

  constructor(private el: HTMLElement, private opts: { xLabel: string; yLabel: string; title?: string }) {
    this.ro = new ResizeObserver(() => this.plot?.setSize(this.size()));
    this.ro.observe(el);
  }
  private size() { return { width: Math.max(300, this.el.clientWidth), height: Math.max(240, Math.round(this.el.clientWidth * 0.55)) }; }

  // Rebuilding destroys and recreates the uPlot instance (loses zoom/cursor state, reallocates
  // canvases), so only do it when the new value actually differs from what's already applied —
  // the growth view calls setSeries on every Monte Carlo progress batch with an unchanged defs array.
  setSeries(defs: SeriesDef[]): void {
    if (JSON.stringify(defs) === JSON.stringify(this.defs)) return;
    this.defs = defs;
    this.rebuild();
  }
  setBands(pairs: [number, number][]): void {
    if (JSON.stringify(pairs) === JSON.stringify(this.bands)) return;
    this.bands = pairs;
    this.rebuild();
  }
  /** Faint overlay trajectories (MC spaghetti) drawn in the draw hook — no series, no legend. */
  setGhosts(x: Float64Array, ys: Float64Array[], color: string): void {
    this.ghosts = ys.length ? { x, ys, color } : null;
    this.scheduleRepaint();
  }
  addHLine(y: number, label: string, color = '#e2564a'): void { this.lines.push({ axis: 'y', v: y, label, color }); this.scheduleRepaint(); }
  addVLine(x: number, label: string, color = '#8a7fa8'): void { this.lines.push({ axis: 'x', v: x, label, color }); this.scheduleRepaint(); }
  clearLines(): void { this.lines = []; this.scheduleRepaint(); }

  // uPlot defers the scale/commit work of setData(); a synchronous redraw() right after it rebuilds
  // the series paths against unset scales and leaves the chart blank. Coalesce line changes into one
  // repaint-only redraw on the next frame, after uPlot's own commit has run.
  private repaintQueued = false;
  private scheduleRepaint(): void {
    if (this.repaintQueued) return;
    this.repaintQueued = true;
    requestAnimationFrame(() => { this.repaintQueued = false; this.plot?.redraw(false); });
  }
  destroy(): void { this.plot?.destroy(); this.plot = null; this.ghosts = null; this.ro.disconnect(); }

  /**
   * `resetScales` defaults to uPlot's own default (true): a new scenario should re-autoscale.
   * Pass false for a repeated draw of the *same* scenario — the Monte Carlo progress ticks —
   * because re-autoscaling silently throws away any drag-zoom the user applied mid-run.
   */
  setData(x: Float64Array, ys: (Float64Array | null)[], opts: { resetScales?: boolean } = {}): void {
    const clean = (a: Float64Array | null) => a ? Array.from(a, v => (v > 0 && Number.isFinite(v) ? v : null)) : Array.from(x, () => null);
    const xs = Array.from(x);
    this.data = [xs, ...alignSeries(xs, ys.map(clean), this.defs.length)] as uPlot.AlignedData;
    if (this.plot) this.plot.setData(this.data, opts.resetScales ?? true); else this.rebuild();
  }

  private rebuild(): void {
    this.plot?.destroy();
    // Defensive: setSeries/setBands can change `defs.length` without a following setData call
    // (e.g. before the first setData, or if a caller reorders calls), so re-align here too —
    // this is the same guard as setData, applied to whatever data is currently held.
    const xs = (this.data[0] ?? []) as number[];
    const ys = this.data.slice(1) as (number | null)[][];
    this.data = [xs, ...alignSeries(xs, ys, this.defs.length)] as uPlot.AlignedData;
    const self = this;
    const o: uPlot.Options = {
      ...this.size(), title: this.opts.title,
      scales: { x: { time: false, distr: 3, log: 10 }, y: { distr: 3, log: 10 } },
      axes: [
        { label: this.opts.xLabel, values: (_u, v) => v.map(fmtSci), stroke: '#8a7fa8', grid: { stroke: '#2a2040' }, ticks: { stroke: '#2a2040' } },
        { label: this.opts.yLabel, values: (_u, v) => v.map(fmtSci), size: 80, stroke: '#8a7fa8', grid: { stroke: '#2a2040' }, ticks: { stroke: '#2a2040' } },
      ],
      series: [{ label: 't' }, ...this.defs.map(d => ({ label: d.label, stroke: d.color, width: d.width ?? 2, dash: d.dash, fill: undefined /* band series get their lo→hi fill from the `bands` option; a per-series fill paints to the axis */, points: { show: false } }))],
      bands: this.bands.map(([a, b]) => ({ series: [a, b], fill: (this.defs[a - 1]?.color ?? '#888') + '22' })),
      legend: { live: true },
      hooks: {
        // drawAxes fires after the axes/grid and *before* drawSeries, so the ghost trajectories land
        // underneath the band fill, the median and the envelope (§9.7: spaghetti behind the band).
        // The `draw` hook below runs after the series, which is where the annotation lines belong.
        drawAxes: [u => {
          if (!self.ghosts) return;
          const ctx = u.ctx;
          ctx.save(); ctx.strokeStyle = self.ghosts.color; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
          for (const t of self.ghosts.ys) {
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < self.ghosts.x.length; i++) {
              const yv = t[i]!;
              if (!(yv > 0) || !Number.isFinite(yv)) { started = false; continue; }  // log scale: skip ≤0 (|error| dips at zero crossings)
              const px = u.valToPos(self.ghosts.x[i]!, 'x', true), py = u.valToPos(yv, 'y', true);
              if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
            }
            ctx.stroke();
          }
          ctx.restore();
        }],
        draw: [u => {
          const ctx = u.ctx;
          ctx.save(); ctx.setLineDash([6, 4]); ctx.font = '11px "Space Mono", monospace';
          for (const l of self.lines) {
            ctx.strokeStyle = l.color; ctx.fillStyle = l.color;
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
