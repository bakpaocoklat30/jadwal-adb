import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { UserPublic, UserRole } from '@jadwal-adb/shared';
import type { AppDatabase } from './db.js';
import { safeTokenEquals } from './security.js';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: UserPublic;
  }
}

export async function signUserToken(
  user: UserPublic,
  secret: string
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({
    username: user.username,
    role: user.role
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export async function verifyUserToken(
  token: string,
  secret: string
): Promise<AuthTokenPayload | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    if (!payload.sub || typeof payload.username !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role as UserRole
    };
  } catch {
    return null;
  }
}

export interface RequireAuthOptions {
  requireChangedPassword?: boolean;
}

export function requireAuth(
  db: AppDatabase,
  allowedRoles?: UserRole[],
  options: RequireAuthOptions = {}
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Token autentikasi tidak ditemukan' });
    }

    const token = authHeader.slice(7).trim();
    const payload = await verifyUserToken(token, db.getJwtSecret());
    if (!payload) {
      return reply.code(401).send({ error: 'Sesi login tidak valid atau kedaluwarsa' });
    }

    const userRow = db.findUserById(payload.sub);
    if (!userRow || !userRow.active) {
      return reply.code(401).send({ error: 'Akun tidak aktif atau tidak ditemukan' });
    }

    const publicUser = db.toPublicUser(userRow);
    if (allowedRoles && !allowedRoles.includes(publicUser.role)) {
      return reply.code(403).send({ error: 'Anda tidak memiliki hak akses untuk tindakan ini' });
    }

    if (options.requireChangedPassword && publicUser.mustChangePassword) {
      return reply.code(403).send({
        error:
          'Demi keamanan, Anda wajib mengganti password bawaan di menu Pengaturan sebelum melakukan aksi ini'
      });
    }

    request.authUser = publicUser;
  };
}

export function requireDeviceToken(db: AppDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers['x-device-token'];
    if (typeof token !== 'string' || !safeTokenEquals(token, db.getDeviceToken())) {
      return reply.code(401).send({ error: 'Device token tidak valid' });
    }
  };
}
