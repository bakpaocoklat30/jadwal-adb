import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AudioFileEntry,
  BackupFileInfo,
  BackupSettings,
  BellLog,
  BellLogInput,
  DateOverride,
  DeviceStatus,
  ScheduleProfile,
  ScheduleSlot,
  ScheduleSnapshot,
  ServerAudioFile,
  ShutdownSettings,
  UserPublic,
  UserRole,
  WeeklyRule
} from '@jadwal-adb/shared';
import {
  createDefaultShutdownSettings,
  normalizeShutdownSettings,
  sortSlots
} from '@jadwal-adb/shared';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(keyHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function makeSlot(
  time: string,
  label: string,
  files: Array<string | { fileName: string; delayBeforeMs?: number; volume?: number }>
): ScheduleSlot {
  return {
    id: crypto.randomUUID(),
    time,
    label,
    enabled: true,
    steps: files.map((item, idx) =>
      typeof item === 'string'
        ? {
            id: crypto.randomUUID(),
            fileName: item,
            delayBeforeMs: idx === 0 ? 0 : 1500,
            volume: 100
          }
        : {
            id: crypto.randomUUID(),
            fileName: item.fileName,
            delayBeforeMs: item.delayBeforeMs ?? (idx === 0 ? 0 : 1500),
            volume: item.volume ?? 100
          }
    )
  };
}

export class AppDatabase {
  public readonly sqlite: DatabaseSync;
  private readonly schoolName: string;
  private readonly timeZone: string;

  constructor(
    dbPath: string,
    options: {
      schoolName: string;
      timeZone: string;
      initialDeviceToken?: string | null;
      jwtSecret?: string | null;
    }
  ) {
    this.schoolName = options.schoolName;
    this.timeZone = options.timeZone;

    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.sqlite = new DatabaseSync(dbPath);
    this.sqlite.exec('PRAGMA journal_mode = WAL;');
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seedDefaults(options.initialDeviceToken ?? null, options.jwtSecret ?? null);
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        color TEXT NOT NULL,
        slots_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weekly_rules (
        day_of_week INTEGER PRIMARY KEY,
        profile_id TEXT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS date_overrides (
        id TEXT PRIMARY KEY,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        profile_id TEXT NULL,
        note TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bell_logs (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        profile_name TEXT NULL,
        slot_label TEXT NOT NULL,
        scheduled_time TEXT NULL,
        files_json TEXT NOT NULL,
        actor_name TEXT NULL,
        detail TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS uploaded_audio (
        id TEXT PRIMARY KEY,
        file_name TEXT UNIQUE NOT NULL,
        relative_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bell_logs_occurred_at ON bell_logs (occurred_at DESC);
    `);
  }

  private getMeta(key: string): string | null {
    const row = this.sqlite.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  private setMeta(key: string, value: string): void {
    this.sqlite
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  private seedDefaults(initialDeviceToken: string | null, jwtSecret: string | null): void {
    const now = new Date().toISOString();

    if (!this.getMeta('schedule_version')) {
      this.setMeta('schedule_version', '1');
    }

    if (!this.getMeta('jwt_secret')) {
      this.setMeta('jwt_secret', jwtSecret || crypto.randomBytes(32).toString('hex'));
    } else if (jwtSecret) {
      this.setMeta('jwt_secret', jwtSecret);
    }

    if (!this.getMeta('device_token')) {
      const token = initialDeviceToken || `adb-${crypto.randomBytes(12).toString('hex')}`;
      this.setMeta('device_token', token);
    }

    if (!this.getMeta('shutdown_settings')) {
      const initialShutdown = createDefaultShutdownSettings(now);
      this.setMeta('shutdown_settings', JSON.stringify(initialShutdown));
    }

    if (!this.getMeta('backup_settings')) {
      const initialBackup: BackupSettings = {
        enabled: true,
        time: '02:00',
        retainCount: 14,
        lastBackupAt: null,
        updatedAt: now
      };
      this.setMeta('backup_settings', JSON.stringify(initialBackup));
    }

    if (!this.getMeta('device_status')) {
      const initialStatus: DeviceStatus = {
        online: false,
        deviceName: 'PC Bel Sekolah (Belum Terhubung)',
        platform: 'win32',
        appVersion: '-',
        audioDir: '',
        audioCount: 0,
        activeScheduleVersion: 0,
        lastHeartbeatAt: null,
        lastSyncAt: null,
        clockDriftMs: 0,
        isPlaying: false,
        currentPlayingLabel: null,
        shutdownState: 'idle',
        shutdownAction: null,
        shutdownRemainingSec: null,
        shutdownReason: null,
        lastShutdownReason: null,
        lastShutdownAt: null
      };
      this.setMeta('device_status', JSON.stringify(initialStatus));
    }

    if (!this.getMeta('audio_manifest')) {
      this.setMeta('audio_manifest', JSON.stringify([]));
    }

    const userCount = (
      this.sqlite.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;

    if (userCount === 0) {
      const insertUser = this.sqlite.prepare(`
        INSERT INTO users (id, username, display_name, role, password_hash, active, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `);
      insertUser.run(
        crypto.randomUUID(),
        'admin',
        'Admin Jadwal ADB',
        'admin',
        hashPassword('admin123'),
        now,
        now
      );
      insertUser.run(
        crypto.randomUUID(),
        'waka',
        'Waka Kurikulum',
        'waka',
        hashPassword('waka123'),
        now,
        now
      );
      insertUser.run(
        crypto.randomUUID(),
        'piket',
        'Guru Piket',
        'piket',
        hashPassword('piket123'),
        now,
        now
      );
    }

    const profileCount = (
      this.sqlite.prepare('SELECT COUNT(*) AS count FROM profiles').get() as { count: number }
    ).count;

    if (profileCount === 0) {
      const seninId = crypto.randomUUID();
      const regulerId = crypto.randomUUID();
      const jumatId = crypto.randomUUID();
      const ujianId = crypto.randomUUID();

      const insertProfile = this.sqlite.prepare(`
        INSERT INTO profiles (id, name, description, color, slots_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const seninSlots = [
        makeSlot('06:55', 'Persiapan Upacara', ['persiapan_upacara.mp3']),
        makeSlot('07:00', 'Upacara Bendera', [
          { fileName: 'pengumuman_upacara.mp3', delayBeforeMs: 0, volume: 100 },
          { fileName: 'upacara.mp3', delayBeforeMs: 2000, volume: 100 }
        ]),
        makeSlot('07:45', 'Jam Pelajaran ke-2', ['jam_2.mp3']),
        makeSlot('08:30', 'Jam Pelajaran ke-3', ['jam_3.mp3']),
        makeSlot('09:15', 'Jam Pelajaran ke-4', ['jam_4.mp3']),
        makeSlot('10:00', 'Istirahat 1', ['istirahat_1.mp3']),
        makeSlot('10:15', 'Jam Pelajaran ke-5', ['jam_5.mp3']),
        makeSlot('11:00', 'Jam Pelajaran ke-6', ['jam_6.mp3']),
        makeSlot('11:45', 'Istirahat 2 / Dzuhur', ['istirahat_2.mp3']),
        makeSlot('12:30', 'Jam Pelajaran ke-7', ['jam_7.mp3']),
        makeSlot('13:15', 'Jam Pelajaran ke-8', ['jam_8.mp3']),
        makeSlot('14:00', 'Jam Pelajaran ke-9', ['jam_9.mp3']),
        makeSlot('15:15', 'Bel Pulang', ['pulang.mp3'])
      ];

      const regulerSlots = [
        makeSlot('07:00', 'Pembiasaan / Jam ke-1', ['jam_1.mp3']),
        makeSlot('07:45', 'Jam Pelajaran ke-2', ['jam_2.mp3']),
        makeSlot('08:30', 'Jam Pelajaran ke-3', ['jam_3.mp3']),
        makeSlot('09:15', 'Jam Pelajaran ke-4', ['jam_4.mp3']),
        makeSlot('10:00', 'Istirahat 1', ['istirahat_1.mp3']),
        makeSlot('10:15', 'Jam Pelajaran ke-5', ['jam_5.mp3']),
        makeSlot('11:00', 'Jam Pelajaran ke-6', ['jam_6.mp3']),
        makeSlot('11:45', 'Istirahat 2 / Dzuhur', ['istirahat_2.mp3']),
        makeSlot('12:30', 'Jam Pelajaran ke-7', ['jam_7.mp3']),
        makeSlot('13:15', 'Jam Pelajaran ke-8', ['jam_8.mp3']),
        makeSlot('14:00', 'Jam Pelajaran ke-9', ['jam_9.mp3']),
        makeSlot('15:15', 'Bel Pulang', ['pulang.mp3'])
      ];

      const jumatSlots = [
        makeSlot('07:00', 'Jumat Bersih / Pembiasaan', ['pembiasaan_jumat.mp3']),
        makeSlot('07:30', 'Jam Pelajaran ke-1', ['jam_1.mp3']),
        makeSlot('08:15', 'Jam Pelajaran ke-2', ['jam_2.mp3']),
        makeSlot('09:00', 'Istirahat Jumat', ['istirahat_1.mp3']),
        makeSlot('09:15', 'Jam Pelajaran ke-3', ['jam_3.mp3']),
        makeSlot('10:00', 'Jam Pelajaran ke-4', ['jam_4.mp3']),
        makeSlot('11:15', 'Bel Pulang Jumat', ['pulang.mp3'])
      ];

      const ujianSlots = [
        makeSlot('07:20', 'Persiapan Ruang Ujian', ['persiapan_ujian.mp3']),
        makeSlot('07:30', 'Mulai Ujian Sesi 1', ['ujian_mulai.mp3']),
        makeSlot('09:00', 'Selesai Ujian Sesi 1', ['ujian_selesai.mp3']),
        makeSlot('09:20', 'Persiapan Ujian Sesi 2', ['persiapan_ujian.mp3']),
        makeSlot('09:30', 'Mulai Ujian Sesi 2', ['ujian_mulai.mp3']),
        makeSlot('11:00', 'Selesai Ujian / Pulang', ['pulang.mp3'])
      ];

      insertProfile.run(
        seninId,
        'Senin (Upacara)',
        'Jadwal khusus hari Senin dengan upacara bendera pagi',
        '#2563eb',
        JSON.stringify(seninSlots),
        now,
        now
      );
      insertProfile.run(
        regulerId,
        'Reguler (Selasa–Kamis)',
        'Jadwal KBM normal hari Selasa sampai Kamis',
        '#059669',
        JSON.stringify(regulerSlots),
        now,
        now
      );
      insertProfile.run(
        jumatId,
        'Jumat',
        'Jadwal hari Jumat pulang sebelum sholat Jumat',
        '#7c3aed',
        JSON.stringify(jumatSlots),
        now,
        now
      );
      insertProfile.run(
        ujianId,
        'Ujian (PTS / PAS)',
        'Jadwal 2 sesi untuk masa ujian sekolah',
        '#d97706',
        JSON.stringify(ujianSlots),
        now,
        now
      );

      const insertWeekly = this.sqlite.prepare(
        'INSERT OR REPLACE INTO weekly_rules (day_of_week, profile_id, updated_at) VALUES (?, ?, ?)'
      );
      insertWeekly.run(0, null, now);
      insertWeekly.run(1, seninId, now);
      insertWeekly.run(2, regulerId, now);
      insertWeekly.run(3, regulerId, now);
      insertWeekly.run(4, regulerId, now);
      insertWeekly.run(5, jumatId, now);
      insertWeekly.run(6, null, now);
    }
  }

  public getJwtSecret(): string {
    return this.getMeta('jwt_secret')!;
  }

  public getDeviceToken(): string {
    return this.getMeta('device_token')!;
  }

  public rotateDeviceToken(): string {
    const token = `adb-${crypto.randomBytes(16).toString('hex')}`;
    this.setMeta('device_token', token);
    return token;
  }

  public getScheduleVersion(): number {
    return Number(this.getMeta('schedule_version') || '1');
  }

  public bumpScheduleVersion(): number {
    const next = this.getScheduleVersion() + 1;
    this.setMeta('schedule_version', String(next));
    return next;
  }

  // --- Users ---
  public findUserByUsername(username: string): UserRow | null {
    const row = this.sqlite
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;
    return row ? this.mapUserRow(row) : null;
  }

  public findUserById(id: string): UserRow | null {
    const row = this.sqlite
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapUserRow(row) : null;
  }

  public listUsers(): UserPublic[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.toPublicUser(this.mapUserRow(r)));
  }

  public createUser(input: {
    username: string;
    displayName: string;
    role: UserRole;
    password: string;
  }): UserPublic {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.sqlite
      .prepare(
        `INSERT INTO users (id, username, display_name, role, password_hash, active, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`
      )
      .run(id, input.username, input.displayName, input.role, hashPassword(input.password), now, now);
    return this.toPublicUser(this.findUserById(id)!);
  }

  public updateUser(
    id: string,
    patch: { displayName?: string; role?: UserRole; active?: boolean; password?: string }
  ): UserPublic | null {
    const existing = this.findUserById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const displayName = patch.displayName ?? existing.displayName;
    const role = patch.role ?? existing.role;
    const active = patch.active ?? existing.active;
    const passwordHash = patch.password ? hashPassword(patch.password) : existing.passwordHash;
    const mustChangePassword = patch.password ? 0 : existing.mustChangePassword ? 1 : 0;

    this.sqlite
      .prepare(
        `UPDATE users SET display_name = ?, role = ?, active = ?, password_hash = ?, must_change_password = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(displayName, role, active ? 1 : 0, passwordHash, mustChangePassword, now, id);
    return this.toPublicUser(this.findUserById(id)!);
  }

  public updatePassword(id: string, newPassword: string): void {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?'
      )
      .run(hashPassword(newPassword), now, id);
  }

  public deleteUser(id: string): boolean {
    const res = this.sqlite.prepare('DELETE FROM users WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public toPublicUser(user: UserRow): UserPublic {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private mapUserRow(row: Record<string, unknown>): UserRow {
    return {
      id: String(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      role: String(row.role) as UserRole,
      passwordHash: String(row.password_hash),
      active: Number(row.active) === 1,
      mustChangePassword: Number(row.must_change_password) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  // --- Profiles ---
  public listProfiles(): ScheduleProfile[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM profiles ORDER BY name ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      color: String(r.color),
      slots: sortSlots(JSON.parse(String(r.slots_json)) as ScheduleSlot[]),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    }));
  }

  public getProfile(id: string): ScheduleProfile | null {
    const row = this.sqlite
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      color: String(row.color),
      slots: sortSlots(JSON.parse(String(row.slots_json)) as ScheduleSlot[]),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  public createProfile(input: {
    name: string;
    description: string;
    color: string;
    slots: ScheduleSlot[];
  }): ScheduleProfile {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sorted = sortSlots(input.slots);
    this.sqlite
      .prepare(
        `INSERT INTO profiles (id, name, description, color, slots_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.description, input.color, JSON.stringify(sorted), now, now);
    this.bumpScheduleVersion();
    return this.getProfile(id)!;
  }

  public updateProfile(
    id: string,
    input: { name: string; description: string; color: string; slots: ScheduleSlot[] }
  ): ScheduleProfile | null {
    const existing = this.getProfile(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const sorted = sortSlots(input.slots);
    this.sqlite
      .prepare(
        `UPDATE profiles SET name = ?, description = ?, color = ?, slots_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.name, input.description, input.color, JSON.stringify(sorted), now, id);
    this.bumpScheduleVersion();
    return this.getProfile(id);
  }

  public deleteProfile(id: string): boolean {
    const existing = this.getProfile(id);
    if (!existing) return false;
    const now = new Date().toISOString();
    this.sqlite
      .prepare('UPDATE weekly_rules SET profile_id = NULL, updated_at = ? WHERE profile_id = ?')
      .run(now, id);
    this.sqlite
      .prepare('UPDATE date_overrides SET profile_id = NULL WHERE profile_id = ?')
      .run(id);
    this.sqlite.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    this.bumpScheduleVersion();
    return true;
  }

  // --- Weekly Rules ---
  public listWeeklyRules(): WeeklyRule[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM weekly_rules ORDER BY day_of_week ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      dayOfWeek: Number(r.day_of_week),
      profileId: r.profile_id ? String(r.profile_id) : null,
      updatedAt: String(r.updated_at)
    }));
  }

  public updateWeeklyRules(
    rules: Array<{ dayOfWeek: number; profileId: string | null }>
  ): WeeklyRule[] {
    const now = new Date().toISOString();
    const stmt = this.sqlite.prepare(
      'INSERT OR REPLACE INTO weekly_rules (day_of_week, profile_id, updated_at) VALUES (?, ?, ?)'
    );
    for (const rule of rules) {
      stmt.run(rule.dayOfWeek, rule.profileId, now);
    }
    this.bumpScheduleVersion();
    return this.listWeeklyRules();
  }

  // --- Date Overrides ---
  public listDateOverrides(): DateOverride[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM date_overrides ORDER BY start_date ASC, created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      profileId: r.profile_id ? String(r.profile_id) : null,
      note: String(r.note),
      createdBy: String(r.created_by),
      createdAt: String(r.created_at)
    }));
  }

  public createDateOverride(input: {
    startDate: string;
    endDate: string;
    profileId: string | null;
    note: string;
    createdBy: string;
  }): DateOverride {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO date_overrides (id, start_date, end_date, profile_id, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.startDate, input.endDate, input.profileId, input.note, input.createdBy, now);
    this.bumpScheduleVersion();
    return {
      id,
      ...input,
      createdAt: now
    };
  }

  public upsertSingleDayOverride(input: {
    date: string;
    profileId: string | null;
    note: string;
    createdBy: string;
  }): DateOverride {
    this.sqlite
      .prepare('DELETE FROM date_overrides WHERE start_date = ? AND end_date = ?')
      .run(input.date, input.date);
    return this.createDateOverride({
      startDate: input.date,
      endDate: input.date,
      profileId: input.profileId,
      note: input.note,
      createdBy: input.createdBy
    });
  }

  public deleteDateOverride(id: string): boolean {
    const res = this.sqlite.prepare('DELETE FROM date_overrides WHERE id = ?').run(id);
    if (res.changes > 0) {
      this.bumpScheduleVersion();
      return true;
    }
    return false;
  }

  // --- Shutdown Settings ---
  public getShutdownSettings(): ShutdownSettings {
    const raw = JSON.parse(this.getMeta('shutdown_settings')!);
    return normalizeShutdownSettings(raw);
  }

  public updateShutdownSettings(input: Omit<ShutdownSettings, 'updatedAt'>): ShutdownSettings {
    const next: ShutdownSettings = {
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.setMeta('shutdown_settings', JSON.stringify(next));
    this.bumpScheduleVersion();
    return next;
  }

  public replaceScheduleFromDevice(input: {
    profiles: Array<{
      id: string;
      name: string;
      description: string;
      color: string;
      slots: ScheduleSlot[];
      createdAt?: string;
      updatedAt?: string;
    }>;
    weeklyRules: Array<{ dayOfWeek: number; profileId: string | null }>;
    dateOverrides: Array<{
      id: string;
      startDate: string;
      endDate: string;
      profileId: string | null;
      note: string;
      createdBy: string;
      createdAt?: string;
    }>;
    shutdownSettings: Omit<ShutdownSettings, 'updatedAt'>;
  }): ScheduleSnapshot {
    const now = new Date().toISOString();
    const validProfileIds = new Set(input.profiles.map((p) => p.id));

    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      this.sqlite.prepare('DELETE FROM profiles').run();
      const insertProfile = this.sqlite.prepare(`
        INSERT INTO profiles (id, name, description, color, slots_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const prof of input.profiles) {
        insertProfile.run(
          prof.id,
          prof.name,
          prof.description,
          prof.color,
          JSON.stringify(sortSlots(prof.slots)),
          prof.createdAt || now,
          now
        );
      }

      const insertWeekly = this.sqlite.prepare(
        'INSERT OR REPLACE INTO weekly_rules (day_of_week, profile_id, updated_at) VALUES (?, ?, ?)'
      );
      for (const rule of input.weeklyRules) {
        const pid = rule.profileId && validProfileIds.has(rule.profileId) ? rule.profileId : null;
        insertWeekly.run(rule.dayOfWeek, pid, now);
      }

      this.sqlite.prepare('DELETE FROM date_overrides').run();
      const insertOverride = this.sqlite.prepare(`
        INSERT INTO date_overrides (id, start_date, end_date, profile_id, note, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const ov of input.dateOverrides) {
        const pid = ov.profileId && validProfileIds.has(ov.profileId) ? ov.profileId : null;
        insertOverride.run(
          ov.id,
          ov.startDate,
          ov.endDate,
          pid,
          ov.note,
          ov.createdBy || 'PC Bel Desktop',
          ov.createdAt || now
        );
      }

      this.setMeta(
        'shutdown_settings',
        JSON.stringify({
          ...input.shutdownSettings,
          updatedAt: now
        })
      );
      this.bumpScheduleVersion();
      this.sqlite.exec('COMMIT;');
    } catch (err) {
      this.sqlite.exec('ROLLBACK;');
      throw err;
    }

    return this.getScheduleSnapshot();
  }

  // --- Snapshot ---
  public getScheduleSnapshot(): ScheduleSnapshot {
    return {
      version: this.getScheduleVersion(),
      schoolName: this.schoolName,
      timeZone: this.timeZone,
      profiles: this.listProfiles(),
      weeklyRules: this.listWeeklyRules(),
      dateOverrides: this.listDateOverrides(),
      shutdownSettings: this.getShutdownSettings(),
      generatedAt: new Date().toISOString()
    };
  }

  // --- Device Status & Audio Manifest ---
  public getDeviceStatus(): DeviceStatus {
    return JSON.parse(this.getMeta('device_status')!) as DeviceStatus;
  }

  public updateDeviceStatus(patch: Partial<DeviceStatus>): DeviceStatus {
    const current = this.getDeviceStatus();
    const next: DeviceStatus = { ...current, ...patch };
    this.setMeta('device_status', JSON.stringify(next));
    return next;
  }

  public getAudioManifest(): AudioFileEntry[] {
    return JSON.parse(this.getMeta('audio_manifest')!) as AudioFileEntry[];
  }

  public setAudioManifest(files: AudioFileEntry[], audioDir: string): void {
    this.setMeta('audio_manifest', JSON.stringify(files));
    this.updateDeviceStatus({
      audioDir,
      audioCount: files.length
    });
  }

  // --- Bell Logs ---
  public insertBellLogs(logs: BellLogInput[]): BellLog[] {
    const stmt = this.sqlite.prepare(`
      INSERT OR IGNORE INTO bell_logs
        (id, occurred_at, trigger_type, status, profile_name, slot_label, scheduled_time, files_json, actor_name, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const inserted: BellLog[] = [];
    for (const item of logs) {
      const id = item.id || crypto.randomUUID();
      stmt.run(
        id,
        item.occurredAt,
        item.triggerType,
        item.status,
        item.profileName,
        item.slotLabel,
        item.scheduledTime,
        JSON.stringify(item.files),
        item.actorName,
        item.detail
      );
      inserted.push({
        id,
        occurredAt: item.occurredAt,
        triggerType: item.triggerType,
        status: item.status,
        profileName: item.profileName,
        slotLabel: item.slotLabel,
        scheduledTime: item.scheduledTime,
        files: item.files,
        actorName: item.actorName,
        detail: item.detail
      });
    }
    return inserted;
  }

  public listBellLogs(limit = 100): BellLog[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM bell_logs ORDER BY occurred_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      occurredAt: String(r.occurred_at),
      triggerType: String(r.trigger_type) as BellLog['triggerType'],
      status: String(r.status) as BellLog['status'],
      profileName: r.profile_name ? String(r.profile_name) : null,
      slotLabel: String(r.slot_label),
      scheduledTime: r.scheduled_time ? String(r.scheduled_time) : null,
      files: JSON.parse(String(r.files_json)) as string[],
      actorName: r.actor_name ? String(r.actor_name) : null,
      detail: r.detail ? String(r.detail) : null
    }));
  }

  // --- Server Uploaded Audio ---
  public listServerAudioFiles(): ServerAudioFile[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM uploaded_audio ORDER BY uploaded_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      fileName: String(r.file_name),
      relativePath: String(r.relative_path),
      sizeBytes: Number(r.size_bytes),
      sha256: String(r.sha256),
      uploadedBy: String(r.uploaded_by),
      uploadedAt: String(r.uploaded_at)
    }));
  }

  public getServerAudioFile(fileName: string): ServerAudioFile | null {
    const row = this.sqlite
      .prepare('SELECT * FROM uploaded_audio WHERE file_name = ?')
      .get(fileName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      uploadedBy: String(row.uploaded_by),
      uploadedAt: String(row.uploaded_at)
    };
  }

  public upsertServerAudioFile(input: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
    uploadedBy: string;
  }): ServerAudioFile {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const relativePath = `_web/${input.fileName}`;
    this.sqlite
      .prepare(
        `INSERT INTO uploaded_audio (id, file_name, relative_path, size_bytes, sha256, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_name) DO UPDATE SET
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           uploaded_by = excluded.uploaded_by,
           uploaded_at = excluded.uploaded_at`
      )
      .run(id, input.fileName, relativePath, input.sizeBytes, input.sha256, input.uploadedBy, now);
    return this.getServerAudioFile(input.fileName)!;
  }

  public deleteServerAudioFile(fileName: string): boolean {
    const res = this.sqlite
      .prepare('DELETE FROM uploaded_audio WHERE file_name = ?')
      .run(fileName);
    return res.changes > 0;
  }

  // --- Backup Settings & Snapshots ---
  public getBackupSettings(): BackupSettings {
    const raw = this.getMeta('backup_settings');
    if (!raw) {
      return {
        enabled: true,
        time: '02:00',
        retainCount: 14,
        lastBackupAt: null,
        updatedAt: new Date().toISOString()
      };
    }
    return JSON.parse(raw) as BackupSettings;
  }

  public updateBackupSettings(
    patch: Partial<Pick<BackupSettings, 'enabled' | 'time' | 'retainCount' | 'lastBackupAt'>>
  ): BackupSettings {
    const current = this.getBackupSettings();
    const next: BackupSettings = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.setMeta('backup_settings', JSON.stringify(next));
    return next;
  }

  public createDatabaseBackup(backupsDir: string, kind: 'auto' | 'manual'): BackupFileInfo {
    fs.mkdirSync(backupsDir, { recursive: true });
    const now = new Date();
    const stamp = now
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    const fileName = `backup-${kind}-${stamp}.db`;
    const targetPath = path.join(backupsDir, fileName);
    const tmpPath = `${targetPath}.tmp`;

    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    const escapedPath = tmpPath.replace(/'/g, "''");
    this.sqlite.exec(`VACUUM INTO '${escapedPath}';`);
    fs.renameSync(tmpPath, targetPath);

    const stat = fs.statSync(targetPath);
    const createdAt = now.toISOString();
    this.updateBackupSettings({ lastBackupAt: createdAt });

    const settings = this.getBackupSettings();
    this.pruneBackups(backupsDir, settings.retainCount);

    return {
      fileName,
      sizeBytes: stat.size,
      createdAt,
      kind
    };
  }

  public listBackups(backupsDir: string): BackupFileInfo[] {
    if (!fs.existsSync(backupsDir)) return [];
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    const items: BackupFileInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.db')) continue;
      const fullPath = path.join(backupsDir, entry.name);
      const stat = fs.statSync(fullPath);
      const kind: 'auto' | 'manual' = entry.name.startsWith('backup-auto-') ? 'auto' : 'manual';
      items.push({
        fileName: entry.name,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        kind
      });
    }

    items.sort((a, b) => b.fileName.localeCompare(a.fileName));
    return items;
  }

  public resolveBackupPath(backupsDir: string, fileName: string): string | null {
    const root = path.resolve(backupsDir);
    const safeBase = path.basename(fileName);
    if (!safeBase.endsWith('.db')) return null;
    const target = path.resolve(root, safeBase);
    if (!target.startsWith(root + path.sep)) return null;
    return target;
  }

  public deleteBackup(backupsDir: string, fileName: string): boolean {
    const target = this.resolveBackupPath(backupsDir, fileName);
    if (!target || !fs.existsSync(target)) return false;
    fs.unlinkSync(target);
    return true;
  }

  private pruneBackups(backupsDir: string, retainCount: number): void {
    const all = this.listBackups(backupsDir);
    const toDelete = all.slice(Math.max(1, retainCount));
    for (const item of toDelete) {
      const p = this.resolveBackupPath(backupsDir, item.fileName);
      if (p && fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  }
}
