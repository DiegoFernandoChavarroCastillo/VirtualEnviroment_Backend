# Football Duel 1v1 — Peerly

Mini-juego de fútbol 1v1 integrado en el entorno virtual de Peerly.

---

## Flujo completo (dos clientes)

1. Abre dos ventanas del navegador e inicia sesión con dos cuentas distintas.
2. Ambos jugadores deben estar en el **Entorno Virtual** (mapa principal).
3. Navega hasta la zona inferior-derecha del mapa (alrededor de x=610, y=420).
4. Verás dos cajitas verdes con el texto **"Fútbol 1v1"** — **Cancha A** y **Cancha B**.
5. Cada jugador se para sobre una cajita diferente.
6. Después de **2 segundos continuos** (verás la barra de progreso y el contador), ambos son transportados automáticamente a la pantalla del partido.
7. Juega durante **3 minutos**. El jugador con más goles gana.
8. Al terminar, ambos regresan al mapa. El ganador lleva una **corona dorada** visible para todos durante **2 minutos**.

---

## Controles del partido

| Tecla | Acción |
|-------|--------|
| `W` / `↑` | Mover arriba |
| `S` / `↓` | Mover abajo |
| `A` / `←` | Mover izquierda |
| `D` / `→` | Mover derecha |
| `Espacio` | Patear el balón (si estás a ≤ 60 px) |

---

## Variables de entorno (backend)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `MATCH_DURATION_SECONDS` | `180` | Duración del partido en segundos |
| `REDIS_HOST` | `localhost` | Host de Redis |
| `REDIS_PORT` | `6379` | Puerto de Redis |
| `JWT_SECRET` | `dev-secret-key` | Secreto JWT (debe coincidir con el auth service) |

---

## Variable de entorno (frontend)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `VITE_REALTIME_URL` | `http://localhost:3001` | URL del microservicio realtime |

---

## Ajustar duración del partido

En `peerly-realtime-management/.env`:
```
MATCH_DURATION_SECONDS=120
```

## Ajustar duración de la corona

En `peerly-realtime-management/src/football-duel/interfaces/football-duel.interfaces.ts`:
```typescript
export const CROWN_TTL_SECONDS = 120; // cambiar a los segundos deseados
```

---

## Ejecutar property-based tests

```bash
# Desde peerly-realtime-management/
npm run test -- --testPathPattern=football-duel

# Desde peerly-frontend-/
npm run test -- --testPathPattern=football-duel
```

---

## Arquitectura del módulo

```
src/football-duel/
├── interfaces/
│   └── football-duel.interfaces.ts   # Tipos, interfaces y constantes compartidas
├── dto/
│   ├── check-duel-pads.dto.ts        # DTO para evento checkDuelPads
│   └── player-input.dto.ts           # DTO para evento playerInput
├── duel-pad.service.ts               # Detección de presencia en pads, activación
├── duel-engine.service.ts            # Motor de física Matter.js autoritativo (60 Hz)
├── crown.service.ts                  # Gestión de la corona del ganador
├── duel-pad.gateway.ts               # Gateway /map — handler checkDuelPads
├── football-duel.gateway.ts          # Gateway /football-duel — partido 1v1
├── football-duel.module.ts           # Módulo NestJS
├── snapshot.utils.ts                 # Serialización y validación de snapshots
└── README.md                         # Este archivo
```

```
src/features/football-duel/
├── types/
│   └── football-duel.types.ts        # Tipos TypeScript + utilidades (lerp, formatTime)
├── hooks/
│   ├── useFootballSocket.ts          # Socket /football-duel
│   ├── useDuelSnapshot.ts            # Buffer de snapshots + interpolación LERP
│   └── useDuelPhysics.ts             # Client-side prediction + reconciliación
└── components/
    ├── DuelPads.tsx                  # Renderizado de cajitas en el mapa
    ├── Crown.tsx                     # Corona dorada sobre el avatar
    └── FootballDuelMatch.tsx         # Pantalla completa del partido
```

---

## Eventos WebSocket

### Namespace `/map`

| Evento | Dirección | Descripción |
|--------|-----------|-------------|
| `checkDuelPads` | C→S | Posición del jugador para verificar solapamiento |
| `padStateUpdate` | S→C | Estado actualizado de los dos pads (broadcast) |
| `duelStarted` | S→C | Partido iniciado (a los dos jugadores) |
| `padBlocked` | S→C | Pad bloqueado (al jugador que intentó ocuparlo) |
| `crownUpdate` | S→C | Estado de la corona (broadcast) |

### Namespace `/football-duel`

| Evento | Dirección | Descripción |
|--------|-----------|-------------|
| `joinMatch` | C→S | Unirse a un partido activo |
| `playerInput` | C→S | Input de movimiento o kick |
| `matchState` | S→C | Estado inicial del partido |
| `snapshot` | S→C | Estado físico cada ~70 ms |
| `goalScored` | S→C | Gol detectado + marcador |
| `matchEnded` | S→C | Partido finalizado + ganador |
| `returnToVirtualWorld` | S→C | Coordenadas de reaparición |
| `matchNotFound` | S→C | Partido no encontrado |
