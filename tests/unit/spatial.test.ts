import { DeterministicSpatialGrid } from '../../src/simulation/spatial';

describe('deterministic spatial grid', () => {
  it('returns radius matches in ascending entity id regardless of insertion order', () => {
    const grid = new DeterministicSpatialGrid(4);
    grid.set(9, { x: 1, y: 1 });
    grid.set(2, { x: -1, y: 0 });
    grid.set(7, { x: 3, y: 4 });
    grid.set(4, { x: 6, y: 0 });

    expect(grid.queryRadius({ x: 0, y: 0 }, 5)).toStrictEqual([
      { id: 2, x: -1, y: 0 },
      { id: 7, x: 3, y: 4 },
      { id: 9, x: 1, y: 1 },
    ]);
  });

  it('updates and removes entities without retaining stale cell entries', () => {
    const grid = new DeterministicSpatialGrid(2);
    grid.set(1, { x: 0, y: 0 });
    grid.set(1, { x: 10, y: 10 });

    expect(grid.queryRadius({ x: 0, y: 0 }, 1)).toStrictEqual([]);
    expect(grid.delete(1)).toBe(true);
    expect(grid.delete(1)).toBe(false);
    expect(grid.size).toBe(0);
  });

  it.each([
    () => new DeterministicSpatialGrid(0),
    () => new DeterministicSpatialGrid(0.5),
    () => new DeterministicSpatialGrid(1).set(-1, { x: 0, y: 0 }),
    () => new DeterministicSpatialGrid(1).set(1, { x: 0.5, y: 0 }),
    () => new DeterministicSpatialGrid(1).queryRadius({ x: 0, y: 0 }, -1),
  ])('rejects invalid integer grid inputs', (action) => {
    expect(action).toThrow(RangeError);
  });
});
