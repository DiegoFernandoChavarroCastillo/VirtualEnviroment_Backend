<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center">Microservicio de entorno virtual en tiempo real para <a href="#" target="_blank">Peerly</a> — red social universitaria.</p>
<p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://socket.io" target="_blank"><img src="https://img.shields.io/badge/socket.io-4.x-black.svg" alt="Socket.IO" /></a>
<a href="https://redis.io" target="_blank"><img src="https://img.shields.io/badge/redis-7.x-red.svg" alt="Redis" /></a>
</p>

## Description

**peerly-realtime-management** is a [NestJS](https://github.com/nestjs/nest) microservice that handles real-time communication for the Peerly university social network. It manages user presence on a virtual map, avatar position updates, and temporary chat messages using WebSocket (Socket.IO) and Redis for ephemeral storage.

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

The service runs on **port 3004** by default. The WebSocket namespace is available at `ws://localhost:3004/map`.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3004` |
| `REDIS_HOST` | Redis server host | `localhost` |
| `REDIS_PORT` | Redis server port | `6379` |
| `JWT_SECRET` | JWT signing secret — **must match auth service** | — |
| `USER_MANAGEMENT_URL` | User Management microservice URL | `http://localhost:3000` |
| `CONNECTION_MANAGEMENT_URL` | Connection Management microservice URL | `http://localhost:3003` |

## WebSocket API

Connect to the `/map` namespace with a valid JWT token:

```js
const socket = io('http://localhost:3004/map', {
  auth: { token: 'your-jwt-token' },
  transports: ['websocket'],
});
```

### Incoming events (client → server)

All events require a valid JWT. The guard reads the token from `socket.handshake.auth.token` or the `Authorization` header.

| Event | Payload | Description |
|---|---|---|
| `joinMap` | — | Join the virtual map. Server responds with `initialPositions` and broadcasts `userJoined` to all clients |
| `leaveMap` | — | Explicitly leave the map (e.g. navigating away). Server removes presence/position and broadcasts `userLeft` |
| `updatePosition` | `{ x: number, y: number }` | Update avatar position (throttled: 20 req/s) |
| `sendChat` | `{ message: string }` | Send a temporary chat message (max 500 chars) |

### Outgoing events (server → client)

| Event | Payload | Description |
|---|---|---|
| `userJoined` | `{ userId, name, email, timestamp }` | A user joined the map |
| `userLeft` | `{ userId, timestamp }` | A user left the map (navigation or disconnect) |
| `positionUpdate` | `{ userId, x, y, timestamp }` | Another user moved (not sent to the mover) |
| `initialPositions` | `AvatarPosition[]` | All active positions, sent only to the joining client |
| `chatMessage` | `{ userId, name, message, timestamp }` | New chat message broadcast to all |
| `error` | `{ code, message, timestamp }` | Error codes: `AUTH_ERROR`, `VALIDATION_ERROR`, `PROCESSING_ERROR` |

## Architecture

Follows hexagonal architecture consistent with all Peerly microservices:

```
src/
├── contexts/realtime/
│   ├── domain/
│   │   └── entities/          # AvatarPosition, ChatMessage, Presence
│   ├── application/
│   │   ├── services/          # RealtimeService
│   │   ├── use-cases/         # JoinMap, UpdatePosition, SendChat
│   │   ├── dtos/              # UpdatePositionDto, SendChatDto
│   │   └── interfaces/        # Event interfaces
│   └── infrastructure/
│       ├── adapters/
│       │   ├── in/            # VirtualMapGateway (WebSocket /map)
│       │   └── out/http/      # UserManagementClient, ConnectionManagementClient
│       └── persistence/redis/ # RedisRepository
├── common/guards/             # JwtAuthGuard
├── health/                    # GET /health
├── realtime/                  # RealtimeModule (wires all providers)
├── app.module.ts
└── main.ts
```

### Notes on current implementation

- **Redis adapter is disabled.** The service runs in single-instance mode. `@socket.io/redis-adapter` is installed but not wired — `afterInit` logs this explicitly. Multi-instance support can be added later by configuring the adapter in `VirtualMapGateway.afterInit`.
- **`leaveMap` vs disconnect.** User removal is triggered by either the explicit `leaveMap` event (navigation) or the `handleDisconnect` lifecycle hook (connection drop). Both paths call `realtimeService.handleUserLeave` and broadcast `userLeft`.
- **JWT loaded via `registerAsync`.** `JwtModule` uses `registerAsync` with a factory so `process.env.JWT_SECRET` is read after `dotenv/config` has loaded the `.env` file.

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
