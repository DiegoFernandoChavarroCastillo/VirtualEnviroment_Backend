import { Injectable } from '@nestjs/common';
import {
  Vec2,
  Projectile,
  ShooterPlayerState,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
} from './interfaces/shooter-arena.interfaces';

/**
 * CollisionService — lógica pura de colisiones, sin I/O ni efectos secundarios.
 *
 * Toda la detección de colisiones del Arena Shooter se centraliza aquí para
 * facilitar el testing con property-based tests (fast-check).
 *
 * Mejora futura: si se añaden obstáculos (Fase 3), agregar
 * checkProjectileObstacleCollision(proj, obstacle) aquí.
 */
@Injectable()
export class CollisionService {
  /**
   * Detecta colisión círculo-círculo entre un proyectil y un jugador.
   *
   * @param proj       Proyectil a evaluar
   * @param player     Jugador objetivo
   * @param ignoreOwner Si es true, ignora colisiones con el propio disparador
   * @returns true si hay colisión
   */
  checkProjectilePlayerCollision(
    proj: Projectile,
    player: ShooterPlayerState,
    ignoreOwner = true,
  ): boolean {
    // El disparador nunca colisiona con su propio proyectil
    if (ignoreOwner && proj.ownerId === player.userId) return false;

    const dx = proj.x - player.x;
    const dy = proj.y - player.y;
    const distSq = dx * dx + dy * dy;
    const radiusSum = PROJECTILE_RADIUS + PLAYER_RADIUS;

    return distSq <= radiusSum * radiusSum;
  }

  /**
   * Detecta si un proyectil ha alcanzado o superado los bordes del mapa.
   *
   * @param proj   Proyectil a evaluar
   * @param bounds Dimensiones del mapa
   * @returns true si el proyectil debe destruirse
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
   * Clamp de posición dentro de los límites del mapa con margen de radio.
   * Garantiza que ningún jugador pueda salir del área de juego.
   *
   * @param pos    Posición a clampear
   * @param bounds Dimensiones del mapa
   * @param radius Radio del jugador (margen)
   * @returns Posición clampeada
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
   * Genera una posición de respawn aleatoria dentro de los límites del mapa,
   * con margen de PLAYER_RADIUS para que el jugador no aparezca en el borde.
   *
   * @param bounds Dimensiones del mapa
   * @returns Posición aleatoria válida
   */
  generateRespawnPosition(bounds: { width: number; height: number }): Vec2 {
    const margin = PLAYER_RADIUS;
    return {
      x: Math.round(margin + Math.random() * (bounds.width - margin * 2)),
      y: Math.round(margin + Math.random() * (bounds.height - margin * 2)),
    };
  }
}
