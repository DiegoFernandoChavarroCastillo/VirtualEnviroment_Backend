import { DuelSnapshot } from './interfaces/football-duel.interfaces';

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeSnapshot(snapshot: DuelSnapshot): string {
  return JSON.stringify(snapshot);
}

export function deserializeSnapshot(raw: string): DuelSnapshot | null {
  try {
    const obj = JSON.parse(raw);
    return isValidSnapshot(obj) ? (obj as DuelSnapshot) : null;
  } catch {
    return null;
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidSnapshot(obj: unknown): obj is DuelSnapshot {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.matchId === 'string' &&
    typeof s.tick === 'number' &&
    typeof s.timestamp === 'number' &&
    typeof s.ball === 'object' && s.ball !== null &&
    Array.isArray(s.players) &&
    typeof s.score === 'object' && s.score !== null
  );
}

// ─── Time formatting ──────────────────────────────────────────────────────────

/** Format seconds as MM:SS with zero-padding */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
