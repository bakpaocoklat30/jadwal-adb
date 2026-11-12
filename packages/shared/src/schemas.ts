import { z } from 'zod';

export const timeHHMMSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format jam harus HH:MM (00:00 - 23:59)');

export const dateYYYYMMDDSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');

export const userRoleSchema = z.enum(['admin', 'waka', 'piket']);

export const audioStepSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1, 'Nama file audio wajib diisi').max(255),
  delayBeforeMs: z.number().int().min(0).max(120000).default(0),
  volume: z.number().int().min(0).max(100).default(100)
});

export const scheduleSlotSchema = z.object({
  id: z.string().min(1),
  time: timeHHMMSchema,
  label: z.string().min(1, 'Label jam wajib diisi').max(120),
  enabled: z.boolean().default(true),
  steps: z.array(audioStepSchema).min(1, 'Minimal 1 file audio')
});

export const profileUpsertSchema = z.object({
  name: z.string().min(1, 'Nama profil wajib diisi').max(80),
  description: z.string().max(240).default(''),
  color: z.string().min(1).max(32).default('#2563eb'),
  slots: z.array(scheduleSlotSchema).default([])
});

export const weeklyRulesUpdateSchema = z.object({
  rules: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        profileId: z.string().nullable()
      })
    )
    .length(7)
});

export const dateOverrideCreateSchema = z
  .object({
    startDate: dateYYYYMMDDSchema,
    endDate: dateYYYYMMDDSchema,
    profileId: z.string().nullable(),
    note: z.string().min(1, 'Catatan wajib diisi').max(160)
  })
  .refine((val) => val.endDate >= val.startDate, {
    message: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai'
  });

export const shutdownSettingsSchema = z.object({
  enabled: z.boolean(),
  time: timeHHMMSchema,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  graceSeconds: z.number().int().min(5).max(120).default(20)
});

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128)
});

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya boleh huruf, angka, titik, garis bawah, atau strip'),
  displayName: z.string().min(2).max(80),
  role: userRoleSchema,
  password: z.string().min(6, 'Password minimal 6 karakter').max(128)
});

export const updateUserSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(128).optional()
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Password baru minimal 6 karakter').max(128)
});

export const playManualSchema = z.object({
  label: z.string().min(1).max(120).default('Bel Manual'),
  steps: z.array(audioStepSchema).min(1)
});

export const remoteShutdownSchema = z.object({
  action: z.enum(['shutdown', 'restart']).default('shutdown'),
  graceSeconds: z.number().int().min(5).max(120).default(20),
  reason: z.string().max(160).default('Perintah jarak jauh dari Web Admin')
});

export const deviceHeartbeatSchema = z.object({
  deviceName: z.string().min(1).max(100),
  platform: z.string().min(1).max(40),
  appVersion: z.string().min(1).max(32),
  audioDir: z.string().max(300).default(''),
  audioCount: z.number().int().min(0).default(0),
  activeScheduleVersion: z.number().int().min(0).default(0),
  clientNowMs: z.number().int(),
  isPlaying: z.boolean().default(false),
  currentPlayingLabel: z.string().nullable().default(null),
  shutdownState: z.enum(['idle', 'pending', 'shutting_down']).default('idle'),
  shutdownAction: z.enum(['shutdown', 'restart']).nullable().default(null),
  shutdownRemainingSec: z.number().int().nullable().default(null),
  shutdownReason: z.string().nullable().default(null)
});

export const audioManifestUploadSchema = z.object({
  audioDir: z.string().max(300),
  files: z.array(
    z.object({
      fileName: z.string().min(1).max(255),
      relativePath: z.string().min(1).max(300),
      sizeBytes: z.number().int().min(0),
      updatedAt: z.string()
    })
  )
});

export const bellLogInputSchema = z.object({
  id: z.string().optional(),
  occurredAt: z.string(),
  triggerType: z.enum(['scheduled', 'manual', 'system']),
  status: z.enum([
    'played',
    'partial',
    'missing_file',
    'failed',
    'stopped',
    'shutdown_triggered',
    'shutdown_cancelled'
  ]),
  profileName: z.string().nullable(),
  slotLabel: z.string().min(1),
  scheduledTime: z.string().nullable(),
  files: z.array(z.string()),
  actorName: z.string().nullable(),
  detail: z.string().nullable()
});

export const shiftSlotsSchema = z.object({
  deltaMinutes: z.number().int().min(-360).max(360)
});

export const generateSlotsSchema = z.object({
  startTime: timeHHMMSchema,
  lessonCount: z.number().int().min(1).max(16),
  lessonDurationMinutes: z.number().int().min(10).max(120),
  introFileName: z.string().max(255).optional(),
  introDelayMs: z.number().int().min(0).max(30000).optional(),
  lessonFilePattern: z.string().max(255).optional(),
  endOfDayLabel: z.string().max(120).optional(),
  endOfDayFileName: z.string().max(255).optional(),
  breaks: z
    .array(
      z.object({
        afterLesson: z.number().int().min(1).max(15),
        durationMinutes: z.number().int().min(5).max(120),
        label: z.string().min(1).max(120),
        fileName: z.string().min(1).max(255)
      })
    )
    .default([])
});
