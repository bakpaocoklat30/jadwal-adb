import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  DatabaseBackup,
  Download,
  KeyRound,
  Plus,
  Power,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
  Users
} from 'lucide-react';
import {
  DAY_NAMES_ID,
  normalizeShutdownSettings,
  type BackupFileInfo,
  type BackupSettings,
  type ScheduleSnapshot,
  type ShutdownDayRule,
  type ShutdownSettings,
  type UserPublic,
  type UserRole
} from '@jadwal-adb/shared';
import { api } from '../api.js';

interface SettingsPageProps {
  currentUser: UserPublic;
  shutdownSettings: ShutdownSettings;
  onUpdateShutdownSettings: (settings: Omit<ShutdownSettings, 'updatedAt'>) => Promise<void>;
  onPasswordChanged: (user: UserPublic) => void;
  onSnapshotRestored: (snapshot: ScheduleSnapshot) => void;
  onNotify: (message: string) => void;
}

async function copyTextSafe(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below for non-HTTPS contexts
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

export function SettingsPage({
  currentUser,
  shutdownSettings,
  onUpdateShutdownSettings,
  onPasswordChanged,
  onSnapshotRestored,
  onNotify
}: SettingsPageProps) {
  const isAdmin = currentUser.role === 'admin';
  const canEditShutdown = currentUser.role === 'admin' || currentUser.role === 'waka';

  // Auto-shutdown state (per-day)
  const normalizedInitial = normalizeShutdownSettings(shutdownSettings);
  const [sdEnabled, setSdEnabled] = useState(normalizedInitial.enabled);
  const [sdGrace, setSdGrace] = useState(normalizedInitial.graceSeconds);
  const [sdRules, setSdRules] = useState<ShutdownDayRule[]>(normalizedInitial.dayRules);
  const [savingSd, setSavingSd] = useState(false);

  // Change own password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  // Admin: device token & users
  const [deviceToken, setDeviceToken] = useState<string>('');
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('piket');
  const [newUserPass, setNewUserPass] = useState('');

  // Backup & Restore state
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(null);
  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [savingBackup, setSavingBackup] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringJson, setRestoringJson] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const normalized = normalizeShutdownSettings(shutdownSettings);
    setSdEnabled(normalized.enabled);
    setSdGrace(normalized.graceSeconds);
    setSdRules(normalized.dayRules);
  }, [shutdownSettings]);

  useEffect(() => {
    if (!isAdmin) return;
    void api.getDeviceToken().then((r) => setDeviceToken(r.deviceToken));
    void api.listUsers().then((r) => setUsers(r.users));
    void api.getBackups().then((r) => {
      setBackupSettings(r.settings);
      setBackupFiles(r.files);
    });
  }, [isAdmin]);

  const handleSaveShutdown = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSd(true);
    try {
      await onUpdateShutdownSettings({
        enabled: sdEnabled,
        graceSeconds: sdGrace,
        dayRules: sdRules
      });
    } finally {
      setSavingSd(false);
    }
  };

  const updateDayRule = (dayOfWeek: number, patch: Partial<ShutdownDayRule>) => {
    setSdRules((prev) =>
      prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r))
    );
  };

  const copyMondayToTueThu = () => {
    const mon = sdRules.find((r) => r.dayOfWeek === 1);
    if (!mon) return;
    setSdRules((prev) =>
      prev.map((r) =>
        r.dayOfWeek >= 2 && r.dayOfWeek <= 4
          ? { ...r, enabled: mon.enabled, time: mon.time }
          : r
      )
    );
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPwd(true);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      onPasswordChanged(res.user);
      setCurrentPassword('');
      setNewPassword('');
      onNotify('Password berhasil diperbarui');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal mengubah password');
    } finally {
      setSavingPwd(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim(),
        role: newRole,
        password: newUserPass
      });
      setUsers((prev) => [...prev, res.user]);
      setNewUsername('');
      setNewDisplayName('');
      setNewUserPass('');
      onNotify(`Akun ${res.user.username} berhasil ditambahkan`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Gagal menambah akun');
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Auto-shutdown Settings */}
        <form
          onSubmit={handleSaveShutdown}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
        >
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Power className="h-5 w-5 text-rose-600" />
            Auto-Shutdown PC Bel Per Hari
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Atur jam mati otomatis berbeda untuk tiap hari (misalnya Senin–Kamis sore, Jumat siang,
            Sabtu/Minggu berbeda atau nonaktif).
          </p>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={sdEnabled}
                  disabled={!canEditShutdown}
                  onChange={(e) => setSdEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Aktifkan Auto-Shutdown Terjadwal
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Countdown:</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={sdGrace}
                  disabled={!canEditShutdown}
                  onChange={(e) => setSdGrace(Number(e.target.value || 20))}
                  className="w-16 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold"
                />
                <span className="text-xs text-slate-500">detik</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">Jadwal Mati per Hari</span>
                {canEditShutdown && (
                  <button
                    type="button"
                    onClick={copyMondayToTueThu}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Samakan Senin → Sel–Kam
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
                  const rule = sdRules.find((r) => r.dayOfWeek === dayIdx) ?? {
                    dayOfWeek: dayIdx,
                    enabled: false,
                    time: '16:30'
                  };
                  const isWeekend = dayIdx === 0 || dayIdx === 6;
                  return (
                    <div
                      key={dayIdx}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                        rule.enabled
                          ? 'border-slate-200 bg-white'
                          : 'border-slate-100 bg-slate-50 text-slate-400'
                      }`}
                    >
                      <label className="flex items-center gap-2.5 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          disabled={!canEditShutdown}
                          onChange={(e) => updateDayRule(dayIdx, { enabled: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span className={isWeekend ? 'text-amber-700' : 'text-slate-800'}>
                          {DAY_NAMES_ID[dayIdx]}
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        {!rule.enabled && (
                          <span className="text-[11px] text-slate-400">Nonaktif</span>
                        )}
                        <input
                          type="time"
                          value={rule.time}
                          disabled={!canEditShutdown || !rule.enabled}
                          onChange={(e) => updateDayRule(dayIdx, { time: e.target.value })}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canEditShutdown && (
              <button
                type="submit"
                disabled={savingSd}
                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingSd ? 'Menyimpan...' : 'Simpan Pengaturan Auto-Shutdown'}
              </button>
            )}
          </div>
        </form>

        {/* Change own password */}
        <form
          onSubmit={handleChangePassword}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
        >
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Shield className="h-5 w-5 text-blue-600" />
            Ganti Password Akun Saya
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Akun aktif: <strong>{currentUser.username}</strong> ({currentUser.displayName})
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Password Saat Ini
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Password Baru (minimal 6 karakter)
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingPwd}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingPwd ? 'Menyimpan...' : 'Perbarui Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Admin only sections */}
      {isAdmin && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Pairing Aplikasi Desktop Windows
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Masukkan URL Server ini dan Device Token berikut ke pengaturan aplikasi Bel Sekolah
              ADB di komputer Windows.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">URL Server</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={window.location.origin}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyTextSafe(window.location.origin);
                      onNotify(ok ? 'URL Server disalin' : 'Gagal menyalin, salin manual dari kotak teks');
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Salin
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Device Token
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={deviceToken}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyTextSafe(deviceToken);
                      onNotify(ok ? 'Device Token disalin' : 'Gagal menyalin, salin manual dari kotak teks');
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Salin
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (
                    confirm(
                      'Buat ulang Device Token? Aplikasi Windows yang memakai token lama akan terputus sampai token barunya diinput.'
                    )
                  ) {
                    const res = await api.rotateDeviceToken();
                    setDeviceToken(res.deviceToken);
                    onNotify('Device Token baru dibuat');
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Buat Token Baru
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Users className="h-5 w-5 text-indigo-600" />
              Manajemen Pengguna (Waka / Admin / Piket)
            </h3>

            <form onSubmit={handleCreateUser} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username (tanpa spasi)"
                required
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="Nama Tampilan"
                required
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="piket">Guru Piket</option>
                <option value="waka">Waka Kurikulum</option>
                <option value="admin">Admin Jadwal</option>
              </select>
              <input
                type="password"
                value={newUserPass}
                onChange={(e) => setNewUserPass(e.target.value)}
                placeholder="Password min 6 char"
                minLength={6}
                required
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 sm:col-span-2"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Akun
              </button>
            </form>

            <div className="mt-4 divide-y divide-slate-100">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-800">
                      {u.displayName}{' '}
                      <span className="font-mono text-slate-400">@{u.username}</span>
                    </p>
                    <p className="text-slate-500">
                      Peran: <strong className="uppercase">{u.role}</strong> •{' '}
                      {u.active ? 'Aktif' : 'Nonaktif'}
                    </p>
                  </div>
                  {u.id !== currentUser.id && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await api.updateUser(u.id, { active: !u.active });
                          setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
                        }}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50"
                      >
                        {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Hapus user @${u.username}?`)) {
                            await api.deleteUser(u.id);
                            setUsers((prev) => prev.filter((x) => x.id !== u.id));
                          }
                        }}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Backup & Restore section */}
      {(isAdmin || canEditShutdown) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* JSON Schedule Export & Restore (Admin + Waka) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Download className="h-5 w-5 text-blue-600" />
              Export & Restore Jadwal (JSON)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Unduh cadangan profil jadwal, aturan mingguan, kalender ujian/libur, dan auto-shutdown
              dalam format `.json`, atau pulihkan kembali kapan saja.
            </p>

            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={async () => {
                  const dateStr = new Date().toISOString().slice(0, 10);
                  await api.downloadAuthorizedFile(
                    '/api/backups/schedule-json',
                    `jadwal-adb-${dateStr}.json`
                  );
                  onNotify('File backup jadwal (.json) diunduh');
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                Download Backup Jadwal (.json)
              </button>

              <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100">
                <Upload className="h-4 w-4" />
                {restoringJson ? 'Memulihkan...' : 'Restore dari File (.json)'}
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  disabled={restoringJson}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (
                      !confirm(
                        `Pulihkan jadwal dari "${file.name}"? Jadwal saat ini akan diganti (backup keamanan otomatis dibuat di server sebelum menimpa).`
                      )
                    ) {
                      e.target.value = '';
                      return;
                    }
                    setRestoringJson(true);
                    try {
                      const raw = JSON.parse(await file.text()) as unknown;
                      const res = await api.restoreScheduleJson(raw);
                      onSnapshotRestored(res.snapshot);
                      if (isAdmin) {
                        setBackupFiles(res.files);
                      }
                      onNotify('Jadwal berhasil dipulihkan & disinkronkan ke PC Bel');
                    } catch (err) {
                      onNotify(
                        err instanceof Error ? err.message : 'File backup JSON tidak valid'
                      );
                    } finally {
                      setRestoringJson(false);
                      if (restoreInputRef.current) restoreInputRef.current.value = '';
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {/* Full SQLite Database Auto/Manual Backup (Admin only) */}
          {isAdmin && backupSettings && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <DatabaseBackup className="h-5 w-5 text-emerald-600" />
                    Backup Database Server (.db)
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Cadangan penuh SQLite (user, token, jadwal, log). Tersimpan di volume{' '}
                    <code className="rounded bg-slate-100 px-1">data/backups/</code>.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={creatingBackup}
                  onClick={async () => {
                    setCreatingBackup(true);
                    try {
                      const res = await api.createBackup();
                      setBackupSettings(res.settings);
                      setBackupFiles(res.files);
                      onNotify(`Backup manual dibuat: ${res.file.fileName}`);
                    } finally {
                      setCreatingBackup(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <DatabaseBackup className="h-3.5 w-3.5" />
                  {creatingBackup ? 'Membackup...' : 'Backup Sekarang'}
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingBackup(true);
                  try {
                    const res = await api.updateBackupSettings({
                      enabled: backupSettings.enabled,
                      time: backupSettings.time,
                      retainCount: backupSettings.retainCount
                    });
                    setBackupSettings(res.settings);
                    onNotify('Pengaturan auto-backup disimpan');
                  } finally {
                    setSavingBackup(false);
                  }
                }}
                className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-3"
              >
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 sm:col-span-3">
                  <input
                    type="checkbox"
                    checked={backupSettings.enabled}
                    onChange={(e) =>
                      setBackupSettings((prev) =>
                        prev ? { ...prev, enabled: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Aktifkan Auto-Backup Harian Otomatis
                </label>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Jam Backup (WIB)
                  </label>
                  <input
                    type="time"
                    value={backupSettings.time}
                    onChange={(e) =>
                      setBackupSettings((prev) =>
                        prev ? { ...prev, time: e.target.value } : prev
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Simpan Maksimal
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={backupSettings.retainCount}
                    onChange={(e) =>
                      setBackupSettings((prev) =>
                        prev ? { ...prev, retainCount: Number(e.target.value || 14) } : prev
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={savingBackup}
                    className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    {savingBackup ? 'Menyimpan...' : 'Simpan Jadwal'}
                  </button>
                </div>
              </form>

              <div className="mt-4 max-h-56 divide-y divide-slate-100 overflow-y-auto">
                {backupFiles.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    Belum ada file backup database. Klik <strong>Backup Sekarang</strong> untuk
                    membuat yang pertama.
                  </p>
                ) : (
                  backupFiles.map((f) => (
                    <div key={f.fileName} className="flex items-center justify-between gap-2 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono font-medium text-slate-800">
                            {f.fileName}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              f.kind === 'auto'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {f.kind === 'auto' ? 'Auto' : 'Manual'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {(f.sizeBytes / 1024).toFixed(0)} KB •{' '}
                          {new Date(f.createdAt).toLocaleString('id-ID')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            void api.downloadAuthorizedFile(
                              `/api/backups/${encodeURIComponent(f.fileName)}/download`,
                              f.fileName
                            )
                          }
                          className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Unduh
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Hapus file backup "${f.fileName}"?`)) {
                              const res = await api.deleteBackup(f.fileName);
                              setBackupFiles(res.files);
                            }
                          }}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
