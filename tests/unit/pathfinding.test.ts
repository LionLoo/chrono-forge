import { findLocalPath } from '../../src/simulation/pathfinding';

describe('deterministic local A*', () => {
  it('uses the fixed neighbor and heap ordering for equally short paths', () => {
    const result = findLocalPath({
      width: 3,
      height: 3,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 2 },
      maxExpansions: 20,
    });

    expect(result).toStrictEqual({
      status: 'complete',
      expansions: 4,
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
    });
  });

  it('honors passability and integer movement costs', () => {
    const result = findLocalPath({
      width: 3,
      height: 2,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      maxExpansions: 20,
      isPassable: (x, y) => !(x === 1 && y === 0),
      movementCost: (_fromX, fromY) => (fromY === 1 ? 2 : 1),
    });

    expect(result.status).toBe('complete');
    expect(result.path).toStrictEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ]);
  });

  it('waits to pop the goal so a discovered expensive route cannot beat the optimum', () => {
    const result = findLocalPath({
      width: 3,
      height: 2,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      maxExpansions: 20,
      movementCost: (fromX, fromY, toX, toY) => {
        if (fromX === 0 && fromY === 0 && toX === 1 && toY === 0) return 10;
        if (fromY === 1 && toY === 0) return 100;
        return 1;
      },
    });

    expect(result.status).toBe('complete');
    expect(result.path).toStrictEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('returns safe results for no path, identical start and goal, and exhausted quotas', () => {
    expect(
      findLocalPath({
        width: 2,
        height: 2,
        start: { x: 0, y: 0 },
        goal: { x: 1, y: 1 },
        maxExpansions: 10,
        isPassable: (x, y) => x === 0 && y === 0,
      }),
    ).toStrictEqual({ status: 'no-path', path: [], expansions: 0 });
    expect(
      findLocalPath({
        width: 2,
        height: 2,
        start: { x: 1, y: 1 },
        goal: { x: 1, y: 1 },
        maxExpansions: 0,
      }),
    ).toStrictEqual({ status: 'complete', path: [{ x: 1, y: 1 }], expansions: 0 });
    expect(
      findLocalPath({
        width: 3,
        height: 1,
        start: { x: 0, y: 0 },
        goal: { x: 2, y: 0 },
        maxExpansions: 1,
      }),
    ).toStrictEqual({ status: 'quota-exhausted', path: [], expansions: 1 });
  });

  it.each([
    () =>
      findLocalPath({
        width: 0,
        height: 1,
        start: { x: 0, y: 0 },
        goal: { x: 0, y: 0 },
        maxExpansions: 0,
      }),
    () =>
      findLocalPath({
        width: 1,
        height: 1,
        start: { x: 0, y: 0 },
        goal: { x: 0, y: 0 },
        maxExpansions: -1,
      }),
    () =>
      findLocalPath({
        width: 2,
        height: 1,
        start: { x: 0, y: 0 },
        goal: { x: 1, y: 0 },
        maxExpansions: 2,
        movementCost: () => 0,
      }),
  ])('rejects invalid path inputs', (action) => {
    expect(action).toThrow(RangeError);
  });
});
