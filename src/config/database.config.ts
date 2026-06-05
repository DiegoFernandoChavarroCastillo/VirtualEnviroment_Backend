import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import fs from 'fs';
import { User } from '../users/entities/user.entity';
import { LeaderboardEntry } from '../leaderboard/entities/leaderboard-entry.entity';
import { ConnectionRequest } from '../connections/entities/connection-request.entity';

export const buildDatabaseConfig = (): TypeOrmModuleOptions => {
  const url = process.env.DATABASE_URL || process.env.DB_URL || null;

  // If a single DATABASE_URL is provided, use it (recommended).
  if (url) {
    // Parse URL to detect sslmode and other params
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get('sslmode') || process.env.DB_SSLMODE || '';
    const useLibpqCompat =
      (parsed.searchParams.get('uselibpqcompat') === 'true') ||
      process.env.DB_USELIBPQCOMPAT === 'true' ||
      process.env.DB_USE_LIBPQ_COMPAT === 'true';

    const cfg: TypeOrmModuleOptions = {
      type: 'postgres',
      url,
      entities: [User, LeaderboardEntry, ConnectionRequest],
      synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true',
      logging: process.env.DB_LOGGING === 'true' ? 'all' : ['error', 'warn'],
      autoLoadEntities: true,
    };

    // Secure default: use verify-full semantics unless the user explicitly opts-in to libpq compat.
    // verify-full => rejectUnauthorized: true and (optionally) provide CA for verification.
    const enforceVerifyFull = !useLibpqCompat;

    if (enforceVerifyFull) {
      const ssl: any = { rejectUnauthorized: true };

      // Allow providing CA via env var (raw PEM) or a path to a PEM file
      const caPem = process.env.DB_SSL_CA || process.env.PGSSLROOTCERT || null;
      const caPath = process.env.DB_SSL_CA_PATH || process.env.PGSSLROOTCERT_PATH || null;

      if (caPem) {
        ssl.ca = caPem;
      } else if (caPath) {
        try {
          ssl.ca = fs.readFileSync(caPath, 'utf8');
        } catch (err) {
          // If CA file can't be read, throw to surface the misconfiguration early
          throw new Error(`Failed to read DB CA file at ${caPath}: ${err?.message ?? err}`);
        }
      }

      (cfg as any).extra = { ssl };
      return cfg;
    }

    // libpq compatibility requested — still configure SSL if present but allow looser semantics.
    // We'll respect provided CA when available.
    const ssl: any = { rejectUnauthorized: true };
    const caPem2 = process.env.DB_SSL_CA || process.env.PGSSLROOTCERT || null;
    const caPath2 = process.env.DB_SSL_CA_PATH || process.env.PGSSLROOTCERT_PATH || null;
    if (caPem2) ssl.ca = caPem2;
    else if (caPath2) {
      try {
        ssl.ca = fs.readFileSync(caPath2, 'utf8');
      } catch (err) {
        // don't throw here for compat mode, but log via console
        console.warn(`Warning: could not read DB CA file at ${caPath2}: ${err?.message ?? err}`);
      }
    }
    (cfg as any).extra = { ssl };
    return cfg;
  }

  // Fallback to individual DB_* environment variables
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'shooter',
    password: process.env.DB_PASSWORD ?? 'civic4',
    database: process.env.DB_NAME ?? 'shooter',
    entities: [User, LeaderboardEntry, ConnectionRequest],
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true',
    logging: process.env.DB_LOGGING === 'true' ? 'all' : ['error', 'warn'],
    autoLoadEntities: true,
  };
};
