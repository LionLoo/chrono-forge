export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

export type PathStatus = 'complete' | 'no-path' | 'quota-exhausted';

export interface LocalPathRequest {
  readonly width: number;
  readonly height: number;
  readonly start: TilePoint;
  readonly goal: TilePoint;
  readonly maxExpansions: number;
  readonly isPassable?: (x: number, y: number) => boolean;
  readonly movementCost?: (fromX: number, fromY: number, toX: number, toY: number) => number;
}

export interface LocalPathResult {
  readonly status: PathStatus;
  readonly path: readonly TilePoint[];
  readonly expansions: number;
}

interface OpenNode {
  readonly nodeId: number;
  readonly f: number;
  readonly h: number;
}

const NEIGHBORS: readonly TilePoint[] = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
}

function assertDimensions(width: number, height: number): void {
  assertSafeInteger(width, 'Grid width');
  assertSafeInteger(height, 'Grid height');
  if (width <= 0 || height <= 0 || width > Math.floor(Number.MAX_SAFE_INTEGER / height)) {
    throw new RangeError('Grid dimensions must define a positive safe tile count.');
  }
}

function assertPoint(point: TilePoint, width: number, height: number, name: string): void {
  assertSafeInteger(point.x, `${name} x`);
  assertSafeInteger(point.y, `${name} y`);
  if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) {
    throw new RangeError(`${name} must be inside the grid.`);
  }
}

function compareOpenNodes(left: OpenNode, right: OpenNode): number {
  return left.f - right.f || left.h - right.h || left.nodeId - right.nodeId;
}

class BinaryHeap {
  private readonly values: OpenNode[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: OpenNode): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentValue = this.values[parent];
      if (parentValue === undefined || compareOpenNodes(parentValue, value) <= 0) {
        break;
      }
      this.values[index] = parentValue;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): OpenNode | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined) {
      return first;
    }
    if (this.values.length === 0) {
      return first;
    }

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let child = left;
      const leftValue = this.values[left];
      const rightValue = this.values[right];
      if (leftValue === undefined) {
        break;
      }
      if (rightValue !== undefined && compareOpenNodes(rightValue, leftValue) < 0) {
        child = right;
      }
      const childValue = this.values[child];
      if (childValue === undefined || compareOpenNodes(last, childValue) <= 0) {
        break;
      }
      this.values[index] = childValue;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function nodeIdFor(point: TilePoint, width: number): number {
  return point.y * width + point.x;
}

function pointFor(nodeId: number, width: number): TilePoint {
  return Object.freeze({ x: nodeId % width, y: Math.floor(nodeId / width) });
}

function manhattan(left: TilePoint, right: TilePoint): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function makeResult(status: PathStatus, path: TilePoint[], expansions: number): LocalPathResult {
  return Object.freeze({ status, path: Object.freeze(path), expansions });
}

function reconstructPath(
  cameFrom: ReadonlyMap<number, number>,
  nodeId: number,
  width: number,
): TilePoint[] {
  const reversed: TilePoint[] = [];
  let current = nodeId;
  while (true) {
    reversed.push(pointFor(current, width));
    const parent = cameFrom.get(current);
    if (parent === undefined) {
      break;
    }
    current = parent;
  }
  return reversed.reverse();
}

/** Deterministic local 4-neighbor A* with a fixed node-expansion quota. */
export function findLocalPath(request: LocalPathRequest): LocalPathResult {
  const { width, height, start, goal, maxExpansions } = request;
  assertDimensions(width, height);
  assertPoint(start, width, height, 'Start');
  assertPoint(goal, width, height, 'Goal');
  assertSafeInteger(maxExpansions, 'Maximum expansions');
  if (maxExpansions < 0) {
    throw new RangeError('Maximum expansions must be non-negative.');
  }

  if (start.x === goal.x && start.y === goal.y) {
    return makeResult('complete', [Object.freeze({ x: start.x, y: start.y })], 0);
  }

  const isPassable = request.isPassable ?? (() => true);
  if (!isPassable(start.x, start.y) || !isPassable(goal.x, goal.y)) {
    return makeResult('no-path', [], 0);
  }

  const startNode = nodeIdFor(start, width);
  const goalNode = nodeIdFor(goal, width);
  const open = new BinaryHeap();
  const gScore = new Map<number, number>([[startNode, 0]]);
  const cameFrom = new Map<number, number>();
  const startHeuristic = manhattan(start, goal);
  open.push({ nodeId: startNode, f: startHeuristic, h: startHeuristic });
  let expansions = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (current === undefined) {
      break;
    }
    const currentG = gScore.get(current.nodeId);
    if (currentG === undefined || current.f !== currentG + current.h) {
      continue;
    }
    if (current.nodeId === goalNode) {
      return makeResult('complete', reconstructPath(cameFrom, current.nodeId, width), expansions);
    }
    if (expansions >= maxExpansions) {
      return makeResult('quota-exhausted', [], expansions);
    }
    const currentPoint = pointFor(current.nodeId, width);
    expansions += 1;

    for (const neighbor of NEIGHBORS) {
      const nextPoint = { x: currentPoint.x + neighbor.x, y: currentPoint.y + neighbor.y };
      if (
        nextPoint.x < 0 ||
        nextPoint.x >= width ||
        nextPoint.y < 0 ||
        nextPoint.y >= height ||
        !isPassable(nextPoint.x, nextPoint.y)
      ) {
        continue;
      }
      const stepCost =
        request.movementCost?.(currentPoint.x, currentPoint.y, nextPoint.x, nextPoint.y) ?? 1;
      assertSafeInteger(stepCost, 'Movement cost');
      if (stepCost <= 0) {
        throw new RangeError('Movement cost must be a positive safe integer.');
      }
      const nextNode = nodeIdFor(nextPoint, width);
      const candidateG = currentG + stepCost;
      assertSafeInteger(candidateG, 'Path cost');
      const knownG = gScore.get(nextNode);
      if (knownG !== undefined && candidateG >= knownG) {
        continue;
      }
      cameFrom.set(nextNode, current.nodeId);
      const heuristic = manhattan(nextPoint, goal);
      assertSafeInteger(candidateG + heuristic, 'Path priority');
      gScore.set(nextNode, candidateG);
      open.push({ nodeId: nextNode, f: candidateG + heuristic, h: heuristic });
    }
  }

  return makeResult('no-path', [], expansions);
}
