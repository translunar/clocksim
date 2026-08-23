import { steadyStateVsCadence } from '../../engine/models';
import { benchToSpec, effectiveTm, type BenchDevice, type Requirement, type Scenario } from '../state';
import type { Domain } from '../../engine/units';

function buildCadenceGrid(): Float64Array {
  const out: number[] = [];
  for (let e = -2 * 8; e <= 4 * 8; e++) out.push(Math.pow(10, e / 8));
  return Float64Array.from(out);
}

const CADENCE_GRID = buildCadenceGrid();

export function cadenceGrid(): Float64Array {
  return CADENCE_GRID;
}

export interface KneeCurve { id: string; name: string; sigma: Float64Array; slowestCadence: number | null }

export function computeKnee(devices: BenchDevice[], scenario: Scenario, dom: Domain, req: Requirement | null): KneeCurve[] {
  const grid = CADENCE_GRID;
  const ds = scenario.byDomain[dom];
  return devices.filter(d => d.domain !== 'accel').map(d => {
    const sigma = steadyStateVsCadence(benchToSpec(d), { sigma: ds.fix.sigma, bias: ds.fix.bias }, effectiveTm(scenario, dom), grid);
    let slowest: number | null = null;
    if (req) for (let i = 0; i < grid.length; i++) if (sigma[i]! * req.sigma <= req.value) slowest = grid[i]!;
    return { id: d.id, name: d.name, sigma, slowestCadence: slowest };
  });
}
