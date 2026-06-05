/**
 * Feature flags.
 *
 * Each flag is read once at module load time. Change the value via
 * environment variables and restart the process — flags are NOT
 * hot-reloaded.
 */

/**
 * `FOOTBALL_DUEL_ENABLED=true`  → football-duel is active
 * `FOOTBALL_DUEL_ENABLED=false` → football-duel is disabled (default).
 *                                  The code stays on disk for easy re-enable.
 *
 * The project is currently focused on shooter-arena, so football-duel
 * ships disabled by default. To re-enable the minigame, set
 * `FOOTBALL_DUEL_ENABLED=true` in `.env` and restart the backend.
 *
 * When disabled:
 *   - Backend: the `FootballDuelModule` is not registered, so its
 *     gateways (`/football-duel`, `/duel-pads`) never bind, no
 *     `padStateUpdate` / `duelStarted` / `crownUpdate` events are
 *     emitted, and the duel-pad/crown/duel-engine services do not run.
 *   - Frontend: `useRealtimeMap` skips pad/duel/crown listeners and
 *     `VirtualWorld` skips drawing duel pads, crowns and the
 *     `FootballDuelMatch` overlay.
 */
export const FOOTBALL_DUEL_ENABLED: boolean =
  (process.env.FOOTBALL_DUEL_ENABLED ?? 'false').toLowerCase() === 'true';
