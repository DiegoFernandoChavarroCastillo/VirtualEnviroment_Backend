/**
 * ObjectPool — Generic object pool to eliminate per-frame heap allocations.
 *
 * Instead of `new Object()` every frame, objects are acquired from the pool
 * and released back when no longer needed. This prevents GC pauses that
 * cause jank / long tasks on the main thread.
 */

export class ObjectPool<T> {
  private readonly pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (obj: T) => void;

  /**
   * @param factory  Creates a new instance when the pool is empty
   * @param reset    Resets an instance to a clean state before reuse
   * @param initialSize  Pre-allocate this many objects
   */
  constructor(factory: () => T, reset: (obj: T) => void, initialSize = 0) {
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  /** Acquire an object from the pool (or create a new one). */
  acquire(): T {
    if (this.pool.length > 0) {
      const obj = this.pool.pop()!;
      this.reset(obj);
      return obj;
    }
    return this.factory();
  }

  /** Release an object back to the pool for reuse. */
  release(obj: T): void {
    this.pool.push(obj);
  }

  /** Release multiple objects at once. */
  releaseAll(objs: T[]): void {
    for (let i = 0, len = objs.length; i < len; i++) {
      this.pool.push(objs[i]);
    }
  }

  /** Current pool size (available objects). */
  get available(): number {
    return this.pool.length;
  }
}

// ─── Projectile Pool ────────────────────────────────────────────────────────

import { Projectile } from '../../domain/entities/shooter-arena.types';

/** Mutable projectile for pool usage — id gets overwritten on acquire. */
export interface PooledProjectile extends Projectile {
  /** Whether this projectile is active (in-use) */
  active: boolean;
}

// Increased to 96 to handle shotgun triple-shots without heap allocations
const PROJECTILE_POOL_SIZE = 96;

export const projectilePool = new ObjectPool<PooledProjectile>(
  () => ({
    id: '',
    ownerId: '',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    weaponType: 'normal',
    active: false,
  }),
  (p) => {
    p.id = '';
    p.ownerId = '';
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.weaponType = 'normal';
    p.active = false;
  },
  PROJECTILE_POOL_SIZE,
);

// ─── Vec2 Pool (for collision results) ──────────────────────────────────────

import { Vec2 } from '../../domain/entities/shooter-arena.types';

const VEC2_POOL_SIZE = 32;

export const vec2Pool = new ObjectPool<Vec2>(
  () => ({ x: 0, y: 0 }),
  (v) => { v.x = 0; v.y = 0; },
  VEC2_POOL_SIZE,
);
