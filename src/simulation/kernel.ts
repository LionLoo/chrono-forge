export const DEFAULT_TICKS_PER_SECOND = 10;

export type SimulationTick = number & { readonly __simulationTick: unique symbol };

export function simulationTick(value: number): SimulationTick {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Simulation ticks must be non-negative safe integers.');
  }

  return value as SimulationTick;
}
