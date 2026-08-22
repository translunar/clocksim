import { steadyStateVsCadence } from '../../engine/models';
import { benchToSpec, effectiveTm, type BenchDevice, type Requirement, type Scenario } from '../state';

export function cadenceGrid(): Float64Array {
  const out: number[] = [];
  for (let e = -2 * 8; e <= 4 * 8; e++) out.push(Math.pow(10, e / 8));
  return Float64Array.from(out);
}

export interface KneeCurve { id: string; name: string; sigma: Float64Array; slowestCadence: number | null }

export function computeKnee(devices: BenchDevice[], scenario: Scenario, req: Requirement | null): KneeCurve[] {
  const grid = cadenceGrid();
  return devices.filter(d => d.domain !== 'accel').map(d => {
    const sigma = steadyStateVsCadence(benchToSpec(d), { sigma: scenario.fix.sigma, bias: scenario.fix.bias }, effectiveTm(scenario), grid);
    let slowest: number | null = null;
    if (req) for (let i = 0; i < grid.length; i++) if (sigma[i]! * req.sigma <= req.value) slowest = grid[i]!;
    return { id: d.id, name: d.name, sigma, slowestCadence: slowest };
  });
}
