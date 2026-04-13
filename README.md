<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

<p align="center">Microservicio de entorno virtual en tiempo real para <a href="#" target="_blank">Peerly</a> — red social universitaria.</p>
<p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://socket.io" target="_blank"><img src="https://img.shields.io/badge/socket.io-4.x-black.svg" alt="Socket.IO" /></a>
<a href="https://redis.io" target="_blank"><img src="https://img.shields.io/badge/redis-7.x-red.svg" alt="Redis" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
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

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

The WebSocket namespace will be available at `ws://localhost:3001/map`.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3001` |
| `REDIS_HOST` | Redis server host | `localhost` |
| `REDIS_PORT` | Redis server port | `6379` |
| `JWT_SECRET` | JWT signing secret | — |
| `USER_MANAGEMENT_URL` | User Management microservice URL | — |
| `CONNECTION_MANAGEMENT_URL` | Connection Management microservice URL | — |

## WebSocket API

Connect to the `/map` namespace with a valid JWT token:

```js
const socket = io('http://localhost:3001/map', {
  auth: { token: 'your-jwt-token' }
});
```

### Incoming events (client → server)

| Event | Payload | Description |
|---|---|---|
| `joinMap` | — | Join the virtual map |
| `updatePosition` | `{ x: number, y: number }` | Update avatar position (throttled 50ms) |
| `sendChat` | `{ message: string }` | Send a temporary chat message (max 500 chars) |

### Outgoing events (server → client)

| Event | Payload | Description |
|---|---|---|
| `userJoined` | `{ userId, name, email, timestamp }` | A user joined the map |
| `userLeft` | `{ userId, timestamp }` | A user disconnected |
| `positionUpdate` | `{ userId, x, y, timestamp }` | Another user moved |
| `initialPositions` | `AvatarPosition[]` | All active positions on join |
| `chatMessage` | `{ userId, name, message, timestamp }` | New chat message |
| `error` | `{ code, message, timestamp }` | Processing error |

## Architecture

Follows hexagonal architecture consistent with all Peerly microservices:

```
src/
├── contexts/realtime/
│   ├── domain/
│   │   ├── entities/          # AvatarPosition, ChatMessage, Presence
│   │   └── ports/             # RealtimePort
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
├── app.module.ts
└── main.ts
```

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

Open `test-client.html` directly in your browser to test all WebSocket events interactively. Open it in two tabs to simulate multiple users.

## Health check

```bash
$ curl http://localhost:3001/health
```

```json
{ "status": "ok", "redis": "connected", "timestamp": "..." }
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).



## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
