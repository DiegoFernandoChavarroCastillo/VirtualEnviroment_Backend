/**
 * ============================================================================
 * LOAD TEST — Shooter Arena: Concurrencia y Latencia en Tiempo Real
 * ============================================================================
 *
 * Escenario de Calidad:
 *   El servidor debe manejar hasta MAX_PLAYERS (6) jugadores concurrentes en
 *   la Shooter Arena, procesando inputs y emitiendo snapshots de estado con
 *   una latencia máxima de 100 ms por ciclo de tick (30 Hz), sin degradación
 *   perceptible del game loop durante al menos 5 segundos de carga sostenida.
 *
 * Criterios de aceptación:
 *   ✅ P50 (mediana) de latencia snapshot ≤ 50 ms
 *   ✅ P95 de latencia snapshot ≤ 100 ms
 *   ✅ P99 de latencia snapshot ≤ 150 ms
 *   ✅ Todos los clientes reciben al menos 1 snapshot/s
 *   ✅ El game loop no se detiene bajo carga sostenida de 6 jugadores
 *
 * Técnica: Functional Load Test con socket.io-client simulando N clientes
 * concurrentes. No requiere servidor externo — levanta la app NestJS en memoria.
 * ============================================================================
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import {
  MAX_PLAYERS,
  TICK_MS,
} from '../src/shooter-arena/interfaces/shooter-arena.interfaces';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Espera N ms. */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Calcula percentil de un array de números ya ordenado. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── Constantes del test ──────────────────────────────────────────────────────

