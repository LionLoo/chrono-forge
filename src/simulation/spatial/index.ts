export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface SpatialEntry extends GridPoint {
  readonly id: number;
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
}

function assertEntityId(id: number): void {
  assertSafeInteger(id, 'Entity id');
  if (id < 0) {
    throw new RangeError('Entity id must be non-negative.');
  }
}

function assertPoint(point: GridPoint): void {
  assertSafeInteger(point.x, 'Coordinate x');
  assertSafeInteger(point.y, 'Coordinate y');
}

function keyFor(x: number, y: number): string {
  return `${x},${y}`;
}

function compareEntityIds(left: number, right: number): number {
  return left - right;
}

/**
 * A deterministic, mutable lookup index for dynamic entities. It is not
 * authoritative state: callers retain the source-of-truth positions.
 */
export class DeterministicSpatialGrid {
  readonly cellSize: number;

  private readonly entries = new Map<number, SpatialEntry>();
  private readonly cells = new Map<string, Set<number>>();

  constructor(cellSize: number) {
    assertSafeInteger(cellSize, 'Cell size');
    if (cellSize <= 0) {
      throw new RangeError('Cell size must be positive.');
    }
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.entries.size;
  }

  set(id: number, point: GridPoint): void {
    assertEntityId(id);
    assertPoint(point);

    const previous = this.entries.get(id);
    if (previous !== undefined) {
      this.removeFromCell(previous);
    }

    const entry: SpatialEntry = Object.freeze({ id, x: point.x, y: point.y });
    this.entries.set(id, entry);
    const key = this.cellKey(entry);
    let cell = this.cells.get(key);
    if (cell === undefined) {
      cell = new Set<number>();
      this.cells.set(key, cell);
    }
    cell.add(id);
  }

  delete(id: number): boolean {
    assertEntityId(id);
    const existing = this.entries.get(id);
    if (existing === undefined) {
      return false;
    }
    this.removeFromCell(existing);
    this.entries.delete(id);
    return true;
  }

  get(id: number): SpatialEntry | undefined {
    assertEntityId(id);
    return this.entries.get(id);
  }

  /** Returns matching entries in ascending stable entity-id order. */
  queryRadius(center: GridPoint, radius: number): readonly SpatialEntry[] {
    assertPoint(center);
    assertSafeInteger(radius, 'Radius');
    if (radius < 0) {
      throw new RangeError('Radius must be non-negative.');
    }

    const minimumX = center.x - radius;
    const maximumX = center.x + radius;
    const minimumY = center.y - radius;
    const maximumY = center.y + radius;
    const radiusSquared = radius * radius;
    assertSafeInteger(minimumX, 'Radius minimum x');
    assertSafeInteger(maximumX, 'Radius maximum x');
    assertSafeInteger(minimumY, 'Radius minimum y');
    assertSafeInteger(maximumY, 'Radius maximum y');
    assertSafeInteger(radiusSquared, 'Radius squared');
    const minimumCellX = this.cellCoordinate(minimumX);
    const maximumCellX = this.cellCoordinate(maximumX);
    const minimumCellY = this.cellCoordinate(minimumY);
    const maximumCellY = this.cellCoordinate(maximumY);
    const results: SpatialEntry[] = [];

    for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
      for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
        const cell = this.cells.get(keyFor(cellX, cellY));
        if (cell === undefined) {
          continue;
        }
        for (const id of cell) {
          const entry = this.entries.get(id);
          if (entry === undefined) {
            continue;
          }
          const deltaX = entry.x - center.x;
          const deltaY = entry.y - center.y;
          if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
            results.push(entry);
          }
        }
      }
    }

    results.sort((left, right) => compareEntityIds(left.id, right.id));
    return Object.freeze(results);
  }

  private cellKey(point: GridPoint): string {
    return keyFor(this.cellCoordinate(point.x), this.cellCoordinate(point.y));
  }

  private cellCoordinate(coordinate: number): number {
    return Math.floor(coordinate / this.cellSize);
  }

  private removeFromCell(entry: SpatialEntry): void {
    const key = this.cellKey(entry);
    const cell = this.cells.get(key);
    if (cell === undefined) {
      throw new Error('Spatial grid invariant failed: entry cell was missing.');
    }
    cell.delete(entry.id);
    if (cell.size === 0) {
      this.cells.delete(key);
    }
  }
}
