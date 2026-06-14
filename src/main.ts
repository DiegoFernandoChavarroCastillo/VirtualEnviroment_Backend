import 'dotenv/config';
import * as http from 'http';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ZoneService } from './features/shooter-arena/application/services/zone.service';
import { ZONE_SERVICE_TOKEN } from './features/virtual-world/infrastructure/adapters/in/virtual-map.gateway';
import { buildCorsOptions } from './common/config/cors.config';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new IoAdapter(app));
  logger.log('✅ IoAdapter (Socket.IO) explicitly configured');

  app.enableCors(buildCorsOptions());

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Build Swagger document
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Peerly Realtime Management')
    .setDescription(
      'REST API documentation for the Realtime Management microservice.\n\n' +
        '**WebSocket gateways** (not listed here):\n' +
        '- `ws://localhost:3004/map` — Virtual world map gateway\n' +
        '- `ws://localhost:3004/football-duel` — Football duel gateway\n' +
        '- `ws://localhost:3004/duel-pad` — Duel pad gateway',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addTag('app', 'Application root')
    .addTag('health', 'Health check')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Mount Swagger UI on the main app (port 3004) at /api-docs
  SwaggerModule.setup('api-docs', app, document);

  console.log('[Bootstrap] ZoneService check: ', ZoneService ? 'PRESENT' : 'MISSING');
  console.log('[Bootstrap] ZONE_SERVICE_TOKEN check: ', ZONE_SERVICE_TOKEN ?? 'NULL');

  const port = Number(process.env.PORT) || 3004;
  const swaggerPort = Number(process.env.SWAGGER_PORT) || 3005;

  await app.listen(port);
  console.log(`Application running on:   http://localhost:${port}`);
  console.log(`Swagger UI (main):        http://localhost:${port}/api-docs`);
  console.log(`WebSocket map:            ws://localhost:${port}/map`);

  // Lightweight HTTP server on port 3005 that serves the Swagger JSON
  // and redirects /api-docs to the main Swagger UI
  const docsServer = http.createServer((req, res) => {
    if (req.url === '/api-docs/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(document));
      return;
    }
    // Redirect everything else to the Swagger UI on the main port
    res.writeHead(302, { Location: `http://localhost:${port}/api-docs` });
    res.end();
  });

  docsServer.listen(swaggerPort, () => {
    console.log(`Swagger docs port:        http://localhost:${swaggerPort}/api-docs  (redirects to UI)`);
    console.log(`Swagger JSON:             http://localhost:${swaggerPort}/api-docs/json`);
  });
}
bootstrap();
