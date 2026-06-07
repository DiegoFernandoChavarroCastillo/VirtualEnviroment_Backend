import { Injectable } from '@nestjs/common';
import {
  Vec2,
  Projectile,
  ShooterPlayerState,
  CoverStructure,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
} from '../../domain/entities/shooter-arena.types';

/**
 * CollisionService — lógica pura de colisiones, sin I/O ni efectos secundarios.
 *
 * OPTIMIZADO: Todos los métodos mutan un `out` parámetro en lugar de crear
 * objetos nuevos. Esto elimina allocaciones en cada frame y reduce la presión
 * sobre el garbage collector (principal causa de "Long Tasks" >50ms).
 */
@Injectable()
export class CollisionService {
  /**
   * Detecta colisión círculo-círculo entre un proyectil y un jugador.
   */
  checkProjectilePlayerCollision(
    proj: Projectile,
    player: ShooterPlayerState,
    ignoreOwner = true,
  ): boolean {
    if (ignoreOwner && proj.ownerId === player.userId) return false;

    const dx = proj.x - player.x;
    const dy = proj.y - player.y;
    const distSq = dx * dx + dy * dy;
    const radiusSum = PROJECTILE_RADIUS + PLAYER_RADIUS;

    return distSq <= radiusSum * radiusSum;
  }

  /**
   * Detecta si un proyectil ha alcanzado o superado los bordes del mapa.
   */
  checkProjectileWallCollision(
    proj: Projectile,
    bounds: { width: number; height: number },
  ): boolean {
    return (
      proj.x - PROJECTILE_RADIUS <= 0 ||
      proj.x + PROJECTILE_RADIUS >= bounds.width ||
      proj.y - PROJECTILE_RADIUS <= 0 ||
      proj.y + PROJECTILE_RADIUS >= bounds.height
    );
  }

  /**
   * Detecta colisión entre un proyectil (círculo) y una estructura (AABB).
   * Usa la técnica de punto más cercano en el rectángulo.
   */
  checkProjectileStructureCollision(
    proj: Projectile,
    structure: CoverStructure,
  ): boolean {
    const closestX = Math.max(structure.x, Math.min(proj.x, structure.x + structure.width));
    const closestY = Math.max(structure.y, Math.min(proj.y, structure.y + structure.height));
    const dx = proj.x - closestX;
    const dy = proj.y - closestY;
    return dx * dx + dy * dy <= PROJECTILE_RADIUS * PROJECTILE_RADIUS;
  }

  /**
   * Detecta colisión entre un jugador (círculo) y una estructura (AABB).
   */
  checkPlayerStructureCollision(
    pos: Vec2,
    structure: CoverStructure,
    radius = PLAYER_RADIUS,
  ): boolean {
    const closestX = Math.max(structure.x, Math.min(pos.x, structure.x + structure.width));
    const closestY = Math.max(structure.y, Math.min(pos.y, structure.y + structure.height));
    const dx = pos.x - closestX;
    const dy = pos.y - closestY;
    return dx * dx + dy * dy <= radius * radius;
  }

  /**
   * Resuelve la colisión empujando al jugador fuera de la estructura.
   * OPTIMIZADO: Muta `pos` in-place en lugar de devolver un objeto nuevo.
   */
  resolvePlayerStructureCollisionInPlace(
    pos: Vec2,
    structure: CoverStructure,
    radius = PLAYER_RADIUS,
  ): void {
    const closestX = Math.max(structure.x, Math.min(pos.x, structure.x + structure.width));
    const closestY = Math.max(structure.y, Math.min(pos.y, structure.y + structure.height));
    const dx = pos.x - closestX;
    const dy = pos.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq === 0 || distSq >= radius * radius) return;

    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    pos.x += (dx / dist) * overlap;
    pos.y += (dy / dist) * overlap;
  }

  /**
   * Resuelve la colisión empujando al jugador fuera de la estructura.
   * Devuelve la posición corregida (compat legacy).
   */
  resolvePlayerStructureCollision(
    pos: Vec2,
    structure: CoverStructure,
    radius = PLAYER_RADIUS,
  ): Vec2 {
    const closestX = Math.max(structure.x, Math.min(pos.x, structure.x + structure.width));
    const closestY = Math.max(structure.y, Math.min(pos.y, structure.y + structure.height));
    const dx = pos.x - closestX;
    const dy = pos.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq === 0 || distSq >= radius * radius) return pos;

    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    return {
      x: pos.x + (dx / dist) * overlap,
      y: pos.y + (dy / dist) * overlap,
    };
  }

  /**
   * Clamp de posición dentro de los límites del mapa con margen de radio.
   * OPTIMIZADO: Muta `pos` in-place.
   */
  clampPositionInPlace(
    pos: Vec2,
    boundsWidth: number,
    boundsHeight: number,
    radius: number,
  ): void {
    if (pos.x < radius) pos.x = radius;
    else if (pos.x > boundsWidth - radius) pos.x = boundsWidth - radius;
    if (pos.y < radius) pos.y = radius;
    else if (pos.y > boundsHeight - radius) pos.y = boundsHeight - radius;
  }

  /**
   * Clamp de posición dentro de los límites del mapa con margen de radio (compat legacy).
   */
  clampPosition(
    pos: Vec2,
    bounds: { width: number; height: number },
    radius: number,
  ): Vec2 {
    return {
      x: Math.max(radius, Math.min(bounds.width - radius, pos.x)),
      y: Math.max(radius, Math.min(bounds.height - radius, pos.y)),
    };
  }

  /**
   * Genera una posición de respawn aleatoria que no intersecte con ninguna
   * estructura ni con otros jugadores. Reintenta hasta 50 veces.
   */
  generateRespawnPosition(
    bounds: { width: number; height: number },
    structures: CoverStructure[] = [],
    occupiedPositions: Vec2[] = [],
  ): Vec2 {
    const margin = PLAYER_RADIUS + 10;
    const minPlayerDist = PLAYER_RADIUS * 3;

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate: Vec2 = {
        x: Math.round(margin + Math.random() * (bounds.width - margin * 2)), // NOSONAR - used for game spawn positions, not security
        y: Math.round(margin + Math.random() * (bounds.height - margin * 2)), // NOSONAR - used for game spawn positions, not security
      };

      // Verificar que no colisione con ninguna estructura
      const hitsStructure = structures.some(s =>
        this.checkPlayerStructureCollision(candidate, s, PLAYER_RADIUS + 15),
      );
      if (hitsStructure) continue;

      // Verificar que no esté demasiado cerca de otro jugador
      const hitPlayer = occupiedPositions.some(p => {
        const dx = candidate.x - p.x;
        const dy = candidate.y - p.y;
        return dx * dx + dy * dy < minPlayerDist * minPlayerDist;
      });
      if (hitPlayer) continue;

      return candidate;
    }

    // Fallback: esquina libre
    return { x: margin, y: margin };
  }
}
