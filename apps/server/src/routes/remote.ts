import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { playManualSchema, remoteShutdownSchema } from '@jadwal-adb/shared';
import { requireAuth } from '../auth.js';
import type { AppDatabase } from '../db.js';
import type { RealtimeHub } from '../socket.js';

export function registerRemoteRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  hub: RealtimeHub
): void {
  const ensureConnected = () => hub.isDeviceConnected();

  app.post(
    '/api/remote/play-manual',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      const parsed = playManualSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Permintaan audio tidak valid' });
      }
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }

      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'play_manual',
        commandId,
        label: parsed.data.label,
        steps: parsed.data.steps,
        requestedBy: request.authUser!.displayName
      });

      return { ok: true, commandId };
    }
  );

  app.post(
    '/api/remote/stop-audio',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }

      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'stop_audio',
        commandId,
        requestedBy: request.authUser!.displayName
      });
      return { ok: true, commandId };
    }
  );

  app.post(
    '/api/remote/sync-now',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }

      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'sync_now',
        commandId,
        requestedBy: request.authUser!.displayName
      });
      return { ok: true, commandId };
    }
  );

  app.post(
    '/api/remote/shutdown',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      const parsed = remoteShutdownSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Parameter shutdown tidak valid' });
      }
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }

      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'shutdown_pc',
        commandId,
        action: parsed.data.action,
        graceSeconds: parsed.data.graceSeconds,
        reason: parsed.data.reason,
        requestedBy: request.authUser!.displayName
      });
      return { ok: true, commandId };
    }
  );

  app.post(
    '/api/remote/cancel-shutdown',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }

      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'cancel_shutdown',
        commandId,
        requestedBy: request.authUser!.displayName
      });
      return { ok: true, commandId };
    }
  );
}
