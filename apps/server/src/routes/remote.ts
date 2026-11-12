import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { playManualSchema, remoteShutdownSchema } from '@jadwal-adb/shared';
import { requireAuth } from '../auth.js';
import type { AppDatabase } from '../db.js';
import type { RealtimeHub } from '../socket.js';

const ANNOUNCEMENT_EXTENSIONS = new Set(['.m4a', '.mp3', '.wav', '.ogg', '.aac', '.webm', '.3gp']);

function pruneAnnouncements(dir: string, keep = 25): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs
    .readdirSync(dir)
    .filter((f) => !f.endsWith('.tmp'))
    .map((fileName) => ({
      fileName,
      mtimeMs: fs.statSync(path.join(dir, fileName)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const old of entries.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, old.fileName));
    } catch {
      // ignore cleanup error
    }
  }
}

export function registerRemoteRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  hub: RealtimeHub,
  uploadsDir: string
): void {
  const ensureConnected = () => hub.isDeviceConnected();
  const announcementsDir = path.join(uploadsDir, '_announcements');
  fs.mkdirSync(announcementsDir, { recursive: true });

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

  app.post(
    '/api/remote/play-chime',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (_request, reply) => {
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }
      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'play_chime',
        commandId,
        requestedBy: _request.authUser!.displayName
      });
      return { ok: true, commandId };
    }
  );

  app.post(
    '/api/remote/announce-voice-note',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      if (!ensureConnected()) {
        return reply.code(409).send({ error: 'PC Bel sedang offline / tidak terhubung ke server' });
      }

      let filePart;
      try {
        filePart = await request.file();
      } catch {
        return reply.code(413).send({ error: 'Ukuran rekaman suara terlalu besar (maks 30 MB)' });
      }
      if (!filePart) {
        return reply.code(400).send({ error: 'File rekaman suara wajib dikirim' });
      }

      const rawExt = path.extname(filePart.filename || '').toLowerCase();
      const ext = ANNOUNCEMENT_EXTENSIONS.has(rawExt) ? rawExt : '.m4a';
      const buffer = await filePart.toBuffer();
      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'Rekaman suara kosong' });
      }

      const query = request.query as { withChime?: string; label?: string };
      const withChime = query.withChime !== 'false';
      const label = (query.label || 'Pengumuman Suara').trim().slice(0, 120) || 'Pengumuman Suara';

      const fileName = `announce-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const targetPath = path.join(announcementsDir, fileName);
      const tmpPath = `${targetPath}.tmp`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, targetPath);
      pruneAnnouncements(announcementsDir, 25);

      const commandId = crypto.randomUUID();
      hub.sendCommandToDevice({
        type: 'play_announcement',
        commandId,
        label,
        fileName,
        withChime,
        requestedBy: request.authUser!.displayName
      });

      return { ok: true, commandId, fileName };
    }
  );
}
