import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';
import { AppDatabase } from './db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDeviceRoutes } from './routes/device.js';
import { registerRemoteRoutes } from './routes/remote.js';
import { registerScheduleRoutes } from './routes/schedule.js';
import { RealtimeHub } from './socket.js';

export interface BuiltApp {
  app: FastifyInstance;
  db: AppDatabase;
  hub: RealtimeHub;
}

export async function buildServerApp(config: ServerConfig): Promise<BuiltApp> {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });

  const db = new AppDatabase(config.dbPath, {
    schoolName: config.schoolName,
    timeZone: config.timeZone,
    initialDeviceToken: config.initialDeviceToken,
    jwtSecret: config.jwtSecret
  });

  const hub = new RealtimeHub(app.server, db, config.corsOrigin);

  app.get('/api/health', async () => {
    return {
      ok: true,
      service: 'jadwal-adb-server',
      schoolName: config.schoolName,
      timeZone: config.timeZone,
      scheduleVersion: db.getScheduleVersion(),
      deviceOnline: hub.isDeviceConnected(),
      serverNowMs: Date.now()
    };
  });

  registerAuthRoutes(app, db);
  registerScheduleRoutes(app, db, hub);
  registerDeviceRoutes(app, db, hub);
  registerRemoteRoutes(app, db, hub);

  if (fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: '/'
    });

    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/socket.io/')
      ) {
        return reply.sendFile('index.html', path.resolve(config.webDistDir));
      }
      return reply.code(404).send({ error: 'Endpoint tidak ditemukan' });
    });
  }

  app.addHook('onClose', async () => {
    hub.io.close();
    db.sqlite.close();
  });

  return { app, db, hub };
}