const TEST_DURATION_MS = 5_000;   // 5 segundos de carga sostenida
const INPUT_INTERVAL_MS = 50;     // cada cliente envía input cada 50 ms (20 req/s)
const SNAPSHOT_LATENCY_P50 = 50;  // ms — criterio P50
const SNAPSHOT_LATENCY_P95 = 100; // ms — criterio P95
const SNAPSHOT_LATENCY_P99 = 150; // ms — criterio P99
const MIN_SNAPSHOTS_PER_CLIENT = Math.floor(TEST_DURATION_MS / 1000); // ≥1 snapshot/s

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Shooter Arena — Load Test (Concurrencia y Latencia)', () => {
  let app: INestApplication;
  let serverPort: number;
  let jwtService: JwtService;

  // ── Setup: levanta la app NestJS en un puerto libre ──────────────────────
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.enableCors({ origin: '*' });

    // Puerto 0 = SO asigna uno libre (evita conflictos con instancia dev)
    await app.listen(0);
    const address = app.getHttpServer().address();
    serverPort = typeof address === 'object' && address ? address.port : 3099;

    // Obtener JwtService para generar tokens de prueba
    jwtService = app.get(JwtService);

    console.log(`\n[LoadTest] Servidor levantado en puerto ${serverPort}`);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  }, 15_000);

  // ── Genera un JWT válido para el test ────────────────────────────────────
  function makeToken(userId: string): string {
    return jwtService.sign(
      { sub: userId, email: `${userId}@loadtest.com` },
      { secret: process.env.JWT_SECRET || 'dev-secret-key', expiresIn: '1h' },
    );
  }

  /** Crea y conecta un socket con JWT en el handshake */
  function createSocket(userId: string): Promise<Socket> {
    const token = makeToken(userId);
    return new Promise((resolve, reject) => {
      const s = io(`http://localhost:${serverPort}/shooter-arena`, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
        auth: { token },
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) =>
        reject(new Error(`Socket ${userId} falló: ${err.message}`)),
      );
    });
  }

  /** Une un socket a la sala y espera confirmación (roomState) */
  function joinRoom(socket: Socket, userId: string, name: string): Promise<void> {
    return new Promise((resolve) => {
      socket.emit('joinRoom', { name });
      socket.once('roomState', () => resolve());
      // Fallback: si no llega roomState en 1s, continuar de todas formas
      setTimeout(resolve, 1000);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Conexión concurrente de MAX_PLAYERS clientes
  // ─────────────────────────────────────────────────────────────────────────
  it(
    `debe aceptar ${MAX_PLAYERS} conexiones WebSocket concurrentes sin rechazar ninguna`,
    async () => {
      const sockets: Socket[] = [];

      try {
        // Conectar todos los clientes en paralelo
        const connectPromises = Array.from({ length: MAX_PLAYERS }, (_, i) =>
          createSocket(`conn-user-${i}`),
        );

        const connected = await Promise.all(connectPromises);
        sockets.push(...connected);

        expect(sockets.length).toBe(MAX_PLAYERS);
        console.log(`  ✓ ${MAX_PLAYERS} clientes conectados simultáneamente`);
      } finally {
        sockets.forEach(s => s.disconnect());
        await sleep(200);
      }
    },
    15_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Game loop activo bajo carga de MAX_PLAYERS jugadores
  // ─────────────────────────────────────────────────────────────────────────
  it(
    `el game loop debe mantenerse activo con ${MAX_PLAYERS} jugadores durante ${TEST_DURATION_MS / 1000}s`,
    async () => {
      const sockets: Socket[] = [];
      const snapshotCounts: number[] = new Array(MAX_PLAYERS).fill(0);

      try {
        // 1. Conectar clientes
        for (let i = 0; i < MAX_PLAYERS; i++) {
          sockets.push(await createSocket(`loop-user-${i}`));
        }

        // 2. Unir a la sala
        await Promise.all(
          sockets.map((s, i) => joinRoom(s, `loop-user-${i}`, `LoopBot${i}`)),
        );

        // 3. Contar snapshots recibidos por cada cliente
        sockets.forEach((s, i) => {
          s.on('snapshot', () => { snapshotCounts[i]++; });
        });

        // 4. Simular inputs continuos durante TEST_DURATION_MS
        const inputIntervals = sockets.map((s) =>
          setInterval(() => {
            const dx = Math.random() > 0.5 ? 1 : -1;
            const dy = Math.random() > 0.5 ? 1 : -1;
            s.emit('playerInput', { action: 'move', dx, dy });
            if (Math.random() < 0.2) {
              s.emit('playerInput', { action: 'shoot', aimDx: dx, aimDy: dy });
            }
          }, INPUT_INTERVAL_MS),
        );

        // 5. Esperar duración del test
        await sleep(TEST_DURATION_MS);

        // 6. Detener inputs
        inputIntervals.forEach(clearInterval);

        // 7. Verificar que todos los clientes recibieron snapshots
        console.log('\n  [Game Loop] Snapshots recibidos por cliente:');
        snapshotCounts.forEach((count, i) => {
          console.log(`    Cliente ${i}: ${count} snapshots`);
          expect(count).toBeGreaterThanOrEqual(MIN_SNAPSHOTS_PER_CLIENT);
        });

        const totalSnapshots = snapshotCounts.reduce((a, b) => a + b, 0);
        const expectedMin = MAX_PLAYERS * MIN_SNAPSHOTS_PER_CLIENT;
        console.log(`  ✓ Total snapshots: ${totalSnapshots} (mínimo esperado: ${expectedMin})`);
        expect(totalSnapshots).toBeGreaterThanOrEqual(expectedMin);
      } finally {
        sockets.forEach(s => s.disconnect());
        await sleep(300);
      }
    },
    TEST_DURATION_MS + 20_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Latencia de snapshot bajo carga (P50 / P95 / P99)
  // ─────────────────────────────────────────────────────────────────────────
  it(
    `la latencia de snapshot debe cumplir P50≤${SNAPSHOT_LATENCY_P50}ms, P95≤${SNAPSHOT_LATENCY_P95}ms, P99≤${SNAPSHOT_LATENCY_P99}ms`,
    async () => {
      const sockets: Socket[] = [];
      // latencies[i] = array de latencias medidas para el cliente i
      const latencies: number[][] = Array.from({ length: MAX_PLAYERS }, () => []);

      try {
        // 1. Conectar y unir clientes
        for (let i = 0; i < MAX_PLAYERS; i++) {
          sockets.push(await createSocket(`lat-user-${i}`));
        }
        await Promise.all(
          sockets.map((s, i) => joinRoom(s, `lat-user-${i}`, `LatBot${i}`)),
        );

        // 2. Medir latencia:
        //    sendTime[i] = momento en que el cliente i envió el último input
        //    latencia    = Date.now() al recibir snapshot - sendTime[i]
        //    Esto captura: transmisión input + espera hasta próximo tick +
        //    procesamiento del tick + transmisión del snapshot.
        const sendTimes: number[] = new Array(MAX_PLAYERS).fill(0);

        sockets.forEach((s, i) => {
          s.on('snapshot', () => {
            const receiveTime = Date.now();
            if (sendTimes[i] > 0) {
              const lat = receiveTime - sendTimes[i];
              // Descartar outliers de inicio y valores imposibles
              if (lat > 0 && lat < 2000) {
                latencies[i].push(lat);
              }
            }
          });
        });

        // 3. Inputs continuos durante TEST_DURATION_MS
        const inputIntervals = sockets.map((s, i) =>
          setInterval(() => {
            sendTimes[i] = Date.now();
            s.emit('playerInput', {
              action: 'move',
              dx: Math.random() > 0.5 ? 1 : -1,
              dy: Math.random() > 0.5 ? 1 : -1,
            });
          }, INPUT_INTERVAL_MS),
        );

        await sleep(TEST_DURATION_MS);
        inputIntervals.forEach(clearInterval);

        // 4. Calcular estadísticas globales
        const allLatencies = latencies.flat().sort((a, b) => a - b);

        expect(allLatencies.length).toBeGreaterThan(0);

        const p50 = percentile(allLatencies, 50);
        const p95 = percentile(allLatencies, 95);
        const p99 = percentile(allLatencies, 99);
        const avg = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
        const max = allLatencies[allLatencies.length - 1];
        const min = allLatencies[0];

        console.log('\n  [Latencia] Resultados del test de latencia:');
        console.log(`    Muestras totales : ${allLatencies.length}`);
        console.log(`    Mínima           : ${min} ms`);
        console.log(`    Promedio         : ${avg.toFixed(1)} ms`);
        console.log(`    P50 (mediana)    : ${p50} ms  (límite: ${SNAPSHOT_LATENCY_P50} ms)`);
        console.log(`    P95              : ${p95} ms  (límite: ${SNAPSHOT_LATENCY_P95} ms)`);
        console.log(`    P99              : ${p99} ms  (límite: ${SNAPSHOT_LATENCY_P99} ms)`);
        console.log(`    Máxima           : ${max} ms`);

        // ── Criterios de aceptación ──────────────────────────────────────
        expect(p50).toBeLessThanOrEqual(SNAPSHOT_LATENCY_P50);
        expect(p95).toBeLessThanOrEqual(SNAPSHOT_LATENCY_P95);
        expect(p99).toBeLessThanOrEqual(SNAPSHOT_LATENCY_P99);

        console.log('\n  ✓ Todos los criterios de latencia cumplidos');
      } finally {
        sockets.forEach(s => s.disconnect());
        await sleep(300);
      }
    },
    TEST_DURATION_MS + 20_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Estabilidad del tick rate bajo carga (no drift del game loop)
  // ─────────────────────────────────────────────────────────────────────────
  it(
    `el tick rate debe mantenerse estable (≥ 20 ticks/s) bajo carga de ${MAX_PLAYERS} jugadores`,
    async () => {
      const sockets: Socket[] = [];
      const tickNumbers: number[] = [];
      let firstTickTime = 0;
      let lastTickTime = 0;

      try {
        // Conectar todos los jugadores
        for (let i = 0; i < MAX_PLAYERS; i++) {
          sockets.push(await createSocket(`tick-user-${i}`));
        }
        await Promise.all(
          sockets.map((s, i) => joinRoom(s, `tick-user-${i}`, `TickBot${i}`)),
        );

        // El primer socket actúa como observador del tick rate
        const observer = sockets[0];
        observer.on('snapshot', (data: { tick: number }) => {
          const now = Date.now();
          if (firstTickTime === 0) firstTickTime = now;
          lastTickTime = now;
          tickNumbers.push(data.tick);
        });

        // Inputs de carga en todos los jugadores
        const inputIntervals = sockets.map((s) =>
          setInterval(() => {
            s.emit('playerInput', {
              action: 'move',
              dx: Math.random() > 0.5 ? 1 : -1,
              dy: Math.random() > 0.5 ? 1 : -1,
            });
          }, INPUT_INTERVAL_MS),
        );

        await sleep(TEST_DURATION_MS);
        inputIntervals.forEach(clearInterval);

        // Calcular tick rate real
        const elapsedSeconds = (lastTickTime - firstTickTime) / 1000;
        const totalTicks = tickNumbers.length;
        const measuredTickRate = elapsedSeconds > 0 ? totalTicks / elapsedSeconds : 0;

        // Verificar que los números de tick son consecutivos (sin saltos grandes)
        let maxTickGap = 0;
        for (let i = 1; i < tickNumbers.length; i++) {
          const gap = tickNumbers[i] - tickNumbers[i - 1];
          if (gap > maxTickGap) maxTickGap = gap;
        }

        const nominalRate = Math.round(1000 / TICK_MS);
        console.log('\n  [Tick Rate] Resultados de estabilidad del game loop:');
        console.log(`    Ticks observados : ${totalTicks}`);
        console.log(`    Tiempo medido    : ${elapsedSeconds.toFixed(2)} s`);
        console.log(`    Tick rate real   : ${measuredTickRate.toFixed(1)} ticks/s (esperado: ~${nominalRate}, mínimo: 20)`);
        console.log(`    Mayor salto tick : ${maxTickGap} (ideal: 1)`);

        // El tick rate debe ser al menos 20/s (tolerancia del 33% sobre 30 Hz nominal).
        // En Windows, setInterval tiene resolución de ~15ms, lo que puede reducir
        // el tick rate observado a ~20-27 Hz bajo carga. Esto es comportamiento
        // normal del SO, no degradación del game loop.
        expect(measuredTickRate).toBeGreaterThanOrEqual(20);
        // No debe haber saltos de más de 5 ticks (indicaría freeze del loop)
        expect(maxTickGap).toBeLessThanOrEqual(5);

        console.log('  ✓ Game loop estable bajo carga');
      } finally {
        sockets.forEach(s => s.disconnect());
        await sleep(300);
      }
    },
    TEST_DURATION_MS + 20_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Resumen ejecutivo del escenario de calidad
  // ─────────────────────────────────────────────────────────────────────────
  it('debe imprimir el resumen del escenario de calidad', () => {
    const nominalRate = Math.round(1000 / TICK_MS);
    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║          ESCENARIO DE CALIDAD — Rendimiento / Latencia Real-Time         ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Atributo    : Rendimiento / Latencia en Tiempo Real                     ║
║  Componente  : Shooter Arena — ShooterEngineService + ShooterGateway     ║
║  Estímulo    : ${MAX_PLAYERS} jugadores concurrentes enviando inputs a 20 req/s cada uno  ║
║  Entorno     : Servidor NestJS + Socket.IO en instancia única            ║
║  Respuesta   : El servidor procesa inputs y emite snapshots a todos      ║
║  Medida      : P50 ≤ 50 ms | P95 ≤ 100 ms | P99 ≤ 150 ms               ║
║  Mecanismos  : Input Queue desacoplada, Object Pool, Spatial Hash Grid,  ║
║                Game Loop fijo a ${nominalRate} Hz, WebSocket sin compresión           ║
╚══════════════════════════════════════════════════════════════════════════╝
    `);
    expect(true).toBe(true);
  });
});
