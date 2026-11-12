import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BellOff,
  CalendarCheck,
  Clock,
  Play,
  RotateCcw,
  ScrollText
} from 'lucide-react';
import {
  DAY_NAMES_ID,
  getNextBellSlot,
  getZonedDateParts,
  resolveDaySchedule,
  type AudioFileEntry,
  type AudioStep,
  type BellLog,
  type DeviceStatus,
  type ScheduleSnapshot,
  type ShutdownAction
} from '@jadwal-adb/shared';
import { RemoteControlPanel } from '../components/RemoteControlPanel.js';

interface DashboardPageProps {
  snapshot: ScheduleSnapshot;
  status: DeviceStatus;
  audioFiles: AudioFileEntry[];
  logs: BellLog[];
  serverTimeOffsetMs: number;
  onSetTodayOverride: (profileId: string | null, note: string) => Promise<void>;
  onDeleteOverride: (id: string) => Promise<void>;
  onPlayManual: (label: string, steps: AudioStep[]) => Promise<void>;
  onStopAudio: () => Promise<void>;
  onShutdownPc: (action: ShutdownAction, graceSeconds: number, reason: string) => Promise<void>;
}

const LOG_STATUS_BADGE: Record<BellLog['status'], { label: string; cls: string }> = {
  played: { label: 'Berhasil', cls: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'Sebagian', cls: 'bg-amber-100 text-amber-800' },
  missing_file: { label: 'File Hilang', cls: 'bg-rose-100 text-rose-800' },
  failed: { label: 'Gagal', cls: 'bg-rose-100 text-rose-800' },
  stopped: { label: 'Dihentikan', cls: 'bg-slate-200 text-slate-700' },
  shutdown_triggered: { label: 'Shutdown', cls: 'bg-purple-100 text-purple-800' },
  shutdown_cancelled: { label: 'Shutdown Batal', cls: 'bg-slate-100 text-slate-700' }
};

