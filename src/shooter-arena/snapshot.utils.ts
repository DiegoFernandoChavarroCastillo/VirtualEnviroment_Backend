import { ShooterSnapshot } from './interfaces/shooter-arena.interfaces';

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeSnapshot(s: ShooterSnapshot): string {
  return JSON.stringify(s);
}

export function deserializeSnapshot(raw: string): ShooterSnapshot | null {
  try {
    const obj = JSON.parse(raw);
    return isValidShooterSnapshot(obj) ? (obj as ShooterSnapshot) : null;
  } catch {
    return null;
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidShooterSnapshot(obj: unknown): obj is ShooterSnapshot {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.roomId === 'string' &&
    typeof s.tick === 'number' &&
    typeof s.timestamp === 'number' &&
    Array.isArray(s.players) &&
    Array.isArray(s.projectiles)
  );
}
