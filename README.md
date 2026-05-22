<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center">Microservicio de entorno virtual en tiempo real para <a href="#" target="_blank">Peerly</a> — red social universitaria.</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11.x-red.svg" alt="NestJS" />
  <img src="https://img.shields.io/badge/Socket.IO-4.x-black.svg" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Matter.js-0.20-blue.svg" alt="Matter.js" />
  <img src="https://img.shields.io/badge/storage-in--memory-green.svg" alt="In-Memory" />
  <img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="License" />
</p>

---

## Descripción

**peerly-realtime-management** es un microservicio [NestJS](https://github.com/nestjs/nest) que gestiona toda la comunicación en tiempo real de la red social universitaria Peerly. Expone cuatro namespaces WebSocket:

| Namespace | Propósito |
|---|---|
| `/map` | Presencia de avatares, chat efímero, detección de zonas de juego |
| `/football-duel` | Duelo 1v1 con física autoritativa (Matter.js 60 Hz) |
| `/shooter-arena` | Arena shooter 2D multijugador (hasta 6 jugadores) |
| `/duel-pad` | Detección de pads de activación de duelo |

Todo el estado efímero se almacena **en memoria** (Maps/Sets de Node.js). No se requiere Redis ni ningún servicio externo.

---

## Instalación

```bash
npm install --legacy-peer-deps
```

Copia el archivo de entorno:

```bash
cp .env.example .env
```

> **Importante:** `JWT_SECRET` debe coincidir exactamente con el valor usado en `peerly-authentication-management`. Una discrepancia hará que todos los eventos WebSocket fallen con `AUTH_ERROR`.

---

## Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto HTTP/WebSocket del servidor | `3004` |
| `SWAGGER_PORT` | Puerto del servidor de documentación Swagger | `3005` |
| `JWT_SECRET` | Secreto JWT — **debe coincidir con el auth service** | — |
| `USER_MANAGEMENT_URL` | URL del microservicio de usuarios | `http://localhost:3001` |
| `CONNECTION_MANAGEMENT_URL` | URL del microservicio de conexiones | `http://localhost:3003` |
| `MATCH_DURATION_SECONDS` | Duración de la partida de fútbol en segundos | `180` |

---

## Ejecutar el proyecto

```bash
# desarrollo
npm run start

# modo watch (recarga automática)
npm run start:dev

# producción
npm run start:prod
```

El servicio queda disponible en:

| Recurso | URL |
|---|---|
| API REST / Swagger UI | `http://localhost:3004/api-docs` |
| Swagger JSON | `http://localhost:3005/api-docs/json` |
| WebSocket mapa virtual | `ws://localhost:3004/map` |
| WebSocket duelo fútbol | `ws://localhost:3004/football-duel` |
| WebSocket shooter arena | `ws://localhost:3004/shooter-arena` |
| Health check | `http://localhost:3004/health` |

---

## Arquitectura

Sigue arquitectura hexagonal consistente con todos los microservicios de Peerly:

```
src/
├── contexts/realtime/                        # Mapa virtual y chat
│   ├── domain/
│   │   └── entities/                         # AvatarPosition, ChatMessage
│   ├── application/
│   │   ├── services/                         # RealtimeService
│   │   ├── use-cases/                        # JoinMap, UpdatePosition, SendChat
│   │   ├── dtos/                             # UpdatePositionDto, SendChatDto
│   │   └── interfaces/                       # Event interfaces
│   └── infrastructure/
│       ├── adapters/
│       │   ├── in/                           # VirtualMapGateway (WebSocket /map)
│       │   └── out/http/                     # UserManagementClient, ConnectionManagementClient
│       └── persistence/
│           └── in-memory/                    # InMemoryRepository (sin Redis)
├── football-duel/                            # Duelo 1v1 de fútbol
│   ├── interfaces/football-duel.interfaces.ts
│   ├── dto/                                  # check-duel-pads.dto, player-input.dto
│   ├── duel-pad.service.ts                   # Detección de pads (in-memory)
│   ├── duel-engine.service.ts                # Motor de física Matter.js (60 Hz)
│   ├── crown.service.ts                      # Sistema de corona del ganador
│   ├── duel-pad.gateway.ts                   # /map namespace — checkDuelPads
│   ├── football-duel.gateway.ts              # /football-duel namespace
│   └── football-duel.module.ts
├── shooter-arena/                            # Arena shooter 2D
│   ├── interfaces/shooter-arena.interfaces.ts
│   ├── dto/                                  # player-input.dto, check-shooter-zone.dto
│   ├── shooter-engine.service.ts             # Game loop 30 Hz, física, colisiones
│   ├── shooter.gateway.ts                    # /shooter-arena namespace
│   ├── zone.service.ts                       # Detección de zona de entrada
│   ├── collision.service.ts                  # Colisiones proyectil-jugador
│   ├── object-pool.ts                        # Pool de proyectiles (evita GC pauses)
│   ├── spatial-hash.ts                       # Hash espacial O(1) para colisiones
│   └── shooter-arena.module.ts
├── common/guards/                            # JwtAuthGuard (WebSocket)
├── health/                                   # GET /health
├── realtime/                                 # RealtimeModule
├── app.module.ts
└── main.ts
```

### Decisión técnica: almacenamiento in-memory

El servicio usa `InMemoryRepository` (Maps/Sets de Node.js) en lugar de Redis. Esto elimina la latencia de red (~10-30 ms por operación) y la dependencia de un servicio externo. El tradeoff es que el estado no sobrevive reinicios del servidor, lo cual es aceptable para una instancia única.

| Aspecto | Con Redis | Con In-Memory |
|---|---|---|
| Latencia por operación | 10–30 ms (red) | < 1 ms |
| Dependencia externa | Sí | No |
| Persistencia ante reinicio | Sí | No |
| Multi-instancia | Sí | No |

---

## WebSocket API — `/map`

Conectar con JWT válido:

```js
const socket = io('http://localhost:3004/map', {
  auth: { token: 'your-jwt-token' },
  transports: ['websocket'],
});
```

### Eventos entrantes (cliente → servidor)

| Evento | Payload | Descripción |
|---|---|---|
| `joinMap` | `{ x?: number, y?: number }` | Unirse al mapa. Responde con `initialPositions` y emite `userJoined` a todos |
| `leaveMap` | — | Salir del mapa. Elimina presencia y emite `userLeft` |
| `updatePosition` | `{ x: number, y: number }` | Actualizar posición del avatar (throttle: 60 req/s) |
| `sendChat` | `{ message: string }` | Enviar mensaje de chat efímero (máx 500 chars) |
| `checkDuelPads` | `{ x: number, y: number }` | Verificar si el avatar está sobre un pad de duelo |
| `checkShooterZone` | `{ x: number, y: number }` | Verificar si el avatar está en la zona del shooter |
| `clearShooterZone` | — | Limpiar estado de zona al regresar del shooter |

### Eventos salientes (servidor → cliente)

| Evento | Payload | Descripción |
|---|---|---|
| `userJoined` | `{ userId, name, email, x, y, timestamp }` | Un usuario se unió al mapa |
| `userLeft` | `{ userId, timestamp }` | Un usuario salió del mapa |
| `positionUpdate` | `{ userId, x, y, timestamp }` | Otro usuario se movió (no se envía al emisor) |
| `initialPositions` | `AvatarPosition[]` | Todas las posiciones activas, solo al cliente que se une |
| `chatMessage` | `{ userId, name, message, timestamp }` | Nuevo mensaje de chat, broadcast a todos |
| `padStateUpdate` | `PadState[]` | Estado actualizado de los dos pads de duelo |
| `duelStarted` | `{ matchId, player1, player2 }` | Partida iniciada — enviado a ambos jugadores |
| `padBlocked` | `{ padId }` | Pad bloqueado — enviado al jugador que intentó ocuparlo |
| `crownUpdate` | `{ winnerId, winnerName, expiresAt }` | Estado de la corona, broadcast a todos |
| `shooterJoined` | `{ roomId, players }` | El jugador entró a la arena shooter |
| `zoneBlocked` | `{ reason }` | La zona shooter está llena |
| `roomState` | `ShooterRoomState` | Estado actual de la sala shooter (conteo de jugadores) |
| `error` | `{ code, message, timestamp }` | Códigos: `AUTH_ERROR`, `USER_NOT_FOUND`, `VALIDATION_ERROR`, `PROCESSING_ERROR` |

---

## WebSocket API — `/football-duel`

Conectar después de recibir `duelStarted`:

```js
const duelSocket = io('http://localhost:3004/football-duel', {
  auth: { token: 'your-jwt-token' },
  transports: ['websocket'],
});
```

### Eventos entrantes (cliente → servidor)

| Evento | Payload | Descripción |
|---|---|---|
| `joinMatch` | `{ matchId: string }` | Unirse a una partida activa |
| `playerInput` | `{ matchId, action, dx?, dy? }` | Movimiento (`action: 'move'`, `dx`/`dy`: -1\|0\|1) o patada (`action: 'kick'`) |

### Eventos salientes (servidor → cliente)

| Evento | Payload | Descripción |
|---|---|---|
| `matchState` | `FootballDuelState` | Estado completo de la partida, enviado al cliente que se une |
| `snapshot` | `DuelSnapshot` | Estado físico cada ~33 ms (pelota + jugadores + marcador) |
| `goalScored` | `{ scorerId, score }` | Gol detectado — incluye marcador actualizado |
| `matchEnded` | `{ matchId, winnerId, winnerName, isDraw, finalScore }` | Partida terminada |
| `returnToVirtualWorld` | `{ spawnX, spawnY }` | Coordenadas de spawn, enviadas 5 s después del fin |
| `matchNotFound` | `{ matchId }` | Partida no encontrada (ej. reconexión tras reinicio) |

### Cómo funciona el Football Duel

1. Ambos jugadores deben estar en el mapa virtual (`/map`).
2. Cada jugador camina hacia uno de los dos **pads de duelo** (zona inferior-derecha del mapa, `pad-a`: x=620–740, y=540–660 / `pad-b`: x=760–880, y=540–660).
3. Cuando ambos pads están ocupados simultáneamente, la partida inicia automáticamente.
4. Ambos clientes se conectan a `/football-duel` y emiten `joinMatch`.
5. El servidor corre un **loop de física a 60 Hz** (Matter.js) y emite snapshots cada ~33 ms.
6. La partida dura `MATCH_DURATION_SECONDS` (default 180 s). Gana quien más goles marque.
7. Al terminar, ambos jugadores reciben `returnToVirtualWorld` con coordenadas de spawn 5 s después.
8. El ganador recibe una **corona** visible para todos los usuarios del mapa durante `CROWN_TTL_SECONDS` (120 s).

### Constantes de física — Football Duel

| Constante | Valor | Descripción |
|---|---|---|
| `PHYSICS_STEP_MS` | `16.67` | Timestep de física (60 Hz) |
| `SNAPSHOT_INTERVAL_TICKS` | `2` | Snapshot cada 2 ticks (~33 ms) |
| `PLAYER_SPEED` | `5` | Velocidad del jugador en px/tick |
| `KICK_RADIUS` | `60` | Distancia máxima para patear la pelota (px) |
| `MAX_KICK_FORCE` | `0.02` | Fuerza máxima de patada en unidades Matter.js |
| `CROWN_TTL_SECONDS` | `120` | Duración de la corona tras ganar |
| `MATCH_DURATION_SECONDS` | `180` | Duración de la partida (configurable por env) |

### Canvas de la partida

El campo mide **800 × 500 px** con porterías en las paredes izquierda y derecha:

```
Portería izquierda:  { x: 0,   y: 210, width: 20, height: 80 }
Portería derecha:    { x: 780, y: 210, width: 20, height: 80 }

Spawn jugador 1: (200, 250)
Spawn jugador 2: (600, 250)
```

---

## WebSocket API — `/shooter-arena`

Conectar después de recibir `shooterJoined` en el namespace `/map`:

```js
const arenaSocket = io('http://localhost:3004/shooter-arena', {
  auth: { token: 'your-jwt-token' },
  transports: ['websocket'],
});
```

### Eventos entrantes (cliente → servidor)

| Evento | Payload | Descripción |
|---|---|---|
| `joinRoom` | `{ name?: string }` | Unirse a la sala de la arena |
| `playerInput` | `{ action, dx?, dy?, aimDx?, aimDy? }` | Movimiento (`action: 'move'`) o disparo (`action: 'shoot'`) |
| `leaveRoom` | — | Salir voluntariamente de la arena |
| `requestRoomState` | — | Solicitar el estado actual de la sala |

### Eventos salientes (servidor → cliente)

| Evento | Payload | Descripción |
|---|---|---|
| `roomState` | `ShooterRoomState` | Estado completo de la sala (jugadores, estructuras) |
| `snapshot` | `ShooterSnapshot` | Estado físico cada ~33 ms (jugadores + proyectiles) |
| `playerJoined` | `{ userId, name }` | Un jugador se unió a la sala |
| `playerLeft` | `{ userId, activePlayers }` | Un jugador salió de la sala |
| `playerHit` | `{ victimId, attackerId, livesRemaining }` | Un jugador fue golpeado |
| `playerEliminated` | `{ eliminatedId, killerId }` | Un jugador fue eliminado (vidas = 0) |
| `lastPlayerStanding` | `{ userId }` | Último jugador vivo |
| `roomFull` | `{ roomId, maxPlayers }` | Sala llena (máx 6 jugadores) |
| `returnToVirtualWorld` | `{ spawnX, spawnY }` | Coordenadas de spawn al salir/ser eliminado |

### Cómo funciona el Shooter Arena

1. El jugador camina hacia la **zona shooter** en el mapa virtual (x=1200–1350, y=540–690).
2. Después de **2 segundos** dentro de la zona, el servidor emite `shooterJoined` al cliente.
3. El cliente se conecta a `/shooter-arena` y emite `joinRoom`.
4. El servidor corre un **game loop a 30 Hz** y emite snapshots cada ~33 ms.
5. Cada jugador tiene **3 vidas**. Al perderlas todas, recibe `returnToVirtualWorld`.
6. El juego continúa mientras haya jugadores activos. No hay tiempo límite.

### Constantes de juego — Shooter Arena

| Constante | Valor | Descripción |
|---|---|---|
| `ARENA_WIDTH` | `1600` | Ancho del campo en px |
| `ARENA_HEIGHT` | `1200` | Alto del campo en px |
| `MAX_PLAYERS` | `6` | Máximo de jugadores simultáneos |
| `INITIAL_LIVES` | `3` | Vidas iniciales por jugador |
| `PLAYER_SPEED` | `5` | Velocidad del jugador en px/tick |
| `PROJECTILE_SPEED` | `8` | Velocidad del proyectil en px/tick |
| `FIRE_RATE_LIMIT` | `3` | Disparos máximos por segundo |
| `TICK_RATE` | `30` | Ticks por segundo del game loop |
| `TICK_MS` | `33.33` | Duración de cada tick en ms |
| `ZONE_ENTRY_MS` | `2000` | Tiempo de permanencia para entrar a la zona |

### Optimizaciones de rendimiento — Shooter Arena

| Mecanismo | Descripción |
|---|---|
| **Input Queue** | Los event handlers solo hacen `push()`. El game loop drena la cola en cada tick. Evita bloqueos. |
| **Object Pool** | `projectilePool[64]` y `vec2Pool[32]` pre-allocados. Elimina allocaciones de heap por frame y previene GC pauses. |
| **Spatial Hash Grid** | Colisiones proyectil-jugador en O(1) promedio. Reemplaza el loop O(n²) naive. |
| **Buffers pre-allocados** | `snapshotPlayersBuf` y `snapshotProjsBuf` reutilizados en cada tick. Sin `new Array()` en el hot path. |
| **WebSocket sin compresión** | `perMessageDeflate: false` elimina ~2-5 ms de overhead por mensaje. |
| **Transport WebSocket puro** | `transports: ['websocket']` sin polling fallback. |

---

## Escenario de calidad — Rendimiento / Latencia Real-Time

Ver [`QUALITY_SCENARIO.md`](./QUALITY_SCENARIO.md) para la documentación completa del escenario de calidad implementado.

**Resumen:**

| Métrica | Criterio | Resultado medido |
|---|---|---|
| P50 latencia snapshot | ≤ 50 ms | ~31 ms ✅ |
| P95 latencia snapshot | ≤ 100 ms | ~50 ms ✅ |
| P99 latencia snapshot | ≤ 150 ms | ~52 ms ✅ |
| Tick rate bajo carga | ≥ 20 ticks/s | ~24 ticks/s ✅ |
| Saltos de tick | ≤ 5 | 1 (perfecto) ✅ |

---

## Pruebas

```bash
# Load test del escenario de calidad (no requiere servicios externos)
node node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --testPathPatterns=shooter-arena-load --verbose --forceExit

# Todos los tests e2e
npm run test:e2e

# Tests unitarios
npm run test

# Cobertura
npm run test:cov
```

El load test levanta la app NestJS internamente en un puerto libre, simula 6 clientes WebSocket concurrentes durante 5 segundos y valida los criterios de latencia y estabilidad del game loop.

---

## Notas de implementación

- **Almacenamiento in-memory.** `InMemoryRepository` reemplaza Redis. Todo el estado vive en Maps/Sets de Node.js. El estado se pierde al reiniciar el servidor.
- **`leaveMap` vs disconnect.** La eliminación del usuario se dispara tanto por el evento explícito `leaveMap` como por el hook `handleDisconnect`. Ambos llaman a `realtimeService.handleUserLeave` y emiten `userLeft`.
- **JWT guard preserva `client.data.user`.** El guard hace `{ ...existingData, ...jwtPayload }` para que campos como `name` (seteado por `joinMap`) se preserven entre eventos.
- **Fin de partida idempotente.** El flag `MatchInstance.ended` previene que `endMatch` se ejecute dos veces si el timer y un disconnect ocurren simultáneamente.
- **Socket IDs capturados antes de destruir la partida.** `returnToVirtualWorld` usa IDs capturados antes de `destroyMatch`, ya que la sala de Socket.IO se limpia al destruir.
- **Reconexión en Shooter Arena.** Si un jugador se desconecta, tiene 10 segundos para reconectarse y recuperar su estado (vidas, posición, kills).
- **Anti-cheat de velocidad.** El servidor valida que la velocidad de los jugadores no supere `MAX_SPEED_VIOLATION` (50 px/tick). Inputs inválidos se descartan silenciosamente.
- **Tick rate en Windows.** `setInterval` en Windows tiene resolución de ~15 ms. El game loop de 30 Hz puede observarse a 20-27 Hz en Windows bajo carga. Esto es comportamiento normal del SO, no degradación del sistema.

---

## Health check

```bash
curl http://localhost:3004/health
```

```json
{
  "status": "ok",
  "storage": "in-memory",
  "timestamp": "2026-05-22T21:00:00.000Z"
}
```

---

## Prueba manual

Abre `test-client.html` directamente en el navegador para probar eventos WebSocket de forma interactiva. Ábrelo en dos pestañas para simular múltiples usuarios.

---

## Licencia

[MIT](./LICENSE)