export function DashboardPage({
  snapshot,
  status,
  audioFiles,
  logs,
  serverTimeOffsetMs,
  onSetTodayOverride,
  onDeleteOverride,
  onPlayManual,
  onStopAudio,
  onShutdownPc
}: DashboardPageProps) {
  const [nowMs, setNowMs] = useState(() => Date.now() + serverTimeOffsetMs);
  const [overrideProfileId, setOverrideProfileId] = useState<string>('');
  const [overrideNote, setOverrideNote] = useState('Penyesuaian jadwal hari ini');
  const [busyOverride, setBusyOverride] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now() + serverTimeOffsetMs);
    }, 1000);
    return () => clearInterval(id);
  }, [serverTimeOffsetMs]);

  const parts = getZonedDateParts(nowMs, snapshot.timeZone);
  const resolved = resolveDaySchedule(snapshot, parts.dateStr, parts.dayOfWeek);
  const nextSlot = getNextBellSlot(resolved, parts.timeStr, true);
  const availableSet = new Set(audioFiles.map((f) => f.relativePath.toLowerCase()));

  const isSingleDayOverrideToday =
    resolved.source === 'override' &&
    resolved.override &&
    resolved.override.startDate === parts.dateStr &&
    resolved.override.endDate === parts.dateStr;

  const handleApplyToday = async (profileId: string | null, note: string) => {
    setBusyOverride(true);
    try {
      await onSetTodayOverride(profileId, note);
    } finally {
      setBusyOverride(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Left 2 columns: Today's Schedule + Quick Override */}
      <div className="space-y-5 lg:col-span-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <CalendarCheck className="h-4 w-4 text-blue-600" />
                <span>
                  {DAY_NAMES_ID[parts.dayOfWeek]}, {parts.dateStr}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-bold text-slate-900">
                  {resolved.profile ? resolved.profile.name : 'Libur / Bel Nonaktif'}
                </h2>
                {resolved.profile && (
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: resolved.profile.color }}
                  />
                )}
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  {resolved.source === 'override'
                    ? `Override: ${resolved.override?.note}`
                    : 'Jadwal Mingguan'}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-900 px-4 py-2 text-right text-white">
              <div className="text-xs text-slate-300">Waktu Sekolah (WIB)</div>
              <div className="font-mono text-xl font-bold">
                {parts.timeStr}:{String(parts.second).padStart(2, '0')}
              </div>
            </div>
          </div>

          {nextSlot ? (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-950">
              <div className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-blue-600" />
                <span>
                  Bel berikutnya: <strong>{nextSlot.label}</strong> pukul{' '}
                  <strong>{nextSlot.time}</strong>
                </span>
              </div>
              <span className="hidden text-xs text-blue-700 sm:inline">
                {nextSlot.steps.map((s) => s.fileName).join(' → ')}
              </span>
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
              Tidak ada jadwal bel tersisa untuk hari ini.
            </div>
          )}

          {/* Quick Override Controls for Piket/Waka/Admin */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Ubah Cepat Khusus Hari Ini (Piket / Waka)
              </span>
              {isSingleDayOverrideToday && resolved.override && (
                <button
                  type="button"
                  disabled={busyOverride}
                  onClick={() => onDeleteOverride(resolved.override!.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  Kembalikan ke Jadwal Normal
                </button>
              )}
            </div>

            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <select
                value={overrideProfileId}
                onChange={(e) => setOverrideProfileId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
              >
                <option value="">-- Pilih Profil Pengganti Hari Ini --</option>
                {snapshot.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="Alasan perubahan..."
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={!overrideProfileId || busyOverride}
                onClick={() =>
                  handleApplyToday(overrideProfileId, overrideNote.trim() || 'Jadwal khusus hari ini')
                }
                className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                Terapkan
              </button>
              <button
                type="button"
                disabled={busyOverride}
                onClick={() =>
                  handleApplyToday(null, overrideNote.trim() || 'Bel dimatikan sementara hari ini')
                }
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <BellOff className="h-3.5 w-3.5" />
                Matikan Bel Hari Ini
              </button>
            </div>
          </div>

          {/* Slots Table */}
          <div className="mt-4 space-y-2">
            {resolved.slots.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                Tidak ada bel terjadwal hari ini.
              </div>
            ) : (
              resolved.slots.map((slot) => {
                const isNext = nextSlot?.id === slot.id;
                const isPast = slot.time < parts.timeStr;
                const missingFiles =
                  audioFiles.length > 0
                    ? slot.steps
                        .map((st) => st.fileName)
                        .filter((f) => !availableSet.has(f.toLowerCase()))
                    : [];

                return (
                  <div
                    key={slot.id}
                    className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${
                      isNext
                        ? 'border-blue-300 bg-blue-50/70'
                        : !slot.enabled || isPast
                          ? 'border-slate-100 bg-slate-50/80 text-slate-400'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`rounded-lg px-2.5 py-1 font-mono text-sm font-bold ${
                          isNext
                            ? 'bg-blue-600 text-white'
                            : isPast || !slot.enabled
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-slate-900 text-white'
                        }`}
                      >
                        {slot.time}
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-sm font-semibold ${
                              !slot.enabled ? 'line-through' : ''
                            }`}
                          >
                            {slot.label}
                          </span>
                          {isNext && (
                            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                              BERIKUTNYA
                            </span>
                          )}
                          {!slot.enabled && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              Nonaktif
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {slot.steps
                            .map((s, i) =>
                              i > 0 && s.delayBeforeMs > 0
                                ? `(jeda ${s.delayBeforeMs / 1000}s) ${s.fileName}`
                                : s.fileName
                            )
                            .join(' → ')}
                        </div>
                        {missingFiles.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-xs font-medium text-rose-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            File belum ditemukan di PC Bel: {missingFiles.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!status.online}
                      onClick={() => onPlayManual(`Tes: ${slot.label}`, slot.steps)}
                      className="inline-flex items-center gap-1 self-end rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 sm:self-auto"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      Putar
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Logs */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900">
            <ScrollText className="h-5 w-5 text-slate-600" />
            Riwayat Bel & Aktivitas Terbaru
          </h3>
          <div className="mt-3 divide-y divide-slate-100">
            {logs.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Belum ada catatan aktivitas bel.
              </p>
            ) : (
              logs.slice(0, 15).map((log) => {
                const badge = LOG_STATUS_BADGE[log.status] || {
                  label: log.status,
                  cls: 'bg-slate-100 text-slate-700'
                };
                return (
                  <div
                    key={log.id}
                    className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {log.slotLabel}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {log.profileName && (
                          <span className="text-xs text-slate-500">• {log.profileName}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {log.files.length > 0 ? log.files.join(', ') : log.detail || '-'}
                        {log.actorName ? ` • oleh ${log.actorName}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">
                      {new Date(log.occurredAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right column: Remote Bell & PC Power Controls */}
      <div>
        <RemoteControlPanel
          status={status}
          audioFiles={audioFiles}
          onPlayManual={onPlayManual}
          onStopAudio={onStopAudio}
          onShutdownPc={onShutdownPc}
        />
      </div>
    </div>
  );
}
