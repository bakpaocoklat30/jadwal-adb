import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import {
  backupSettingsSchema,
  getZonedDateParts,
  normalizeShutdownSettings,
  restoreScheduleJsonSchema
} from '@jadwal-adb/shared';
import { requireAuth } from '../auth.js';
import type { AppDatabase } from '../db.js';
import type { RealtimeHub } from '../socket.js';

export function registerBackupRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  hub: RealtimeHub,
  backupsDir: string,
  timeZone: string
): void {
  fs.mkdirSync(backupsDir, { recursive: true });

  // Full DB backups (.db) — Admin only
  app.get(
    '/api/backups',
    { preHandler: requireAuth(db, ['admin']) },
    async () => {
      return {
        settings: db.getBackupSettings(),
        files: db.listBackups(backupsDir)
      };
    }
  );

  app.put(
    '/api/backups/settings',
    { preHandler: requireAuth(db, ['admin']) },
    async (request, reply) => {
      const parsed = backupSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message || 'Pengaturan backup tidak valid' });
      }
      const settings = db.updateBackupSettings(parsed.data);
      return { settings };
    }
  );

  app.post(
    '/api/backups/create',
    { preHandler: requireAuth(db, ['admin']) },
    async () => {
      const file = db.createDatabaseBackup(backupsDir, 'manual');
      return {
        file,
        settings: db.getBackupSettings(),
        files: db.listBackups(backupsDir)
      };
    }
  );

  app.get(
    '/api/backups/:fileName/download',
    { preHandler: requireAuth(db, ['admin']) },
    async (request, reply) => {
      const { fileName } = request.params as { fileName: string };
      const target = db.resolveBackupPath(backupsDir, fileName);
      if (!target || !fs.existsSync(target)) {
        return reply.code(404).send({ error: 'File backup tidak ditemukan' });
      }
      const stat = fs.statSync(target);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
      reply.header('Content-Length', String(stat.size));
      return reply.send(fs.createReadStream(target));
    }
  );

  app.delete(
    '/api/backups/:fileName',
    { preHandler: requireAuth(db, ['admin']) },
    async (request, reply) => {
      const { fileName } = request.params as { fileName: string };
      const ok = db.deleteBackup(backupsDir, fileName);
      if (!ok) {
        return reply.code(404).send({ error: 'File backup tidak ditemukan' });
      }
      return { ok: true, files: db.listBackups(backupsDir) };
    }
  );

  // Schedule JSON export & restore — Admin & Waka Kurikulum
  app.get(
    '/api/backups/schedule-json',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (_request, reply) => {
      const snapshot = db.getScheduleSnapshot();
      const dateStr = getZonedDateParts(Date.now(), timeZone).dateStr;
      const filename = `jadwal-adb-${dateStr}.json`;
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(JSON.stringify(snapshot, null, 2));
    }
  );

  app.post(
    '/api/backups/restore-schedule',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const parsed = restoreScheduleJsonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error:
            parsed.error.issues[0]?.message ||
            'Format file backup JSON tidak valid untuk Bel Sekolah ADB'
        });
      }

      // Take a safety DB snapshot before overwriting schedules
      db.createDatabaseBackup(backupsDir, 'auto');

      const normalizedShutdown = normalizeShutdownSettings(parsed.data.shutdownSettings);
      const snapshot = db.replaceScheduleFromDevice({
        profiles: parsed.data.profiles,
        weeklyRules: parsed.data.weeklyRules,
        dateOverrides: parsed.data.dateOverrides,
        shutdownSettings: {
          enabled: normalizedShutdown.enabled,
          graceSeconds: normalizedShutdown.graceSeconds,
          dayRules: normalizedShutdown.dayRules
        }
      });

      hub.broadcastScheduleUpdated();
      return {
        snapshot,
        files: db.listBackups(backupsDir)
      };
    }
  );
}
