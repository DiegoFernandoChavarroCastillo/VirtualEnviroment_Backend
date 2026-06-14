import { Logger } from '@nestjs/common';

const logger = new Logger('CorsConfig');

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '').toLowerCase();
}

function parseOriginPattern(pattern: string): RegExp | null {
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${regexPattern}$`);
  } catch {
    logger.warn(`Invalid CORS origin pattern: ${pattern}`);
    return null;
  }
}

interface ParsedOrigins {
  exact: string[];
  patterns: RegExp[];
}

function parseOrigins(): ParsedOrigins {
  const raw = process.env.CORS_ORIGINS?.trim();
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:4173'];
  const items = (raw && raw.length > 0 ? raw : defaultOrigins.join(','))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const exact: string[] = [];
  const patterns: RegExp[] = [];

  for (const item of items) {
    if (item.includes('*')) {
      const regex = parseOriginPattern(item);
      if (regex) patterns.push(regex);
    } else {
      exact.push(normalizeOrigin(item));
    }
  }

  logger.log(`CORS allow-list: ${items.join(', ')}`);
  if (patterns.length > 0) {
    logger.log(`CORS patterns: ${patterns.map((r) => r.source).join(', ')}`);
  }

  return { exact, patterns };
}

function isOriginAllowed(
  origin: string,
  { exact, patterns }: ParsedOrigins,
): boolean {
  const normalized = normalizeOrigin(origin);
  if (exact.includes(normalized)) return true;
  return patterns.some((re) => re.test(normalized));
}

export function buildCorsOptions() {
  const origins = parseOrigins();

  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin, origins)) return callback(null, true);
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      return callback(new Error('Origin not allowed by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

export function buildSocketIoCorsOptions() {
  const origins = parseOrigins();
  return {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin, origins)) return callback(null, true);
      logger.warn(`Blocked WS CORS request from origin: ${origin}`);
      return callback(new Error('Origin not allowed by CORS policy'));
    },
    credentials: true,
  };
}
