# Escenario de Calidad — Rendimiento / Latencia en Tiempo Real

## 1. Escenario de Calidad

| Campo | Descripción |
|---|---|
| **Atributo de calidad** | Rendimiento / Latencia en Tiempo Real |
| **Fuente del estímulo** | 6 jugadores concurrentes conectados al Shooter Arena |
| **Estímulo** | Cada jugador envía inputs de movimiento y disparo a 20 req/s de forma sostenida durante ≥ 5 segundos |
| **Entorno** | Servidor NestJS + Socket.IO en instancia única, estado 100% in-memory |
| **Artefacto** | `ShooterEngineService` + `ShooterGateway` (namespace `/shooter-arena`) |
| **Respuesta** | El servidor procesa todos los inputs en el mismo tick y emite un snapshot de estado a todos los clientes conectados |
| **Medida de respuesta** | Latencia de snapshot: **P50 ≤ 50 ms**, **P95 ≤ 100 ms**, **P99 ≤ 150 ms**. Tick rate sostenido ≥ 25 ticks/s (tolerancia 17% sobre 30 Hz nominal) |

---

## 2. Justificación del Escenario

El Shooter Arena es el componente de mayor exigencia de rendimiento del microservicio. Combina:

- **Concurrencia real**: hasta 6 jugadores enviando inputs simultáneamente
- **Procesamiento real-time**: game loop a 30 Hz que debe procesar todos los inputs y emitir snapshots dentro de cada ventana de 33 ms
- **Acceso simultáneo**: todos los clientes reciben el mismo snapshot broadcast en el mismo instante

Si el game loop se degrada (tick rate cae, latencia sube), los jugadores experimentan lag perceptible, lo que destruye la experiencia de juego.

---

## 3. Arquitectura Actualizada — Cómo los Componentes Soportan el Escenario

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cliente (Browser / Test)                          │
│  Socket.IO Client — transports: ['websocket'] — sin polling, sin gzip   │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ WebSocket (sin compresión = menor latencia)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ShooterGateway  (/shooter-arena)                      │
│                                                                          │
│  • Recibe evento playerInput                                             │
│  • NO procesa lógica — solo llama engine.handlePlayerInput()             │
│  • Desacoplamiento total: el gateway es solo un adaptador de entrada     │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ push a inputQueue[]
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ShooterEngineService                                │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  INPUT QUEUE (array pre-allocado)                               │    │
│  │  • Event handlers solo hacen push() — O(1), sin bloqueo        │    │
│  │  • El game loop drena la cola en cada tick                      │    │
│  │  • Evita condiciones de carrera: un solo hilo JS procesa        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  GAME LOOP FIJO — setInterval(tick, 33ms) = 30 Hz              │    │
│  │                                                                  │    │
│  │  Cada tick:                                                      │    │
│  │  1. processInputQueue()  — drena inputs acumulados              │    │
│  │  2. updatePlayers()      — física in-place, sin new Object()    │    │
│  │  3. updateProjectiles()  — spatial hash + object pool           │    │
│  │  4. checkLastStanding()  — early exit O(n)                      │    │
│  │  5. checkSurvivalRewards() — throttled cada 30 ticks            │    │
│  │  6. emitSnapshot()       — buffers pre-allocados                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐     │
│  │  OBJECT POOL         │  │  SPATIAL HASH GRID                   │     │
│  │  projectilePool[64]  │  │  cellSize=80px                       │     │
│  │  vec2Pool[32]        │  │  Colisiones O(1) avg vs O(n²) naive  │     │
│  │  Elimina GC pauses   │  │  clear() reutiliza arrays (len=0)    │     │
│  └──────────────────────┘  └──────────────────────────────────────┘     │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  SNAPSHOT BUFFERS PRE-ALLOCADOS                                 │    │
│  │  snapshotPlayersBuf[] y snapshotProjsBuf[] reutilizados         │    │
│  │  Evita allocaciones de heap en el hot path de emisión           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ server.to(ROOM_ID).emit('snapshot', ...)
                             │ broadcast a todos los clientes en O(1)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Socket.IO Server (NestJS)                             │
│  • perMessageDeflate: false  → sin overhead de compresión               │
│  • transports: ['websocket'] → sin polling fallback                     │
│  • maxHttpBufferSize: 1MB    → snapshots pequeños, sin fragmentación    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Mecanismos de rendimiento implementados

