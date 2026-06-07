import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import * as Matter from 'matter-js';
import { v4 as uuidv4 } from 'uuid';
import { InMemoryRepository } from '../virtual-world/infrastructure/persistence/in-memory/in-memory.repository';
import {
  PlayerInfo,
  FootballDuelState,
  DuelSnapshot,
  PlayerInput,
  MatchEndedPayload,
  PHYSICS_STEP_MS,
  SNAPSHOT_INTERVAL_TICKS,
  MATCH_DURATION_SECONDS,
  GOAL_AREAS,
  BALL_RADIUS,
  PLAYER_SPEED,
  KICK_RADIUS,
  MAX_KICK_FORCE,
  PAD_ZONE_CENTER,
  SPAWN_RADIUS,
  CROWN_TTL_SECONDS,
} from './interfaces/football-duel.interfaces';

// ─── Match canvas dimensions ──────────────────────────────────────────────────
const FIELD_W = 800;
const FIELD_H = 500;
const WALL_T = 20; // wall thickness

interface MatchInstance {
  matchId: string;
  engine: Matter.Engine;
  ball: Matter.Body;
  playerBodies: Record<string, Matter.Body>;
  score: Record<string, number>;
  timeRemaining: number;
  tickCount: number;
  lastSnapshotTick: number;
  lastPersistTime: number;
  lastInputTime: Record<string, number>;
  physicsInterval: ReturnType<typeof setInterval>;
  matchTimer: ReturnType<typeof setInterval>;
  player1: PlayerInfo;
  player2: PlayerInfo;
  ended: boolean;
}

