import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Power, RefreshCw, Shield, Trash2, Users } from 'lucide-react';
import {
  DAY_NAMES_ID,
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
  onNotify
}: SettingsPageProps) {
  const isAdmin = currentUser.role === 'admin';
  const canEditShutdown = currentUser.role === 'admin' || currentUser.role === 'waka';

  // Auto-shutdown state
  const [sdEnabled, setSdEnabled] = useState(shutdownSettings.enabled);
  const [sdTime, setSdTime] = useState(shutdownSettings.time);
  const [sdDays, setSdDays] = useState<number[]>(shutdownSettings.daysOfWeek);
  const [sdGrace, setSdGrace] = useState(shutdownSettings.graceSeconds);
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

  useEffect(() => {
    setSdEnabled(shutdownSettings.enabled);
    setSdTime(shutdownSettings.time);
    setSdDays(shutdownSettings.daysOfWeek);
    setSdGrace(shutdownSettings.graceSeconds);
  }, [shutdownSettings]);

  useEffect(() => {
    if (!isAdmin) return;
    void api.getDeviceToken().then((r) => setDeviceToken(r.deviceToken));
    void api.listUsers().then((r) => setUsers(r.users));
  }, [isAdmin]);

  const handleSaveShutdown = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSd(true);
    try {
      await onUpdateShutdownSettings({
        enabled: sdEnabled,
        time: sdTime,
        daysOfWeek: sdDays,
        graceSeconds: sdGrace
      });
    } finally {
      setSavingSd(false);
    }
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
            Auto-Shutdown PC Bel Terjadwal
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Matikan komputer bel otomatis setiap sore setelah seluruh jadwal selesai.
          </p>

          <div className="mt-4 space-y-4">
            <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={sdEnabled}
                disabled={!canEditShutdown}
                onChange={(e) => setSdEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Aktifkan Auto-Shutdown Harian
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Jam Shutdown
                </label>
                <input
                  type="time"
                  value={sdTime}
                  disabled={!canEditShutdown}
                  onChange={(e) => setSdTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Countdown Pengaman (detik)
                </label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={sdGrace}
                  disabled={!canEditShutdown}
                  onChange={(e) => setSdGrace(Number(e.target.value || 20))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Hari Aktif</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
                  const active = sdDays.includes(dayIdx);
                  return (
                    <button
                      key={dayIdx}
                      type="button"
                      disabled={!canEditShutdown}
                      onClick={() =>
                        setSdDays((prev) =>
                          prev.includes(dayIdx)
                            ? prev.filter((d) => d !== dayIdx)
                            : [...prev, dayIdx]
                        )
                      }
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                        active
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {DAY_NAMES_ID[dayIdx]}
                    </button>
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
    </div>
  );
}
