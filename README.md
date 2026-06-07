<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center">Box.io Backend</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11.x-red.svg" alt="NestJS" />
  <img src="https://img.shields.io/badge/Socket.IO-4.x-black.svg" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Matter.js-0.20-blue.svg" alt="Matter.js" />
  <img src="https://img.shields.io/badge/storage-in--memory-green.svg" alt="In-Memory" />
  <img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="License" />
</p>

---

## Descripción

Backend NestJS que gestiona toda la comunicación en tiempo real. Expone namespaces WebSocket:

| Namespace | Propósito |
|---|---|
| `/map` | Presencia de avatares, chat efímero, detección de zonas de juego |
| `/shooter-arena` | Arena shooter 2D multijugador (hasta 6 jugadores) |
| `/football-duel` | Duelo 1v1 con física autoritativa (Matter.js 60 Hz) |
| `/duel-pad` | Detección de pads de activación de duelo |

Todo el estado efímero se almacena **en memoria** (Maps/Sets de Node.js).

---

## Arquitectura

**Clean Architecture con features**. Cada feature es un bounded context autocontenido con sus capas de dominio, aplicación e infraestructura.

```
src/
├── common/                                        # Shared Kernel
│   ├── config/cors.config.ts
│   ├── guards/                                    # JwtAuthGuard, HttpJwtAuthGuard
│   ├── middleware/ws-auth.middleware.ts
│   └── decorators/current-user.decorator.ts
│
├── config/database.config.ts                      # TypeORM PostgreSQL config
├── featureFlags.ts                                # Feature toggles
│
├── features/                                      # <<< TODOS los bounded contexts >>>
│   │
│   ├── auth/                                      # Autenticación (REST)
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts                        # Login, register, refresh
│   │   └── dto/
│   │
│   ├── users/                                     # Gestión de usuarios (REST)
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── domain/user.entity.ts                   # TypeORM entity
│   │   ├── application/users.service.ts
│   │   └── dto/public-user.ts
│   │
│   ├── leaderboard/                               # Leaderboard (REST)
│   │   ├── leaderboard.module.ts
│   │   ├── leaderboard.controller.ts
│   │   ├── domain/leaderboard-entry.entity.ts
│   │   └── application/leaderboard.service.ts
│   │
│   ├── connections/                               # Conexiones sociales (REST)
│   │   ├── connections.module.ts
│   │   ├── connections.controller.ts
│   │   ├── domain/connection-request.entity.ts
│   │   └── application/connections.service.ts
│   │
│   ├── virtual-world/                             # Mapa virtual + chat (WebSocket)
│   │   ├── virtual-world.module.ts                 # @Global — shared services
│   │   ├── domain/
│   │   │   └── entities/                          # AvatarPosition, Presence, ChatMessage
│   │   ├── application/
│   │   │   ├── services/realtime.service.ts
│   │   │   ├── use-cases/                         # JoinMap, UpdatePosition, SendChat
│   │   │   ├── dtos/
│   │   │   └── interfaces/events.interface.ts
│   │   └── infrastructure/
│   │       ├── adapters/
│   │       │   ├── in/virtual-map.gateway.ts      # WebSocket /map
│   │       │   └── out/http/user-management.client.ts
│   │       └── persistence/in-memory/             # InMemoryRepository
│   │
│   ├── shooter-arena/                             # Shooter 2D multijugador (WebSocket)
│   │   ├── shooter-arena.module.ts
│   │   ├── domain/
│   │   │   ├── entities/shooter-arena.types.ts    # Interfaces del dominio
│   │   │   ├── ports/game-config.port.ts          # Puerto de configuración
│   │   │   └── config/                            # ← GAME CONFIG (JSON)
│   │   │       ├── weapons.json                   # Stats de armas
│   │   │       ├── items.json                     # Shield, power-ups
│   │   │       ├── arena-config.json              # Tamaño, XP, badges, spawns
│   │   │       └── cover-structures.ts            # Mapa de obstáculos
│   │   ├── application/
│   │   │   └── services/
│   │   │       ├── shooter-engine.service.ts      # Game loop 30 Hz
│   │   │       ├── collision.service.ts           # Colisiones
│   │   │       └── zone.service.ts                # Detección de zona de entrada
│   │   └── infrastructure/
│   │       ├── adapters/
│   │       │   ├── in/shooter.gateway.ts          # WebSocket /shooter-arena
│   │       │   └── out/game-config-file.adapter.ts # Lee JSON de config
│   │       ├── persistence/
│   │       │   └── object-pool.ts                 # Pool de proyectiles
│   │       └── utils/
│   │           ├── spatial-hash.ts                # Hash espacial O(1)
│   │           └── snapshot.utils.ts
│   │
│   ├── football-duel/                             # Duelo fútbol 1v1 (WebSocket)
│   │   ├── football-duel.module.ts
│   │   ├── interfaces/
│   │   ├── duel-engine.service.ts                 # Motor Matter.js 60 Hz
│   │   ├── duel-pad.service.ts
│   │   ├── crown.service.ts
│   │   ├── duel-pad.gateway.ts
│   │   └── football-duel.gateway.ts
│   │
│   └── health/                                    # Health check
│       ├── health.module.ts
│       ├── health.controller.ts
│       └── health.service.ts
│
├── app.module.ts
└── main.ts
```

