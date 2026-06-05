import { Logger } from '@nestjs/common';

const logger = new Logger('CorsConfig');

function parseOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:4173'];
  const list = (raw && raw.length > 0 ? raw : defaultOrigins.join(','))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  logger.log(`CORS allow-list: ${list.join(', ')}`);
  return list;
}

/**
 * Builds the CORS origin list from the `CORS_ORIGINS` env var.
 *
 * Format: comma-separated list of fully-qualified origins, e.g.
 *   CORS_ORIGINS=https://app.peerly.example,https://staging.peerly.example
 *
 * The default list covers local dev (Vite on 5173 and preview on 4173).
 * `credentials: true` is only allowed when `origin` is a finite list,
 * never `*` (the browser rejects that combination).
 */
export function buildCorsOptions() {
  const origins = parseOrigins();

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow non-browser clients (curl, server-to-server) where origin is undefined.
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) return callback(null, true);
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      return callback(new Error('Origin not allowed by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

/**
 * CORS options for Socket.IO gateways. Uses the same allow-list as the
 * HTTP layer so the two stay in sync. Browsers enforce CORS on the
 * WebSocket handshake via the `Origin` header, so the same allow-list
 * must apply here too.
 */
export function buildSocketIoCorsOptions() {
  return {
    origin: parseOrigins(),
    credentials: true,
  };
}