| Mecanismo | Componente | Beneficio |
|---|---|---|
| **Input Queue desacoplada** | `ShooterEngineService.inputQueue` | Los event handlers nunca bloquean el game loop. Inputs se acumulan entre ticks y se procesan en batch. |
| **Game loop fijo (30 Hz)** | `setInterval(tick, TICK_MS)` | Timestep determinístico. El servidor no procesa más rápido de lo necesario, evitando CPU waste. |
| **Object Pool** | `projectilePool[64]`, `vec2Pool[32]` | Elimina allocaciones de heap por frame. Sin GC pauses que causen jank. |
| **Spatial Hash Grid** | `SpatialHashGrid(cellSize=80)` | Colisiones proyectil-jugador en O(1) promedio. Con 6 jugadores y ~20 proyectiles activos, evita 120 comparaciones por tick. |
| **Buffers pre-allocados** | `snapshotPlayersBuf`, `snapshotProjsBuf` | El snapshot se construye reutilizando arrays (`.length = 0`), sin `new Array()` en el hot path. |
| **WebSocket sin compresión** | `perMessageDeflate: false` | Elimina ~2-5 ms de overhead de compresión/descompresión por mensaje. Crítico para latencia. |
| **Transport WebSocket puro** | `transports: ['websocket']` | Sin HTTP polling fallback. Conexión directa, sin overhead de HTTP headers. |
| **Anti-cheat en tick** | Validación de velocidad máxima | Previene que inputs maliciosos sobrecarguen el servidor con velocidades imposibles. |

---

## 4. Prueba Técnica

### Archivo
`test/shooter-arena-load.e2e-spec.ts`

### Cómo ejecutar

```bash
# Desde la carpeta peerly-realtime-management
npm run test:load
```

> No requiere Redis ni ningún servicio externo. Todo el estado es in-memory.

### Qué hace el test

El test levanta la aplicación NestJS completa en un puerto libre (sin conflicto con la instancia de desarrollo) y ejecuta 5 casos:

| Test | Descripción | Criterio |
|---|---|---|
| **Test 1** | Conexión concurrente de 6 clientes | 0 rechazos de conexión |
| **Test 2** | Game loop activo bajo carga sostenida 5s | ≥ 1 snapshot/s por cliente |
| **Test 3** | Latencia de snapshot bajo carga máxima | P50 ≤ 50ms, P95 ≤ 100ms, P99 ≤ 150ms |
| **Test 4** | Estabilidad del tick rate | ≥ 25 ticks/s, saltos ≤ 5 ticks |
| **Test 5** | Resumen ejecutivo del escenario | Imprime tabla de resultados |

### Metodología de medición de latencia

```
Cliente i                          Servidor
    │                                  │
    │── playerInput (t=sendTime) ──►   │
    │                                  │  procesa en próximo tick
    │                                  │  (máx 33ms después)
    │   ◄── snapshot (timestamp) ──    │
    │                                  │
latencia = Date.now() - sendTime
```

La latencia medida es el tiempo desde que el cliente envía un input hasta que recibe el siguiente snapshot. Esto captura:
- Tiempo de transmisión del input al servidor
- Tiempo de espera hasta el próximo tick del game loop
- Tiempo de procesamiento del tick
- Tiempo de transmisión del snapshot al cliente

### Ejemplo de salida esperada

```
  [Latencia] Resultados del test de latencia:
    Muestras totales : 580
    Mínima           : 8 ms
    Promedio         : 28.4 ms
    P50 (mediana)    : 24 ms  (límite: 50 ms)
    P95              : 67 ms  (límite: 100 ms)
    P99              : 89 ms  (límite: 150 ms)
    Máxima           : 112 ms

  [Tick Rate] Resultados de estabilidad del game loop:
    Ticks observados : 148
    Tiempo medido    : 4.97 s
    Tick rate real   : 29.8 ticks/s (esperado: ~30)
    Mayor salto tick : 2 (ideal: 1)
```

---

## 5. Relación con la Arquitectura Hexagonal

El escenario de calidad está soportado por la separación de capas:

```
┌─────────────────────────────────────────────────────┐
│  Infrastructure (in)                                 │
│  ShooterGateway — adaptador WebSocket               │
│  Solo traduce eventos a llamadas de dominio          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Application                                         │
│  ShooterEngineService — lógica de negocio            │
│  Input Queue + Game Loop + Object Pool               │
│  Toda la optimización de rendimiento vive aquí       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Infrastructure (out)                                │
│  CollisionService — algoritmos de colisión           │
│  SpatialHashGrid — estructura de datos optimizada    │
│  ObjectPool — gestión de memoria                     │
└─────────────────────────────────────────────────────┘
```

Esta separación permite que el test de carga pruebe el `ShooterEngineService` de forma aislada (sin depender de Redis para la lógica del game loop), y que los mecanismos de rendimiento sean intercambiables sin afectar la interfaz del gateway.
