import { steadyStateVsCadence } from '../../engine/models';
import { benchToSpec, effectiveTm, type BenchDevice, type Requirement, type Scenario } from '../state';
import type { Domain } from '../../engine/units';

export function cadenceGrid(lo = 0.01, hi = 1e4): Float64Array {
  const out: number[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) out.push(lo * Math.pow(hi / lo, i / n));
  return Float64Array.from(out);
}

export interface KneeCurve { id: string; name: string; sigma: Float64Array; slowestCadence: number | null }

export function computeKnee(devices: BenchDevice[], scenario: Scenario, dom: Domain, req: Requirement | null, grid: Float64Array): KneeCurve[] {
  const ds = scenario.byDomain[dom];
  return devices.filter(d => d.domain !== 'accel').map(d => {
    const sigma = steadyStateVsCadence(benchToSpec(d), { sigma: ds.fix.sigma, bias: ds.fix.bias }, effectiveTm(scenario, dom), grid);
    let slowest: number | null = null;
    if (req) for (let i = 0; i < grid.length; i++) if (sigma[i]! * req.sigma <= req.value) slowest = grid[i]!;
    return { id: d.id, name: d.name, sigma, slowestCadence: slowest };
  });
}
