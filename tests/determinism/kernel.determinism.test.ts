import { simulationTick } from '../../src/simulation/kernel';

function produceTickSequence(length: number): number[] {
  return Array.from({ length }, (_, index) => simulationTick(index));
}

describe('kernel determinism foundation', () => {
  it('repeats identical logical tick sequences for identical input', () => {
    expect(produceTickSequence(10_000)).toStrictEqual(produceTickSequence(10_000));
  });
});
