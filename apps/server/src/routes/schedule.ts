import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  dateOverrideCreateSchema,
  dateYYYYMMDDSchema,
  generateScheduleSlots,
  generateSlotsSchema,
  getZonedDateParts,
  profileUpsertSchema,
  shiftSlotsSchema,
  shiftTimeHHMM,
  weeklyRulesUpdateSchema
} from '@jadwal-adb/shared';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import type { AppDatabase } from '../db.js';
import type { RealtimeHub } from '../socket.js';

const todayOverrideSchema = z.object({
  date: dateYYYYMMDDSchema.optional(),
  profileId: z.string().nullable(),
  note: z.string().min(1).max(160)
});

export function registerScheduleRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  hub: RealtimeHub
): void {
  app.get('/api/schedule/snapshot', { preHandler: requireAuth(db) }, async () => {
    return {
      snapshot: db.getScheduleSnapshot(),
      serverNowMs: Date.now()
    };
  });

  app.post(
    '/api/profiles',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const parsed = profileUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data profil tidak valid' });
      }
      const profile = db.createProfile(parsed.data);
      hub.broadcastScheduleUpdated();
      return reply.code(201).send({ profile, snapshot: db.getScheduleSnapshot() });
    }
  );

  app.put(
    '/api/profiles/:id',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = profileUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data profil tidak valid' });
      }
      const profile = db.updateProfile(id, parsed.data);
      if (!profile) {
        return reply.code(404).send({ error: 'Profil tidak ditemukan' });
      }
      hub.broadcastScheduleUpdated();
      return { profile, snapshot: db.getScheduleSnapshot() };
    }
  );

  app.post(
    '/api/profiles/:id/duplicate',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = db.getProfile(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Profil tidak ditemukan' });
      }

      const clonedSlots = existing.slots.map((slot) => ({
        ...slot,
        id: crypto.randomUUID(),
        steps: slot.steps.map((st) => ({ ...st, id: crypto.randomUUID() }))
      }));

      const profile = db.createProfile({
        name: `${existing.name} (Salinan)`,
        description: existing.description,
        color: existing.color,
        slots: clonedSlots
      });
      hub.broadcastScheduleUpdated();
      return reply.code(201).send({ profile, snapshot: db.getScheduleSnapshot() });
    }
  );

  app.post(
    '/api/profiles/:id/shift',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = shiftSlotsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Offset menit tidak valid' });
      }

      const existing = db.getProfile(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Profil tidak ditemukan' });
      }

      const shiftedSlots = existing.slots.map((slot) => ({
        ...slot,
        time: shiftTimeHHMM(slot.time, parsed.data.deltaMinutes).time
      }));

      const profile = db.updateProfile(id, {
        name: existing.name,
        description: existing.description,
        color: existing.color,
        slots: shiftedSlots
      });
      hub.broadcastScheduleUpdated();
      return { profile, snapshot: db.getScheduleSnapshot() };
    }
  );

  app.post(
    '/api/profiles/generate-preview',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const parsed = generateSlotsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Parameter generator tidak valid' });
      }
      const slots = generateScheduleSlots(parsed.data);
      return { slots };
    }
  );

  app.delete(
    '/api/profiles/:id',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok = db.deleteProfile(id);
      if (!ok) {
        return reply.code(404).send({ error: 'Profil tidak ditemukan' });
      }
      hub.broadcastScheduleUpdated();
      return { ok: true, snapshot: db.getScheduleSnapshot() };
    }
  );

  app.put(
    '/api/weekly-rules',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const parsed = weeklyRulesUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Aturan mingguan tidak valid' });
      }
      const rules = db.updateWeeklyRules(parsed.data.rules);
      hub.broadcastScheduleUpdated();
      return { weeklyRules: rules, snapshot: db.getScheduleSnapshot() };
    }
  );

  app.post(
    '/api/overrides',
    { preHandler: requireAuth(db, ['admin', 'waka']) },
    async (request, reply) => {
      const parsed = dateOverrideCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data pengecualian tidak valid' });
      }
      const override = db.createDateOverride({
        ...parsed.data,
        createdBy: request.authUser!.displayName
      });
      hub.broadcastScheduleUpdated();
      return reply.code(201).send({ override, snapshot: db.getScheduleSnapshot() });
    }
  );

  // Quick single-day override accessible by Piket, Waka, and Admin
  app.post(
    '/api/overrides/today',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      const parsed = todayOverrideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Data tidak valid' });
      }
      const snapshot = db.getScheduleSnapshot();
      const todayDate = getZonedDateParts(Date.now(), snapshot.timeZone).dateStr;
      const targetDate = parsed.data.date || todayDate;

      if (request.authUser!.role === 'piket' && targetDate !== todayDate) {
        return reply.code(403).send({ error: 'Guru Piket hanya dapat mengubah jadwal hari ini' });
      }

      const override = db.upsertSingleDayOverride({
        date: targetDate,
        profileId: parsed.data.profileId,
        note: parsed.data.note,
        createdBy: request.authUser!.displayName
      });
      hub.broadcastScheduleUpdated();
      return reply.code(201).send({ override, snapshot: db.getScheduleSnapshot() });
    }
  );

  app.delete(
    '/api/overrides/:id',
    { preHandler: requireAuth(db, ['admin', 'waka', 'piket']) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const overrides = db.listDateOverrides();
      const target = overrides.find((o) => o.id === id);
      if (!target) {
        return reply.code(404).send({ error: 'Pengecualian tanggal tidak ditemukan' });
      }

      if (request.authUser!.role === 'piket') {
        const snapshot = db.getScheduleSnapshot();
        const todayDate = getZonedDateParts(Date.now(), snapshot.timeZone).dateStr;
        if (target.startDate !== todayDate || target.endDate !== todayDate) {
          return reply
            .code(403)
            .send({ error: 'Guru Piket hanya dapat membatalkan override hari ini' });
        }
      }

      db.deleteDateOverride(id);
      hub.broadcastScheduleUpdated();
      return { ok: true, snapshot: db.getScheduleSnapshot() };
    }
  );
}
