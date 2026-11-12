import type { FastifyInstance } from 'fastify';
import {
  audioManifestUploadSchema,
  bellLogInputSchema,
  deviceHeartbeatSchema,
  shutdownSettingsSchema
} from '@jadwal-adb/shared';
import { z } from 'zod';
import { requireAuth, requireDeviceToken } from '../auth.js';
import type { AppDatabase } from '../db.js';
import type { RealtimeHub } from '../socket.js';

export function registerDeviceRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  hub: RealtimeHub
): void {
  // --- Admin / Web endpoints ---
  app.get('/api/device/status', { preHandler: requireAuth(db) }, async () => {
    return {
      status: db.getDeviceStatus(),
      audioFiles: db.getAudioManifest(),
      logs: db.listBellLogs(100),
      serverNowMs: Date.now()
    };
  });

  app.get(
    '/api/device/token',
    { preHandler: requireAuth(db, ['admin']) },
    async () => {
      return { deviceToken: db.getDeviceToken() };
    }
  );

  app.post(
    '/api/device/token/rotate',
    { preHandler: requireAuth(db, ['admin']) },
    async () => {
      const deviceToken = db.rotateDeviceToken();
      return { deviceToken };
    }
  );

  app.put(
    '/api/settings/shutdown',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const parsed = shutdownSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Pengaturan shutdown tidak valid' });
      }
      const shutdownSettings = db.updateShutdownSettings(parsed.data);
      hub.broadcastScheduleUpdated();
      return { shutdownSettings, snapshot: db.getScheduleSnapshot() };
    }
  );

  app.get('/api/logs', { preHandler: requireAuth(db) }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(500, Math.max(10, Number(query.limit || 100)));
    return { logs: db.listBellLogs(limit) };
  });

  // --- Device REST fallback endpoints (authenticated by x-device-token) ---
  app.get(
    '/api/device/sync',
    { preHandler: requireDeviceToken(db) },
    async () => {
      db.updateDeviceStatus({
        lastSyncAt: new Date().toISOString()
      });
      hub.broadcastDeviceStatus();
      return {
        snapshot: db.getScheduleSnapshot(),
        serverNowMs: Date.now()
      };
    }
  );

  app.post(
    '/api/device/heartbeat',
    { preHandler: requireDeviceToken(db) },
    async (request, reply) => {
      const parsed = deviceHeartbeatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Heartbeat tidak valid' });
      }
      const serverNowMs = Date.now();
      const data = parsed.data;
      const status = db.updateDeviceStatus({
        online: hub.isDeviceConnected() || true,
        deviceName: data.deviceName,
        platform: data.platform,
        appVersion: data.appVersion,
        audioDir: data.audioDir,
        audioCount: data.audioCount,
        activeScheduleVersion: data.activeScheduleVersion,
        lastHeartbeatAt: new Date(serverNowMs).toISOString(),
        clockDriftMs: serverNowMs - data.clientNowMs,
        isPlaying: data.isPlaying,
        currentPlayingLabel: data.currentPlayingLabel,
        shutdownState: data.shutdownState,
        shutdownAction: data.shutdownAction,
        shutdownRemainingSec: data.shutdownRemainingSec,
        shutdownReason: data.shutdownReason
      });
      hub.broadcastDeviceStatus();
      return {
        status,
        serverNowMs,
        scheduleVersion: db.getScheduleVersion()
      };
    }
  );

  app.post(
    '/api/device/audio-manifest',
    { preHandler: requireDeviceToken(db) },
    async (request, reply) => {
      const parsed = audioManifestUploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Manifest tidak valid' });
      }
      db.setAudioManifest(parsed.data.files, parsed.data.audioDir);
      hub.broadcastAudioManifest();
      hub.broadcastDeviceStatus();
      return { ok: true, count: parsed.data.files.length };
    }
  );

  app.post(
    '/api/device/logs',
    { preHandler: requireDeviceToken(db) },
    async (request, reply) => {
      const parsed = z.array(bellLogInputSchema).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Format log tidak valid' });
      }
      const inserted = db.insertBellLogs(parsed.data);
      if (inserted.length > 0) {
        hub.broadcastLogsUpdated();
      }
      return { ok: true, saved: inserted.length };
    }
  );
}
