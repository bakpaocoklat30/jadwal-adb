import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  updateUserSchema
} from '@jadwal-adb/shared';
import { requireAuth, signUserToken } from '../auth.js';
import { verifyPassword, type AppDatabase } from '../db.js';
import { LoginRateLimiter } from '../security.js';

export function registerAuthRoutes(app: FastifyInstance, db: AppDatabase): void {
  const rateLimiter = new LoginRateLimiter();

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data tidak valid' });
    }

    const username = parsed.data.username.trim();
    const clientIp = request.ip || 'unknown';
    const waitMs = rateLimiter.checkBlocked(clientIp, username);
    if (waitMs > 0) {
      const waitMinutes = Math.max(1, Math.ceil(waitMs / 60_000));
      return reply.code(429).send({
        error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${waitMinutes} menit.`
      });
    }

    const userRow = db.findUserByUsername(username);
    if (!userRow || !userRow.active || !verifyPassword(parsed.data.password, userRow.passwordHash)) {
      rateLimiter.recordFailure(clientIp, username);
      return reply.code(401).send({ error: 'Username atau password salah' });
    }

    rateLimiter.recordSuccess(clientIp, username);
    const user = db.toPublicUser(userRow);
    const token = await signUserToken(user, db.getJwtSecret());
    return { token, user };
  });

  app.get('/api/auth/me', { preHandler: requireAuth(db) }, async (request) => {
    return { user: request.authUser };
  });

  app.post(
    '/api/auth/change-password',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data tidak valid' });
      }

      const row = db.findUserById(request.authUser!.id);
      if (!row || !verifyPassword(parsed.data.currentPassword, row.passwordHash)) {
        return reply.code(400).send({ error: 'Password saat ini salah' });
      }

      db.updatePassword(row.id, parsed.data.newPassword);
      const updated = db.toPublicUser(db.findUserById(row.id)!);
      return { user: updated };
    }
  );

  app.get(
    '/api/users',
    { preHandler: requireAuth(db, ['admin']) },
    async () => {
      return { users: db.listUsers() };
    }
  );

  app.post(
    '/api/users',
    { preHandler: requireAuth(db, ['admin']) },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data tidak valid' });
      }

      if (db.findUserByUsername(parsed.data.username)) {
        return reply.code(409).send({ error: 'Username sudah digunakan' });
      }

      const user = db.createUser(parsed.data);
      return reply.code(201).send({ user });
    }
  );

  app.patch(
    '/api/users/:id',
    { preHandler: requireAuth(db, ['admin']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data tidak valid' });
      }

      if (id === request.authUser!.id && parsed.data.active === false) {
        return reply.code(400).send({ error: 'Tidak dapat menonaktifkan akun sendiri' });
      }

      const updated = db.updateUser(id, parsed.data);
      if (!updated) {
        return reply.code(404).send({ error: 'User tidak ditemukan' });
      }
      return { user: updated };
    }
  );

  app.delete(
    '/api/users/:id',
    { preHandler: requireAuth(db, ['admin']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id === request.authUser!.id) {
        return reply.code(400).send({ error: 'Tidak dapat menghapus akun sendiri' });
      }
      const deleted = db.deleteUser(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'User tidak ditemukan' });
      }
      return { ok: true };
    }
  );
}