### Principios arquitectónicos

| Principio | Aplicación |
|---|---|
| **Clean Architecture** | Cada feature tiene `domain/` (entidades, puertos), `application/` (casos de uso, servicios), `infrastructure/` (adaptadores, persistencia) |
| **Server-authoritative** | Todo el estado y la lógica de juego se validan en el servidor. El cliente solo renderiza. |
| **Game Config JSON** | Las propiedades de armas, items y balance del juego están en archivos JSON dentro de `domain/config/`. El servidor los carga al iniciar y el cliente los recibe al conectarse. **Sin constantes duplicadas.** |
| **Ports & Adapters** | `GameConfigPort` es la interfaz; `GameConfigFileAdapter` es la implementación que lee JSON. Fácil cambiar a DB o API externa. |
| **In-Memory State** | `InMemoryRepository` almacena todo el estado efímero (presencia, posiciones, partidas activas). Sin Redis. |
| **Object Pooling** | `projectilePool` reusa objetos en vez de crear nuevos en cada frame. Elimina GC pauses. |
| **Spatial Hash Grid** | Colisiones O(1) promedio vs O(n²). |

---

## Configuración de armas e items

Las propiedades de armas e items se definen en archivos JSON. **Para modificarlas, edita estos archivos:**

### `src/features/shooter-arena/domain/config/weapons.json`

```json
{
  "normal":   { "damage": 18, "speed": 8,  "fireRate": 3, "ammo": null },
  "shotgun":  { "damage": 33, "speed": 8,  "fireRate": 1, "pellets": 3, "spread": 0.25, "ammo": 6 },
  "rocket":   { "damage": 60, "speed": 5,  "fireRate": 1, "explosionRadius": 120, "ammo": 3 },
  "laser":    { "damage": 55, "speed": 50, "fireRate": 2, "ammo": 2 }
}
```

### `src/features/shooter-arena/domain/config/items.json`

```json
{
  "shield": { "durationMs": 15000 },
  "health": { "restoreAmount": 40 }
}
```

### `src/features/shooter-arena/domain/config/arena-config.json`

```json
{
  "arena":      { "width": 1600, "height": 1200 },
  "player":     { "radius": 20, "speed": 5, "maxHealth": 100 },
  "projectile": { "radius": 6 },
  "gameplay":   { "maxPlayers": 6, "tickRate": 30, "fireRateLimit": 3, ... },
  "xp":         { "perKill": 50, "survival5min": 100, "survivalMs": 300000 },
  "badges":     { "killsThreshold": 5, "survivalMs": 600000 },
  ...
}
```

> **Nota:** El servidor envía el game config a los clientes al conectarse. No es necesario duplicar constantes en el frontend.

---

## Instalación

```bash
npm install --legacy-peer-deps
cp .env.example .env
```

> **Importante:** `JWT_SECRET` debe coincidir con el valor usado en el auth service.

---

## Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto HTTP/WebSocket | `3004` |
| `SWAGGER_PORT` | Puerto Swagger | `3005` |
| `JWT_SECRET` | Secreto JWT | — |
| `CORS_ORIGINS` | Orígenes CORS permitidos | `http://localhost:5173,http://localhost:4173` |
| `DATABASE_URL` | URL PostgreSQL | — |
| `FOOTBALL_DUEL_ENABLED` | Habilita el minijuego de fútbol | `false` |

Ver `.env.example` para todas las variables.

---

## Ejecutar

```bash
npm run start:dev    # Desarrollo con watch
npm run start        # Producción
```

| Recurso | URL |
|---|---|
| API REST / Swagger UI | `http://localhost:3004/api-docs` |
| WebSocket mapa virtual | `ws://localhost:3004/map` |
| WebSocket shooter arena | `ws://localhost:3004/shooter-arena` |
| Health check | `http://localhost:3004/health` |

---

## WebSocket API — `/map`

Conectar con JWT:

```js
const socket = io('http://localhost:3004/map', {
  auth: { token: 'jwt-token' },
  transports: ['websocket'],
});
```

### Eventos entrantes

| Evento | Payload | Descripción |
|---|---|---|
| `joinMap` | `{ x?, y? }` | Unirse al mapa |
| `leaveMap` | — | Salir del mapa |
| `updatePosition` | `{ x, y }` | Actualizar posición (throttle 60 req/s) |
| `sendChat` | `{ message }` | Enviar chat (máx 500 chars) |
| `checkShooterZone` | `{ x, y }` | Detectar zona shooter |
| `clearShooterZone` | — | Limpiar estado de zona |

