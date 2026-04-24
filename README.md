<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center">Microservicio de entorno virtual en tiempo real para <a href="#" target="_blank">Peerly</a> — red social universitaria.</p>
<p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://socket.io" target="_blank"><img src="https://img.shields.io/badge/socket.io-4.x-black.svg" alt="Socket.IO" /></a>
<a href="https://redis.io" target="_blank"><img src="https://img.shields.io/badge/redis-7.x-red.svg" alt="Redis" /></a>
<a href="https://brm.io/matter-js/" target="_blank"><img src="https://img.shields.io/badge/matter.js-0.19-blue.svg" alt="Matter.js" /></a>
</p>

## Description

**peerly-realtime-management** is a [NestJS](https://github.com/nestjs/nest) microservice that handles all real-time communication for the Peerly university social network. It manages:

- **Virtual map presence** — avatar positions, user join/leave events
- **Temporary chat** — ephemeral messages broadcast to all users on the map
- **Football Duel 1v1** — server-authoritative physics mini-game using Matter.js at 60 Hz
- **Duel pads** — proximity detection zones that trigger matches
- **Crown system** — winner badge visible to all users for a configurable duration

All ephemeral state is stored in **Redis**. The service runs on a single instance (Redis adapter available but not wired by default).

## Project setup

```bash
$ npm install --legacy-peer-deps
```

Copy the environment file and configure your variables:

```bash
$ cp .env.example .env
```

> **Important:** `JWT_SECRET` must match exactly the value used in `peerly-authentication-management`. A mismatch will cause all WebSocket events to fail with `AUTH_ERROR`.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

The service runs on **port 3004** by default.

| Namespace | URL |
|---|---|
| Virtual map | `ws://localhost:3004/map` |
| Football Duel | `ws://localhost:3004/football-duel` |

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3004` |
| `REDIS_HOST` | Redis server host | `localhost` |
| `REDIS_PORT` | Redis server port | `6379` |
| `JWT_SECRET` | JWT signing secret — **must match auth service** | — |
| `USER_MANAGEMENT_URL` | User Management microservice URL | `http://localhost:3000` |
| `CONNECTION_MANAGEMENT_URL` | Connection Management microservice URL | `http://localhost:3003` |
| `MATCH_DURATION_SECONDS` | Football match duration in seconds | `180` |

## Architecture

Follows hexagonal architecture consistent with all Peerly microservices:

```
src/
├── contexts/realtime/
│   ├── domain/
│   │   └── entities/              # AvatarPosition, ChatMessage, Presence
│   ├── application/
│   │   ├── services/              # RealtimeService
│   │   ├── use-cases/             # JoinMap, UpdatePosition, SendChat
│   │   ├── dtos/                  # UpdatePositionDto, SendChatDto
│   │   └── interfaces/            # Event interfaces
│   └── infrastructure/
│       ├── adapters/
│       │   ├── in/                # VirtualMapGateway (WebSocket /map)
│       │   └── out/http/          # UserManagementClient, ConnectionManagementClient
│       └── persistence/redis/     # RedisRepository
├── football-duel/
│   ├── interfaces/
│   │   └── football-duel.interfaces.ts   # Shared types, interfaces and constants
│   ├── dto/
│   │   ├── check-duel-pads.dto.ts        # DTO for checkDuelPads event
│   │   └── player-input.dto.ts           # DTO for playerInput event
│   ├── duel-pad.service.ts               # Pad presence detection and match activation
│   ├── duel-engine.service.ts            # Authoritative Matter.js physics engine (60 Hz)
│   ├── crown.service.ts                  # Winner crown management
│   ├── duel-pad.gateway.ts               # /map namespace — checkDuelPads handler
│   ├── football-duel.gateway.ts          # /football-duel namespace — match events
│   ├── football-duel.module.ts           # NestJS module
│   └── snapshot.utils.ts                 # Snapshot serialization and validation
├── common/guards/                 # JwtAuthGuard (WebSocket)
├── health/                        # GET /health
├── realtime/                      # RealtimeModule
├── app.module.ts
└── main.ts
```

## WebSocket API — `/map` namespace

Connect with a valid JWT token:

```js
const socket = io('http://localhost:3004/map', {
  auth: { token: 'your-jwt-token' },
  transports: ['websocket'],
});
```

All events require a valid JWT. The guard reads the token from `socket.handshake.auth.token` or the `Authorization` header.

### Incoming events (client → server)

| Event | Payload | Description |
|---|---|---|
| `joinMap` | — | Join the virtual map. Server responds with `initialPositions` and broadcasts `userJoined` |
| `leaveMap` | — | Explicitly leave the map. Server removes presence and broadcasts `userLeft` |
| `updatePosition` | `{ x: number, y: number }` | Update avatar position (throttled: 20 req/s) |
| `sendChat` | `{ message: string }` | Send a temporary chat message (max 500 chars) |
| `checkDuelPads` | `{ x: number, y: number }` | Check if avatar overlaps a duel pad (throttled: 5 req/s) |

### Outgoing events (server → client)

| Event | Payload | Description |
|---|---|---|
| `userJoined` | `{ userId, name, email, timestamp }` | A user joined the map |
| `userLeft` | `{ userId, timestamp }` | A user left the map |
| `positionUpdate` | `{ userId, x, y, timestamp }` | Another user moved (not sent to the mover) |
| `initialPositions` | `AvatarPosition[]` | All active positions, sent only to the joining client |
| `chatMessage` | `{ userId, name, message, timestamp }` | New chat message broadcast to all |
| `padStateUpdate` | `PadState[]` | Updated state of both duel pads (broadcast) |
| `duelStarted` | `{ matchId, player1, player2 }` | Match started — sent to both players |
| `padBlocked` | `{ padId }` | Pad is locked — sent to the player who tried to occupy it |
| `crownUpdate` | `{ winnerId, winnerName, expiresAt }` | Crown state broadcast to all |
| `error` | `{ code, message, timestamp }` | Error codes: `AUTH_ERROR`, `USER_NOT_FOUND`, `VALIDATION_ERROR`, `PROCESSING_ERROR` |

## WebSocket API — `/football-duel` namespace

Connect after receiving `duelStarted`:

```js
const duelSocket = io('http://localhost:3004/football-duel', {
  auth: { token: 'your-jwt-token' },
  transports: ['websocket'],
});
```

### Incoming events (client → server)

| Event | Payload | Description |
|---|---|---|
| `joinMatch` | `{ matchId: string }` | Join an active match room |
| `playerInput` | `{ matchId, action, dx?, dy? }` | Movement (`action: 'move'`, `dx`/`dy`: -1\|0\|1) or kick (`action: 'kick'`) |

### Outgoing events (server → client)

| Event | Payload | Description |
|---|---|---|
| `matchState` | `FootballDuelState` | Full match state sent to the joining client |
| `snapshot` | `DuelSnapshot` | Physics state every ~70 ms (ball + players + score) |
| `goalScored` | `{ scorerId, score }` | Goal detected — includes updated scoreboard |
| `matchEnded` | `{ matchId, winnerId, winnerName, isDraw, finalScore }` | Match over |
| `returnToVirtualWorld` | `{ spawnX, spawnY }` | Spawn coordinates sent 5 s after match ends |
| `matchNotFound` | `{ matchId }` | Match not found (e.g. reconnection after server restart) |

## Football Duel — how it works

1. Both players must be on the virtual map (`/map` namespace).
2. Each player walks onto one of the two **duel pads** (bottom-right area of the map, around x=400, y=460).
3. After **2 seconds** of simultaneous presence, the match starts automatically.
4. Both clients connect to `/football-duel` and emit `joinMatch`.
5. The server runs a **60 Hz physics loop** (Matter.js) and emits snapshots every ~70 ms.
6. The client uses **client-side prediction** for the local player and **LERP interpolation** for the opponent and ball.
7. The match lasts `MATCH_DURATION_SECONDS` (default 180 s). The player with more goals wins.
8. On match end, both players receive `returnToVirtualWorld` with spawn coordinates 5 s later.
9. The winner receives a **crown** visible to all map users for `CROWN_TTL_SECONDS` (default 120 s).

### Physics constants

| Constant | Value | Description |
|---|---|---|
| `PHYSICS_STEP_MS` | `16.67` | Physics timestep (60 Hz) |
| `SNAPSHOT_INTERVAL_TICKS` | `4` | Snapshot every 4 ticks (~70 ms) |
| `PLAYER_SPEED` | `5` | Player velocity in px/tick |
| `KICK_RADIUS` | `60` | Max distance to kick the ball (px) |
| `MAX_KICK_FORCE` | `0.05` | Max kick force in Matter.js units |
| `PAD_ACTIVATION_MS` | `2000` | Time both players must stand on pads |
| `CROWN_TTL_SECONDS` | `120` | Crown duration after a win |
| `SPAWN_RADIUS` | `100` | Radius around pad zone for post-match spawn |

### Match canvas

The match field is **800 × 500 px** with goals on the left and right walls:

```
left goal:  { x: 0,   y: 210, width: 20, height: 80 }
right goal: { x: 780, y: 210, width: 20, height: 80 }
```

Player 1 spawns at x=200, Player 2 at x=600 (both at y=250).

## Implementation notes

- **Redis adapter disabled.** The service runs in single-instance mode. `@socket.io/redis-adapter` is installed but not wired. Multi-instance support can be added in `VirtualMapGateway.afterInit`.
- **`leaveMap` vs disconnect.** User removal is triggered by either the explicit `leaveMap` event or the `handleDisconnect` lifecycle hook. Both call `realtimeService.handleUserLeave` and broadcast `userLeft`.
- **JWT guard merges `client.data.user`.** The guard does `{ ...existingData, ...jwtPayload }` so fields set by other handlers (e.g. `name` set by `joinMap`) are preserved across events.
- **Match end is idempotent.** `MatchInstance.ended` flag prevents `endMatch` from running twice if both the timer and a disconnect fire simultaneously.
- **`returnToVirtualWorld` socket IDs** are captured before `destroyMatch` is called, since the Socket.IO room is cleaned up on destroy.
- **Inactivity detection is disabled.** Matches end only by timer expiry or player disconnect. Standing still is valid gameplay.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Manual testing

Open `test-client.html` directly in your browser to test WebSocket events interactively. Open it in two tabs to simulate multiple users.

> Update the `SERVER_URL` constant in `test-client.html` to `http://localhost:3004` if it still points to the old port.

## Health check

```bash
$ curl http://localhost:3004/health
```

```json
{ "status": "ok", "redis": "connected", "timestamp": "..." }
```

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
