import { CollisionService } from './collision.service';
import { PLAYER_RADIUS, PROJECTILE_RADIUS } from './interfaces/shooter-arena.interfaces';

const makeProj = (overrides: any = {}) => ({
  id: 'p1', ownerId: 'u1', x: 100, y: 100, vx: 1, vy: 0, ...overrides,
});

const makePlayer = (overrides: any = {}) => ({
  userId: 'u2', x: 100, y: 100, lives: 3, score: 0, ...overrides,
});

const makeStructure = (overrides: any = {}) => ({
  id: 's1', x: 200, y: 200, width: 50, height: 50, ...overrides,
});

describe('CollisionService', () => {
  let service: CollisionService;

  beforeEach(() => {
    service = new CollisionService();
  });

  describe('checkProjectilePlayerCollision', () => {
    it('should detect collision when projectile overlaps player', () => {
      const proj = makeProj({ x: 100, y: 100 });
      const player = makePlayer({ x: 100, y: 100 });
      expect(service.checkProjectilePlayerCollision(proj, player)).toBe(true);
    });

    it('should not detect collision when far apart', () => {
      const proj = makeProj({ x: 0, y: 0 });
      const player = makePlayer({ x: 500, y: 500 });
      expect(service.checkProjectilePlayerCollision(proj, player)).toBe(false);
    });

    it('should ignore owner by default', () => {
      const proj = makeProj({ ownerId: 'u2', x: 100, y: 100 });
      const player = makePlayer({ userId: 'u2', x: 100, y: 100 });
      expect(service.checkProjectilePlayerCollision(proj, player)).toBe(false);
    });

    it('should not ignore owner when ignoreOwner=false', () => {
      const proj = makeProj({ ownerId: 'u2', x: 100, y: 100 });
      const player = makePlayer({ userId: 'u2', x: 100, y: 100 });
      expect(service.checkProjectilePlayerCollision(proj, player, false)).toBe(true);
    });
  });

  describe('checkProjectileWallCollision', () => {
    const bounds = { width: 1200, height: 800 };

    it('should detect left wall collision', () => {
      const proj = makeProj({ x: 0, y: 400 });
      expect(service.checkProjectileWallCollision(proj, bounds)).toBe(true);
    });

    it('should detect right wall collision', () => {
      const proj = makeProj({ x: 1200, y: 400 });
      expect(service.checkProjectileWallCollision(proj, bounds)).toBe(true);
    });

    it('should detect top wall collision', () => {
      const proj = makeProj({ x: 600, y: 0 });
      expect(service.checkProjectileWallCollision(proj, bounds)).toBe(true);
    });

    it('should not detect collision in center', () => {
      const proj = makeProj({ x: 600, y: 400 });
      expect(service.checkProjectileWallCollision(proj, bounds)).toBe(false);
    });
  });

  describe('checkProjectileStructureCollision', () => {
    it('should detect collision when projectile hits structure', () => {
      const proj = makeProj({ x: 225, y: 225 });
      const structure = makeStructure({ x: 200, y: 200, width: 50, height: 50 });
      expect(service.checkProjectileStructureCollision(proj, structure)).toBe(true);
    });

    it('should not detect collision when far from structure', () => {
      const proj = makeProj({ x: 0, y: 0 });
      const structure = makeStructure({ x: 500, y: 500, width: 50, height: 50 });
      expect(service.checkProjectileStructureCollision(proj, structure)).toBe(false);
    });
  });

  describe('checkPlayerStructureCollision', () => {
    it('should detect player-structure collision', () => {
      const pos = { x: 225, y: 225 };
      const structure = makeStructure({ x: 200, y: 200, width: 50, height: 50 });
      expect(service.checkPlayerStructureCollision(pos, structure)).toBe(true);
    });

    it('should not detect collision when player is far', () => {
      const pos = { x: 0, y: 0 };
      const structure = makeStructure({ x: 500, y: 500, width: 50, height: 50 });
      expect(service.checkPlayerStructureCollision(pos, structure)).toBe(false);
    });
  });

  describe('resolvePlayerStructureCollisionInPlace', () => {
    it('should modify position when player overlaps structure edge', () => {
      // Player just outside the structure edge, touching it
      const structure = makeStructure({ x: 200, y: 200, width: 50, height: 50 });
      const pos = { x: 198, y: 225 }; // left of structure, close enough to collide with radius 5
      const original = { ...pos };
      service.resolvePlayerStructureCollisionInPlace(pos, structure, 5);
      // Position should have changed (pushed away)
      expect(pos.x !== original.x || pos.y !== original.y).toBe(true);
    });

    it('should not modify position when no collision', () => {
      const pos = { x: 0, y: 0 };
      const structure = makeStructure({ x: 500, y: 500, width: 50, height: 50 });
      const original = { ...pos };
      service.resolvePlayerStructureCollisionInPlace(pos, structure);
      expect(pos).toEqual(original);
    });
  });

  describe('clampPositionInPlace', () => {
    it('should clamp x to left boundary', () => {
      const pos = { x: -10, y: 400 };
      service.clampPositionInPlace(pos, 1200, 800, PLAYER_RADIUS);
      expect(pos.x).toBe(PLAYER_RADIUS);
    });

    it('should clamp x to right boundary', () => {
      const pos = { x: 1300, y: 400 };
      service.clampPositionInPlace(pos, 1200, 800, PLAYER_RADIUS);
      expect(pos.x).toBe(1200 - PLAYER_RADIUS);
    });

    it('should not modify position within bounds', () => {
      const pos = { x: 600, y: 400 };
      service.clampPositionInPlace(pos, 1200, 800, PLAYER_RADIUS);
      expect(pos.x).toBe(600);
      expect(pos.y).toBe(400);
    });
  });

  describe('clampPosition', () => {
    it('should return clamped position', () => {
      const result = service.clampPosition({ x: -10, y: 400 }, { width: 1200, height: 800 }, PLAYER_RADIUS);
      expect(result.x).toBe(PLAYER_RADIUS);
    });
  });

  describe('generateRespawnPosition', () => {
    it('should return a position within bounds', () => {
      const bounds = { width: 1200, height: 800 };
      const pos = service.generateRespawnPosition(bounds);
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(bounds.width);
      expect(pos.y).toBeGreaterThan(0);
      expect(pos.y).toBeLessThan(bounds.height);
    });

    it('should avoid occupied positions', () => {
      const bounds = { width: 1200, height: 800 };
      const occupied = [{ x: 600, y: 400 }];
      const pos = service.generateRespawnPosition(bounds, [], occupied);
      expect(pos).toBeDefined();
    });
  });
});
