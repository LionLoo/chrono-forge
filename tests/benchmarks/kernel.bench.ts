import { bench, describe } from 'vitest';
import { simulationTick } from '../../src/simulation/kernel';

describe('kernel foundation', () => {
  bench('validate sequential logical ticks', () => {
    for (let tick = 0; tick < 10_000; tick += 1) {
      simulationTick(tick);
    }
  });
});