### Eventos salientes

| Evento | Payload |
|---|---|
| `userJoined` | `{ userId, name, email, x, y, timestamp }` |
| `userLeft` | `{ userId, timestamp }` |
| `positionUpdate` | `{ userId, x, y, timestamp }` |
| `initialPositions` | `AvatarPosition[]` |
| `chatMessage` | `{ userId, name, message, timestamp }` |
| `shooterJoined` | `{ roomId, players }` |
| `zoneBlocked` | `{ reason }` |
| `roomState` | `ShooterRoomState` |
| `error` | `{ code, message, timestamp }` |

---

## WebSocket API — `/shooter-arena`

Conectar después de recibir `shooterJoined`:

```js
const arena = io('http://localhost:3004/shooter-arena', {
  auth: { token: 'jwt-token' },
  transports: ['websocket'],
});
```

### Eventos entrantes

| Evento | Payload | Descripción |
|---|---|---|
| `joinRoom` | `{ name? }` | Unirse a la sala |
| `playerInput` | `{ action, dx?, dy?, aimDx?, aimDy?, weaponType? }` | Movimiento/disparo |
| `leaveRoom` | — | Salir de la arena |
| `requestRoomState` | — | Estado actual |
| `collectItem` | `{ itemType, x, y }` | Recoger un pickup del mapa |

### Eventos salientes

| Evento | Payload |
|---|---|
| `roomState` | `ShooterRoomState` |
| `snapshot` | `ShooterSnapshot` (~33 ms) |
| `playerJoined` | `{ userId, name }` |
| `playerLeft` | `{ userId, activePlayers }` |
| `playerHit` | `{ victimId, attackerId, healthRemaining }` |
| `playerEliminated` | `{ eliminatedId, killerId }` |
| `lastPlayerStanding` | `{ userId }` |
| `roomFull` | `{ roomId, maxPlayers }` |
| `returnToVirtualWorld` | `{ spawnX, spawnY }` |
| `rocketExplosion` | `{ x, y, radius }` |
| `shieldAbsorbed` | `{ victimId }` |
| `pickupState` | `PickupBox[]` — estado actual de las cajas en el mapa |
| `pickupCollected` | `{ x, y, type }` — una caja fue recogida |

---

## Sistema de salud

El jugador tiene **100 HP** (`maxHealth` en `arena-config.json`). Al recibir daño se reduce el HP; al llegar a 0 el jugador es eliminado y expulsado de la arena. **No hay teletransporte intermedio** al recibir daño — solo eliminación definitiva.

| Arma | Daño | Disparos para eliminar |
|---|---|---|
| Normal | 18 | 6 |
| Shotgun | 33 por perdigón (×3) | 2-4 |
| Rocket | 60 (explosión) | 2 |
| Laser | 55 | 2 |

**Health pickup** — restaura 40 HP (configurable en `items.json`). Solo aparece si el jugador tiene menos del máximo.

## Pickups server-authoritative

Las cajas de pickup son gestionadas completamente por el servidor:
- El servidor spawnea hasta 3 cajas simultáneas en posiciones pre-definidas, con timeout de 10s
- Cada 500ms emite `pickupState` con el array actual de cajas a todos los clientes
- Cuando un jugador recoge una caja, el servidor valida, la elimina del estado global y emite `pickupCollected` a **todos** los jugadores
- El efecto se aplica según el tipo: health (restaura HP en servidor), shield (activa escudo), armas (asignación local de munición)

---

## Optimizaciones de rendimiento — Shooter Arena

| Mecanismo | Descripción |
|---|---|
| **Input Queue** | Event handlers solo hacen `push()`. El game loop drena la cola en cada tick. |
| **Object Pool** | `projectilePool[96]` pre-allocado. Sin GC pauses. |
| **Spatial Hash Grid** | Colisiones O(1) promedio. |
| **Buffers reutilizados** | `snapshotPlayersBuf`, `snapshotProjsBuf`. Sin allocaciones en el hot path. |
| **Anti-cheat** | Validación de velocidad máxima por el servidor. |

---

## Pruebas

```bash
npm run test        # Tests unitarios
npm run test:e2e    # Tests e2e
npm run test:cov    # Cobertura
```

---

## ⚠️ Servicio STATEFUL

> **Instancia única obligatoria.** Toda la presencia, posiciones, matches y corona viven en el proceso de Node.js.

Para escalar horizontalmente:
1. Añadir `@socket.io/redis-adapter`
2. Migrar `InMemoryRepository` a Redis/Postgres
3. Configurar sticky sessions en el load balancer

---

## Licencia

[MIT](./LICENSE)
