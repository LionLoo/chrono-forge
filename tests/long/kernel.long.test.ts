import { simulationTick } from '../../src/simulation/kernel';

describe('accelerated kernel foundation', () => {
  it('advances one million logical ticks without invalid state', () => {
    let lastTick = simulationTick(0);
    for (let tick = 1; tick <= 1_000_000; tick += 1) {
      lastTick = simulationTick(tick);
    }

    expect(lastTick).toBe(1_000_000);
  });
});