@Injectable()
export class DuelEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(DuelEngineService.name);
  private readonly matches = new Map<string, MatchInstance>();

  /** Injected by FootballDuelGateway after init */
  private duelServer: Server | null = null;

  /** Callback to notify when a match ends (used by gateway to award crown / unlock pads) */
  private onMatchEnded: ((payload: MatchEndedPayload) => Promise<void>) | null = null;

  constructor(private readonly repository: InMemoryRepository) {}

  onModuleDestroy() {
    for (const matchId of this.matches.keys()) {
      this.destroyMatch(matchId);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setDuelServer(server: Server) {
    this.duelServer = server;
  }

  setMatchEndedCallback(cb: (payload: MatchEndedPayload) => Promise<void>) {
    this.onMatchEnded = cb;
  }

  async createMatch(
    p1Id: string, p1Name: string,
    p2Id: string, p2Name: string,
  ): Promise<string> {
    const matchId = uuidv4();

    // ── Build Matter.js world ──────────────────────────────────────────────
    const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
    const { world } = engine;

    // Walls: top, bottom, left, right
    const walls = [
      Matter.Bodies.rectangle(FIELD_W / 2, -WALL_T / 2, FIELD_W, WALL_T, { isStatic: true, label: 'wall-top' }),
      Matter.Bodies.rectangle(FIELD_W / 2, FIELD_H + WALL_T / 2, FIELD_W, WALL_T, { isStatic: true, label: 'wall-bottom' }),
      Matter.Bodies.rectangle(-WALL_T / 2, FIELD_H / 2, WALL_T, FIELD_H, { isStatic: true, label: 'wall-left' }),
      Matter.Bodies.rectangle(FIELD_W + WALL_T / 2, FIELD_H / 2, WALL_T, FIELD_H, { isStatic: true, label: 'wall-right' }),
    ];

    // Goal posts (solid segments above/below each goal opening)
    const goalTopY = GOAL_AREAS.left.y;
    const goalBotY = GOAL_AREAS.left.y + GOAL_AREAS.left.height;
    const goalPosts = [
      // Left side posts
      Matter.Bodies.rectangle(10, goalTopY / 2, WALL_T, goalTopY, { isStatic: true, label: 'post' }),
      Matter.Bodies.rectangle(10, goalBotY + (FIELD_H - goalBotY) / 2, WALL_T, FIELD_H - goalBotY, { isStatic: true, label: 'post' }),
      // Right side posts
      Matter.Bodies.rectangle(FIELD_W - 10, goalTopY / 2, WALL_T, goalTopY, { isStatic: true, label: 'post' }),
      Matter.Bodies.rectangle(FIELD_W - 10, goalBotY + (FIELD_H - goalBotY) / 2, WALL_T, FIELD_H - goalBotY, { isStatic: true, label: 'post' }),
    ];

    // Ball
    const ball = Matter.Bodies.circle(FIELD_W / 2, FIELD_H / 2, BALL_RADIUS, {
      restitution: 0.8,
      friction: 0.01,
      frictionAir: 0.02,
      label: 'ball',
    });

    // Player bodies (kinematic-like: we set velocity directly)
    const p1Body = Matter.Bodies.circle(200, FIELD_H / 2, 20, {
      restitution: 0.3,
      frictionAir: 0.1,
      label: `player:${p1Id}`,
    });
    const p2Body = Matter.Bodies.circle(600, FIELD_H / 2, 20, {
      restitution: 0.3,
      frictionAir: 0.1,
      label: `player:${p2Id}`,
    });

    Matter.World.add(world, [...walls, ...goalPosts, ball, p1Body, p2Body]);

    const player1: PlayerInfo = { userId: p1Id, name: p1Name, score: 0 };
    const player2: PlayerInfo = { userId: p2Id, name: p2Name, score: 0 };

    const instance: MatchInstance = {
      matchId,
      engine,
      ball,
      playerBodies: { [p1Id]: p1Body, [p2Id]: p2Body },
      score: { [p1Id]: 0, [p2Id]: 0 },
      timeRemaining: MATCH_DURATION_SECONDS,
      tickCount: 0,
      lastSnapshotTick: 0,
      lastPersistTime: Date.now(),
      lastInputTime: { [p1Id]: Date.now(), [p2Id]: Date.now() },
      physicsInterval: null as any,
      matchTimer: null as any,
      player1,
      player2,
      ended: false,
    };

    // ── Fixed-timestep physics loop (60 Hz) ───────────────────────────────
    instance.physicsInterval = setInterval(() => {
      Matter.Engine.update(engine, PHYSICS_STEP_MS);
      instance.tickCount++;

      this.enforcePlayerBounds(instance);
      this.enforceBallBounds(instance);
      this.checkGoals(instance);
      this.checkInactivity(instance);

      // Snapshot every SNAPSHOT_INTERVAL_TICKS ticks (~33 ms = 30 FPS)
      if (instance.tickCount - instance.lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) {
        this.emitSnapshot(instance);
        instance.lastSnapshotTick = instance.tickCount;
      }

      // Persist match state every 10 s (used as the reconnection snapshot)
      const now = Date.now();
      if (now - instance.lastPersistTime >= 10000) {
        this.persistMatchState(instance).catch(() => {});
        instance.lastPersistTime = now;
      }
    }, 16);

    // ── Match countdown timer (1 s resolution) ────────────────────────────
    instance.matchTimer = setInterval(() => {
      instance.timeRemaining--;
      if (instance.timeRemaining <= 0) {
        this.endMatch(instance, null);
      }
    }, 1000);

    this.matches.set(matchId, instance);

    // Persist initial state
    await this.persistMatchState(instance);

    this.logger.log(`Match ${matchId} created: ${p1Name} vs ${p2Name}`);
    return matchId;
  }

  handlePlayerInput(matchId: string, userId: string, input: PlayerInput): void {
    const instance = this.matches.get(matchId);
    if (!instance) return;

    const body = instance.playerBodies[userId];
    if (!body) return;

    instance.lastInputTime[userId] = Date.now();

    if (input.action === 'move') {
      const vx = (input.dx ?? 0) * PLAYER_SPEED;
      const vy = (input.dy ?? 0) * PLAYER_SPEED;
      Matter.Body.setVelocity(body, { x: vx, y: vy });
    } else if (input.action === 'kick') {
      this.applyKick(instance, userId, body);
    }
  }

  getMatchState(matchId: string): FootballDuelState | null {
    const instance = this.matches.get(matchId);
    if (!instance) return null;
    return this.buildState(instance);
  }

  destroyMatch(matchId: string): void {
    const instance = this.matches.get(matchId);
    if (!instance) return;
    clearInterval(instance.physicsInterval);
    clearInterval(instance.matchTimer);
    Matter.Engine.clear(instance.engine);
    this.matches.delete(matchId);
    this.repository.deleteMatchState(matchId).catch(() => {});
    this.logger.log(`Match ${matchId} destroyed`);
  }

  handlePlayerDisconnect(matchId: string, disconnectedUserId: string): void {
    const instance = this.matches.get(matchId);
    if (!instance) return;
    const winnerId =
      instance.player1.userId === disconnectedUserId
        ? instance.player2.userId
        : instance.player1.userId;
    this.endMatch(instance, winnerId, true);
  }

  getMatchIdForPlayer(userId: string): string | null {
    for (const [matchId, instance] of this.matches) {
      if (instance.playerBodies[userId]) return matchId;
    }
    return null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private applyKick(instance: MatchInstance, userId: string, playerBody: Matter.Body): void {
    const ball = instance.ball;
    const dx = ball.position.x - playerBody.position.x;
    const dy = ball.position.y - playerBody.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > KICK_RADIUS) return; // too far

    const magnitude = Math.min(MAX_KICK_FORCE, MAX_KICK_FORCE); // always capped
    const nx = dx / dist;
    const ny = dy / dist;

    // Anti-cheat: magnitude is always exactly MAX_KICK_FORCE (server-authoritative)
    Matter.Body.applyForce(ball, ball.position, { x: nx * magnitude, y: ny * magnitude });
  }

  private enforcePlayerBounds(instance: MatchInstance): void {
    for (const body of Object.values(instance.playerBodies)) {
      const x = Math.max(20, Math.min(FIELD_W - 20, body.position.x));
      const y = Math.max(20, Math.min(FIELD_H - 20, body.position.y));
      if (x !== body.position.x || y !== body.position.y) {
        Matter.Body.setPosition(body, { x, y });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
      }
    }
  }

  /**
   * Hard clamp the ball inside the field.
   * This is a safety net for cases where the ball tunnels through a wall
   * at high velocity (a known limitation of discrete collision detection).
   * If the ball is outside bounds, we reset it to the centre with zero velocity.
   */
  private enforceBallBounds(instance: MatchInstance): void {
    const { x: bx, y: by } = instance.ball.position;
    const margin = BALL_RADIUS;

    // Check if ball is completely outside the field (not just in a goal area)
    const outLeft  = bx < -margin * 2;
    const outRight = bx > FIELD_W + margin * 2;
    const outTop   = by < -margin * 2;
    const outBot   = by > FIELD_H + margin * 2;

    if (outLeft || outRight || outTop || outBot) {
      this.logger.warn(`Ball escaped bounds (${bx.toFixed(1)}, ${by.toFixed(1)}) — resetting to centre`);
      Matter.Body.setPosition(instance.ball, { x: FIELD_W / 2, y: FIELD_H / 2 });
      Matter.Body.setVelocity(instance.ball, { x: 0, y: 0 });
      return;
    }

    // Soft clamp: bounce off top/bottom walls if physics missed it
    if (by - margin < 0) {
      Matter.Body.setPosition(instance.ball, { x: bx, y: margin });
      Matter.Body.setVelocity(instance.ball, { x: instance.ball.velocity.x, y: Math.abs(instance.ball.velocity.y) });
    } else if (by + margin > FIELD_H) {
      Matter.Body.setPosition(instance.ball, { x: bx, y: FIELD_H - margin });
      Matter.Body.setVelocity(instance.ball, { x: instance.ball.velocity.x, y: -Math.abs(instance.ball.velocity.y) });
    }

    // Left/right: only clamp if NOT in the goal vertical range (let goal detection handle those)
    const inGoalRange = by >= GOAL_AREAS.left.y && by <= GOAL_AREAS.left.y + GOAL_AREAS.left.height;
    if (!inGoalRange) {
      if (bx - margin < 0) {
        Matter.Body.setPosition(instance.ball, { x: margin, y: by });
        Matter.Body.setVelocity(instance.ball, { x: Math.abs(instance.ball.velocity.x), y: instance.ball.velocity.y });
      } else if (bx + margin > FIELD_W) {
        Matter.Body.setPosition(instance.ball, { x: FIELD_W - margin, y: by });
        Matter.Body.setVelocity(instance.ball, { x: -Math.abs(instance.ball.velocity.x), y: instance.ball.velocity.y });
      }
    }
  }

  private checkGoals(instance: MatchInstance): void {
    const { x: bx, y: by } = instance.ball.position;

    for (const [side, area] of Object.entries(GOAL_AREAS) as [string, typeof GOAL_AREAS.left][]) {
      // Goal detection: ball centre crosses the goal line and is within the vertical opening.
      // Left goal: ball centre reaches x <= area.x + area.width (x <= 20)
      // Right goal: ball centre reaches x >= area.x (x >= 780)
      const inVerticalRange =
        by >= area.y && by <= area.y + area.height;

      const crossedGoalLine =
        side === 'left'
          ? bx - BALL_RADIUS <= area.x + area.width   // ball touches/crosses left goal line
          : bx + BALL_RADIUS >= area.x;               // ball touches/crosses right goal line

      if (!inVerticalRange || !crossedGoalLine) continue;

      // Determine scorer: player on the opposite side scores
      const scorerId =
        side === 'left'
          ? instance.player2.userId   // p2 attacks left goal → p2 scores
          : instance.player1.userId;  // p1 attacks right goal → p1 scores

      instance.score[scorerId] = (instance.score[scorerId] ?? 0) + 1;

      // Reset ball to centre with zero velocity
      Matter.Body.setPosition(instance.ball, { x: FIELD_W / 2, y: FIELD_H / 2 });
      Matter.Body.setVelocity(instance.ball, { x: 0, y: 0 });

      // Emit goalScored to the match room
      if (this.duelServer) {
        this.duelServer.to(`match:${instance.matchId}`).emit('goalScored', {
          scorerId,
          score: { ...instance.score },
        });
      }

      this.logger.log(`Goal! side=${side} scorer=${scorerId} score=${JSON.stringify(instance.score)}`);
      break;
    }
  }

  private checkInactivity(instance: MatchInstance): void {
    // Inactivity check disabled: players are allowed to stand still.
    // Match ends only by timer expiry or player disconnect.
  }

  private endMatch(instance: MatchInstance, forcedWinnerId: string | null, byDisconnect = false): void {
    if (instance.ended) return; // guard against double-end
    instance.ended = true;

    clearInterval(instance.physicsInterval);
    clearInterval(instance.matchTimer);

    const { score, player1, player2, matchId } = instance;

    let winnerId: string | null = forcedWinnerId;
    let isDraw = false;

    if (winnerId === null) {
      // Determine by score
      if (score[player1.userId] > score[player2.userId]) {
        winnerId = player1.userId;
      } else if (score[player2.userId] > score[player1.userId]) {
        winnerId = player2.userId;
      } else {
        isDraw = true;
      }
    }

    const winnerName = winnerId
      ? (winnerId === player1.userId ? player1.name : player2.name)
      : undefined;

    const payload: MatchEndedPayload = {
      matchId,
      winnerId,
      winnerName,
      isDraw,
      finalScore: { ...score },
    };

    // Emit matchEnded to both players
    if (this.duelServer) {
      this.duelServer.to(`match:${matchId}`).emit('matchEnded', payload);

      // Capture socket IDs BEFORE destroying the match (room is still alive here)
      // In Socket.IO v4 namespaces, adapter is accessed directly on the namespace server
      const adapter = (this.duelServer as any).adapter;
      const roomSockets = adapter?.rooms?.get(`match:${matchId}`);
      const socketIds = roomSockets ? [...roomSockets] : [];

      // After 5 s, emit returnToVirtualWorld using captured socket IDs
      setTimeout(() => {
        if (!this.duelServer) return;
        const spawnA = this.randomSpawn();
        const spawnB = this.randomSpawn();
        const [s1, s2] = socketIds;
        if (s1) this.duelServer.to(s1).emit('returnToVirtualWorld', spawnA);
        if (s2) this.duelServer.to(s2).emit('returnToVirtualWorld', spawnB);
      }, 5000);
    }

    // Notify gateway (crown + unlock pads)
    if (this.onMatchEnded) {
      this.onMatchEnded(payload).catch(() => {});
    }

    this.destroyMatch(matchId);
  }

  private emitSnapshot(instance: MatchInstance): void {
    if (!this.duelServer) return;

    const snapshot: DuelSnapshot = {
      matchId: instance.matchId,
      tick: instance.tickCount,
      timestamp: Date.now(),
      ball: {
        x: instance.ball.position.x,
        y: instance.ball.position.y,
        vx: instance.ball.velocity.x,
        vy: instance.ball.velocity.y,
      },
      players: Object.entries(instance.playerBodies).map(([userId, body]) => ({
        userId,
        x: body.position.x,
        y: body.position.y,
        vx: body.velocity.x,
        vy: body.velocity.y,
      })),
      score: { ...instance.score },
    };

    this.duelServer.to(`match:${instance.matchId}`).emit('snapshot', snapshot);
  }

  private async persistMatchState(instance: MatchInstance): Promise<void> {
    const state = this.buildState(instance);
    await this.repository.setMatchState(instance.matchId, state);
  }

  private buildState(instance: MatchInstance): FootballDuelState {
    return {
      matchId: instance.matchId,
      player1: { ...instance.player1, score: instance.score[instance.player1.userId] ?? 0 },
      player2: { ...instance.player2, score: instance.score[instance.player2.userId] ?? 0 },
      timeRemaining: instance.timeRemaining,
      status: 'active',
      ball: {
        x: instance.ball.position.x,
        y: instance.ball.position.y,
        vx: instance.ball.velocity.x,
        vy: instance.ball.velocity.y,
      },
    };
  }

  private randomSpawn(): { spawnX: number; spawnY: number } {
    // Spawn in the upper half of the map, away from the pad zone (bottom area y≈460)
    // Canvas is 800×600. Keep away from edges (margin 60) and pads (y > 380).
    const MARGIN = 60;
    const MAX_Y = 350; // stay well above the pad zone
    const spawnX = Math.round(MARGIN + Math.random() * (800 - MARGIN * 2));
    const spawnY = Math.round(MARGIN + Math.random() * (MAX_Y - MARGIN));
    return { spawnX, spawnY };
  }
}
