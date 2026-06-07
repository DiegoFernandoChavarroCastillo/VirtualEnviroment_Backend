/**
 * SpatialHashGrid — Spatial partitioning for O(1) broad-phase collision queries.
 *
 * Replaces naive O(n²) loops with cell-based lookups. Each entity is inserted
 * into one or more cells based on its position + radius. Queries return only
 * entities sharing cells with the query region.
 *
 * Cell size should be >= the largest entity diameter for optimal performance.
 */

export interface SpatialEntity {
  /** Unique key for deduplication in query results */
  id: string;
  x: number;
  y: number;
}

export class SpatialHashGrid<T extends SpatialEntity> {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells: Map<string, T[]> = new Map();

  /** Pre-allocated key buffer to avoid string concatenation in hot path */
  private keyBuf = '';

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  /** Remove all entities. Reuses cell arrays via length = 0 instead of deleting. */
  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
    }
  }

  /** Insert an entity (point + radius) into the grid. */
  insert(entity: T, radius: number): void {
    const minCX = Math.floor((entity.x - radius) * this.invCellSize);
    const maxCX = Math.floor((entity.x + radius) * this.invCellSize);
    const minCY = Math.floor((entity.y - radius) * this.invCellSize);
    const maxCY = Math.floor((entity.y + radius) * this.invCellSize);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        this.keyBuf = `${cx}:${cy}`;
        let cell = this.cells.get(this.keyBuf);
        if (!cell) {
          cell = [];
          this.cells.set(this.keyBuf, cell);
        }
        cell.push(entity);
      }
    }
  }

  /**
   * Query all entities that may overlap with the given circle.
   * Results may contain duplicates when entities span multiple cells;
   * use the provided Set for dedup if needed.
   *
   * @param x       Query center X
   * @param y       Query center Y
   * @param radius  Query radius
   * @param out     Output array (will be cleared and filled)
   * @param seen    Dedup set (will be cleared and used)
   */
  query(x: number, y: number, radius: number, out: T[], seen: Set<string>): void {
    out.length = 0;
    seen.clear();

    const minCX = Math.floor((x - radius) * this.invCellSize);
    const maxCX = Math.floor((x + radius) * this.invCellSize);
    const minCY = Math.floor((y - radius) * this.invCellSize);
    const maxCY = Math.floor((y + radius) * this.invCellSize);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        this.keyBuf = `${cx}:${cy}`;
        const cell = this.cells.get(this.keyBuf);
        if (!cell) continue;
        for (let i = 0, len = cell.length; i < len; i++) {
          const e = cell[i];
          if (!seen.has(e.id)) {
            seen.add(e.id);
            out.push(e);
          }
        }
      }
    }
  }
}
