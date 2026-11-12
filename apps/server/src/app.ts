import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { getZonedDateParts } from '@jadwal-adb/shared';
import type { ServerConfig } from './config.js';
import { AppDatabase } from './db.js';
import { registerAudioRoutes } from './routes/audio.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBackupRoutes } from './routes/backup.js';
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

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), geolocation=()');
    return payload;
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });

  await app.register(multipart, {
    limits: {
      fileSize: 30 * 1024 * 1024,
      files: 1
    }
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
  registerAudioRoutes(app, db, hub, config.uploadsDir);
  registerBackupRoutes(app, db, hub, config.backupsDir, config.timeZone);
  registerScheduleRoutes(app, db, hub);
  registerDeviceRoutes(app, db, hub);
  registerRemoteRoutes(app, db, hub, config.uploadsDir);

  // Automatic daily database backup scheduler
  let lastAutoBackupDate = '';
  const backupInterval = setInterval(() => {
    try {
      const backupSettings = db.getBackupSettings();
      if (!backupSettings.enabled) return;
      const parts = getZonedDateParts(Date.now(), config.timeZone);
      if (parts.timeStr === backupSettings.time && lastAutoBackupDate !== parts.dateStr) {
        lastAutoBackupDate = parts.dateStr;
        db.createDatabaseBackup(config.backupsDir, 'auto');
      }
    } catch {
      // Keep server healthy even if backup tick fails
    }
  }, 30_000);
  backupInterval.unref();

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
    clearInterval(backupInterval);
    hub.io.close();
    db.sqlite.close();
  });

  return { app, db, hub };
}
