import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth, requireDeviceToken } from '../auth.js';
import type { AppDatabase } from '../db.js';
import type { RealtimeHub } from '../socket.js';

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac']);
const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac'
};

export function sanitizeAudioFileName(rawName: string): string | null {
  const base = path.basename(rawName.trim());
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;

  const rawStem = base.slice(0, base.length - ext.length);
  const cleanStem = rawStem
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100);

  return `${cleanStem || 'audio'}${ext}`;
}

function resolveInsideUploads(uploadsDir: string, fileName: string): string | null {
  const root = path.resolve(uploadsDir);
  const safeBase = path.basename(fileName);
  const target = path.resolve(root, safeBase);
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

function streamAudioFile(
  uploadsDir: string,
  fileName: string,
  reply: FastifyReply
): FastifyReply {
  const target = resolveInsideUploads(uploadsDir, fileName);
  if (!target || !fs.existsSync(target)) {
    return reply.code(404).send({ error: 'File audio tidak ditemukan di server' });
  }
  const stat = fs.statSync(target);
  const ext = path.extname(target).toLowerCase();
  reply.header('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  reply.header('Content-Length', String(stat.size));
  return reply.send(fs.createReadStream(target));
}

export function registerAudioRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  hub: RealtimeHub,
  uploadsDir: string
): void {
  fs.mkdirSync(uploadsDir, { recursive: true });

  app.get('/api/audio/server-files', { preHandler: requireAuth(db) }, async () => {
    return { files: db.listServerAudioFiles() };
  });

  app.post(
    '/api/audio/upload',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      let filePart;
      try {
        filePart = await request.file();
      } catch (err) {
        const message =
          err instanceof Error && err.message.includes('File size limit')
            ? 'Ukuran file melebihi batas maksimal 30 MB'
            : 'Gagal membaca file upload';
        return reply.code(413).send({ error: message });
      }

      if (!filePart) {
        return reply.code(400).send({ error: 'File audio wajib dipilih' });
      }

      const safeName = sanitizeAudioFileName(filePart.filename || '');
      if (!safeName) {
        return reply.code(400).send({
          error: 'Format file tidak didukung. Gunakan .mp3, .wav, .ogg, .m4a, atau .aac'
        });
      }

      const buffer = await filePart.toBuffer();
      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'File audio kosong' });
      }

      const targetPath = resolveInsideUploads(uploadsDir, safeName);
      if (!targetPath) {
        return reply.code(400).send({ error: 'Nama file tidak valid' });
      }

      const tmpPath = `${targetPath}.tmp`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, targetPath);

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const saved = db.upsertServerAudioFile({
        fileName: safeName,
        sizeBytes: buffer.length,
        sha256,
        uploadedBy: request.authUser!.displayName
      });

      hub.broadcastServerAudioUpdated();
      return reply.code(201).send({ file: saved, files: db.listServerAudioFiles() });
    }
  );

  app.get(
    '/api/audio/server-files/:fileName/stream',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { fileName } = request.params as { fileName: string };
      return streamAudioFile(uploadsDir, fileName, reply);
    }
  );

  app.delete(
    '/api/audio/server-files/:fileName',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const { fileName } = request.params as { fileName: string };
      const safeBase = path.basename(fileName);
      const deleted = db.deleteServerAudioFile(safeBase);
      if (!deleted) {
        return reply.code(404).send({ error: 'File tidak ditemukan' });
      }

      const target = resolveInsideUploads(uploadsDir, safeBase);
      if (target && fs.existsSync(target)) {
        fs.unlinkSync(target);
      }

      hub.broadcastServerAudioUpdated();
      return { ok: true, files: db.listServerAudioFiles() };
    }
  );

  // Device sync endpoints for downloading uploaded audio to PC Bel local _web/ folder
  app.get(
    '/api/device/server-audio',
    { preHandler: requireDeviceToken(db) },
    async () => {
      return { files: db.listServerAudioFiles() };
    }
  );

  app.get(
    '/api/device/server-audio/:fileName',
    { preHandler: requireDeviceToken(db) },
    async (request, reply) => {
      const { fileName } = request.params as { fileName: string };
      return streamAudioFile(uploadsDir, fileName, reply);
    }
  );
}
