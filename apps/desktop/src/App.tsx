import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Clock,
  FolderOpen,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  Play,
  PowerOff,
  RefreshCw,
  Settings,
  ShieldCheck,
  Square,
  Upload,
  Volume2,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  DAY_NAMES_ID,
  getNextBellSlot,
  getZonedDateParts,
  resolveDaySchedule,
  type AudioStep
} from '@jadwal-adb/shared';
import type { AudioPlayJob, DesktopConfig, DesktopUIState } from '../electron/types.js';
import { ScheduleManager } from './components/ScheduleManager.js';

type DesktopTab = 'today' | 'manage' | 'audio' | 'settings';

export function App() {
  const [state, setState] = useState<DesktopUIState | null>(null);
  const [tab, setTab] = useState<DesktopTab>('today');
  const [nowMs, setNowMs] = useState(Date.now());
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  // Settings form state
  const [formConfig, setFormConfig] = useState<DesktopConfig | null>(null);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);

  // Lock screen & PIN change state
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinChangeMsg, setPinChangeMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const wasLockedRef = useRef(true);

  const activeAudioRef = useRef<{
    jobId: string;
    abort: () => void;
  } | null>(null);
  const stateRef = useRef<DesktopUIState | null>(null);
  stateRef.current = state;

  const stopActiveAudio = useCallback(() => {
    if (activeAudioRef.current) {
      activeAudioRef.current.abort();
      activeAudioRef.current = null;
    }
  }, []);

  const playJob = useCallback(
    async (job: AudioPlayJob) => {
      stopActiveAudio();

      let aborted = false;
      let currentAudio: HTMLAudioElement | null = null;
      let sleepTimer: ReturnType<typeof setTimeout> | null = null;
      let resolveAbortWait: (() => void) | null = null;

      const controller = {
        jobId: job.jobId,
        abort: () => {
          aborted = true;
          if (sleepTimer) clearTimeout(sleepTimer);
          if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = '';
          }
          if (resolveAbortWait) resolveAbortWait();
        }
      };
      activeAudioRef.current = controller;
      window.desktopApi.reportAudioStarted(job.jobId, job.slotLabel);

      const playedFiles: string[] = [];
      const missingFiles: string[] = [];
      let failedCount = 0;

      for (const step of job.steps) {
        if (aborted) break;

        if (step.delayBeforeMs > 0) {
          await new Promise<void>((resolve) => {
            resolveAbortWait = resolve;
            sleepTimer = setTimeout(() => {
              resolveAbortWait = null;
              resolve();
            }, step.delayBeforeMs);
          });
        }
        if (aborted) break;

        const cfg = stateRef.current?.config;
        const masterVol = cfg?.masterVolume ?? 100;
        const effectiveVol = Math.max(0, Math.min(1, (masterVol / 100) * (step.volume / 100)));
        const url = `bell-audio://local/file?path=${encodeURIComponent(step.fileName)}`;

        const outcome = await new Promise<'ok' | 'missing' | 'error' | 'aborted'>((resolve) => {
          const audio = new Audio(url);
          currentAudio = audio;
          audio.volume = effectiveVol;

          const finish = (res: 'ok' | 'missing' | 'error' | 'aborted') => {
            currentAudio = null;
            resolveAbortWait = null;
            resolve(res);
          };

          resolveAbortWait = () => finish('aborted');

          audio.addEventListener('ended', () => finish('ok'), { once: true });
          audio.addEventListener(
            'error',
            () => {
              // Check if file was known missing in scanned list
              const existsInList = stateRef.current?.audioFiles.some(
                (f) => f.relativePath.toLowerCase() === step.fileName.toLowerCase()
              );
              finish(existsInList ? 'error' : 'missing');
            },
            { once: true }
          );

          const startPlay = async () => {
            try {
              const sinkId = cfg?.audioOutputDeviceId;
              const audioWithSink = audio as HTMLAudioElement & {
                setSinkId?: (id: string) => Promise<void>;
              };
              if (sinkId && typeof audioWithSink.setSinkId === 'function') {
                await audioWithSink.setSinkId(sinkId).catch(() => {});
              }
              await audio.play();
            } catch {
              finish('error');
            }
          };

          void startPlay();
        });

        if (outcome === 'aborted') {
          aborted = true;
          break;
        } else if (outcome === 'ok') {
          playedFiles.push(step.fileName);
        } else if (outcome === 'missing') {
          missingFiles.push(step.fileName);
        } else {
          failedCount += 1;
        }
      }

      if (activeAudioRef.current?.jobId === job.jobId) {
        activeAudioRef.current = null;
      }

      let status: 'played' | 'partial' | 'missing_file' | 'failed' | 'stopped' = 'played';
      let detail: string | null = null;

      if (aborted) {
        status = 'stopped';
        detail = 'Audio dihentikan';
      } else if (missingFiles.length > 0 && playedFiles.length === 0) {
        status = 'missing_file';
        detail = `File tidak ditemukan: ${missingFiles.join(', ')}`;
      } else if (missingFiles.length > 0 || failedCount > 0) {
        status = playedFiles.length > 0 ? 'partial' : 'failed';
        detail = [
          missingFiles.length > 0 ? `File hilang: ${missingFiles.join(', ')}` : null,
          failedCount > 0 ? `${failedCount} file gagal diputar` : null
        ]
          .filter(Boolean)
          .join('; ');
      }

      window.desktopApi.reportAudioFinished({
        jobId: job.jobId,
        triggerType: job.triggerType,
        status,
        profileName: job.profileName,
        slotLabel: job.slotLabel,
        scheduledTime: job.scheduledTime,
        files: job.steps.map((s) => s.fileName),
        actorName: job.actorName,
        detail
      });
    },
    [stopActiveAudio]
  );

  useEffect(() => {
    void window.desktopApi.getState().then((initial) => {
      setState(initial);
      wasLockedRef.current = initial.locked;
      if (!initial.locked) {
        setFormConfig(initial.config);
      }
    });

    if (navigator.mediaDevices?.enumerateDevices) {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => setAudioDevices(devs.filter((d) => d.kind === 'audiooutput')))
        .catch(() => {});
    }

    const unsubState = window.desktopApi.onStateUpdated((next) => {
      setState(next);
      if (!next.locked && (wasLockedRef.current || !formConfig)) {
        setFormConfig(next.config);
      }
      wasLockedRef.current = next.locked;
    });
    const unsubPlay = window.desktopApi.onPlayAudioJob((job) => {
      void playJob(job);
    });
    const unsubStop = window.desktopApi.onStopAudioCommand(() => {
      stopActiveAudio();
    });

    const tick = setInterval(() => setNowMs(Date.now()), 1000);

    let lastPing = 0;
    const onUserActivity = () => {
      const now = Date.now();
      if (now - lastPing > 15_000) {
        lastPing = now;
        window.desktopApi.touchActivity();
      }
    };
    window.addEventListener('pointerdown', onUserActivity);
    window.addEventListener('keydown', onUserActivity);

    return () => {
      unsubState();
      unsubPlay();
      unsubStop();
      clearInterval(tick);
      window.removeEventListener('pointerdown', onUserActivity);
      window.removeEventListener('keydown', onUserActivity);
    };
  }, [playJob, stopActiveAudio]);

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Memuat Bel Sekolah ADB...
      </div>
    );
  }

  const timeZone = state.snapshot?.timeZone || 'Asia/Jakarta';
  const effectiveNow = nowMs + (state.config.useServerTimeOffset ? state.clockOffsetMs : 0);
  const parts = getZonedDateParts(effectiveNow, timeZone);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setUnlocking(true);
    try {
      const res = await window.desktopApi.unlock(pinInput);
      setState(res.state);
      if (!res.ok) {
        setPinError(res.error || 'PIN salah');
      } else {
        setPinInput('');
        setFormConfig(res.state.config);
      }
    } finally {
      setUnlocking(false);
    }
  };

  if (state.locked) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
        {state.shutdownState === 'pending' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-rose-950/90 p-6 backdrop-blur">
            <div className="w-full max-w-md rounded-3xl border border-rose-400/40 bg-slate-900 p-8 text-center shadow-2xl">
              <AlertTriangle className="mx-auto h-14 w-14 animate-pulse text-rose-400" />
              <h2 className="mt-4 text-2xl font-bold text-white">
                PC akan {state.shutdownAction === 'restart' ? 'Restart' : 'Shutdown'}
              </h2>
              <p className="mt-1 text-sm text-slate-300">{state.shutdownReason}</p>
              <div className="my-6 font-mono text-6xl font-black text-rose-400">
                {state.shutdownRemainingSec ?? 0}s
              </div>
              <button
                type="button"
                onClick={() => void window.desktopApi.cancelShutdown()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-base font-bold text-rose-700 hover:bg-slate-100"
              >
                <PowerOff className="h-5 w-5" />
                Batalkan {state.shutdownAction === 'restart' ? 'Restart' : 'Shutdown'}
              </button>
            </div>
          </div>
        )}

        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/40">
              <Lock className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-white">Bel Sekolah ADB Terkunci</h1>
            <p className="mt-1 text-xs text-slate-400">
              SMK Negeri 1 Adiwerna • {state.config.deviceName}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs font-bold text-slate-200">
                {parts.timeStr}:{String(parts.second).padStart(2, '0')}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  state.connectedToServer
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {state.connectedToServer ? (
                  <Wifi className="h-3 w-3" />
                ) : (
                  <WifiOff className="h-3 w-3" />
                )}
                {state.connectedToServer ? 'Terhubung VPS' : 'Mode Offline'}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-emerald-400/90">
              Jadwal bel tetap aktif berjalan di latar belakang selama terkunci.
            </p>
          </div>

          {state.isPlaying && (
            <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-center text-xs text-blue-300">
              Sedang memutar: <strong>{state.currentPlayingLabel || 'Bel Sekolah'}</strong>
            </div>
          )}

          {pinError && (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-center text-xs font-medium text-rose-300">
              {pinError}
            </div>
          )}

          <form onSubmit={handleUnlock} className="mt-5 space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Masukkan PIN / Password Aplikasi
              </label>
              <input
                type="password"
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Masukkan PIN..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-center font-mono text-base tracking-widest text-white focus:border-blue-500 focus:outline-none"
                required
              />
            </div>

            {state.lockPinIsDefault && (
              <p className="text-center text-[11px] text-amber-300">
                PIN bawaan awal: <strong className="font-mono">123456</strong> (segera ubah di
                Pengaturan setelah masuk)
              </p>
            )}

            <button
              type="submit"
              disabled={unlocking}
              className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {unlocking ? 'Memeriksa...' : 'Buka Kunci Aplikasi'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!formConfig) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Menyiapkan pengaturan...
      </div>
    );
  }

  const resolved = state.snapshot
    ? resolveDaySchedule(state.snapshot, parts.dateStr, parts.dayOfWeek)
    : null;
  const nextSlot = resolved ? getNextBellSlot(resolved, parts.timeStr, true) : null;
  const availableSet = new Set(state.audioFiles.map((f) => f.relativePath.toLowerCase()));
  const driftSec = Math.round(state.clockOffsetMs / 1000);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await window.desktopApi.saveConfig(formConfig);
    setFormConfig(updated.config);
    setSavingMsg('Pengaturan disimpan & koneksi diperbarui');
    setTimeout(() => setSavingMsg(null), 3000);
  };

  const playTestFile = (filePath: string) => {
    const steps: AudioStep[] = [
      { id: crypto.randomUUID(), fileName: filePath, delayBeforeMs: 0, volume: 100 }
    ];
    void window.desktopApi.playTestSteps(`Tes Lokal: ${filePath}`, steps);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Shutdown Countdown Modal Overlay */}
      {state.shutdownState === 'pending' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-rose-950/90 p-6 backdrop-blur">
          <div className="w-full max-w-md rounded-3xl border border-rose-400/40 bg-slate-900 p-8 text-center shadow-2xl">
            <AlertTriangle className="mx-auto h-14 w-14 animate-pulse text-rose-400" />
            <h2 className="mt-4 text-2xl font-bold text-white">
              PC akan {state.shutdownAction === 'restart' ? 'Restart' : 'Shutdown'}
            </h2>
            <p className="mt-1 text-sm text-slate-300">{state.shutdownReason}</p>
            <div className="my-6 font-mono text-6xl font-black text-rose-400">
              {state.shutdownRemainingSec ?? 0}s
            </div>
            {state.isPlaying && (
              <p className="mb-4 text-xs text-amber-300">
                Menunggu audio bel yang sedang berbunyi selesai terlebih dahulu...
              </p>
            )}
            <button
              type="button"
              onClick={() => void window.desktopApi.cancelShutdown()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-base font-bold text-rose-700 hover:bg-slate-100"
            >
              <PowerOff className="h-5 w-5" />
              Batalkan {state.shutdownAction === 'restart' ? 'Restart' : 'Shutdown'}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-white">Bel Sekolah ADB</h1>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                v{state.appVersion}
              </span>
            </div>
            <p className="text-xs text-slate-400">SMK Negeri 1 Adiwerna • {state.config.deviceName}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-lg font-bold text-white">
              {parts.timeStr}:{String(parts.second).padStart(2, '0')}
            </div>
            <div className="text-[11px] text-slate-400">
              {DAY_NAMES_ID[parts.dayOfWeek]}, {parts.dateStr}
            </div>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold ${
              state.connectedToServer
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
            }`}
          >
            {state.connectedToServer ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            {state.connectedToServer ? 'Terhubung VPS' : 'Mode Offline'}
          </div>
        </div>
      </header>

      {/* Navigation + Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/60 px-5 py-2.5">
        <div className="flex gap-1.5">
          {[
            { id: 'today' as const, label: 'Jadwal Hari Ini', icon: <Clock className="h-4 w-4" /> },
            {
              id: 'manage' as const,
              label: 'Kelola Jadwal',
              icon: <Layers className="h-4 w-4" />
            },
            {
              id: 'audio' as const,
              label: `Folder MP3 (${state.audioFiles.length})`,
              icon: <FolderOpen className="h-4 w-4" />
            },
            {
              id: 'settings' as const,
              label: 'Pengaturan & Pairing',
              icon: <Settings className="h-4 w-4" />
            }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                tab === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {state.isPlaying && (
            <button
              type="button"
              onClick={() => void window.desktopApi.stopAudio()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop: {state.currentPlayingLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => void window.desktopApi.syncNow()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Sinkronkan
          </button>
          {state.config.lockEnabled && (
            <button
              type="button"
              onClick={() => void window.desktopApi.lockNow()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
              title="Kunci layar aplikasi sekarang"
            >
              <Lock className="h-3.5 w-3.5" />
              Kunci
            </button>
          )}
        </div>
      </div>

      {/* Warning & Conflict Sync Banners */}
      {(state.lockPinIsDefault && state.config.lockEnabled) ||
      state.conflictingServerSnapshot ||
      state.hasLocalUnsyncedChanges ||
      state.lastError ||
      Math.abs(driftSec) > 5 ||
      state.pendingLogCount > 0 ? (
        <div className="space-y-2 border-b border-slate-800 bg-slate-900/40 px-5 py-2.5 text-xs">
          {state.lockPinIsDefault && state.config.lockEnabled && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-amber-200">
              <span>
                Anda masih menggunakan PIN bawaan (<strong className="font-mono">123456</strong>).
                Segera ubah PIN di tab <strong>Pengaturan & Pairing</strong>.
              </span>
              <button
                type="button"
                onClick={() => setTab('settings')}
                className="rounded-lg bg-amber-500 px-2.5 py-1 font-semibold text-slate-950 hover:bg-amber-400"
              >
                Ubah PIN
              </button>
            </div>
          )}
          {state.conflictingServerSnapshot && (
            <div className="flex flex-col gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 p-3 text-rose-200 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong>Konflik Jadwal:</strong> PC ini memiliki perubahan offline (basis v
                {state.localBaseVersion ?? 0}), sementara jadwal di Server VPS juga berubah menjadi v
                {state.conflictingServerSnapshot.version}.
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void window.desktopApi.pushLocalSnapshot(true)}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700"
                >
                  Timpa Server dengan Jadwal PC
                </button>
                <button
                  type="button"
                  onClick={() => void window.desktopApi.acceptServerSnapshot()}
                  className="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100"
                >
                  Gunakan Jadwal Server
                </button>
              </div>
            </div>
          )}

          {!state.conflictingServerSnapshot && state.hasLocalUnsyncedChanges && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-amber-200">
              <span>
                Perubahan jadwal lokal belum terkirim ke VPS (mode offline). Bel di PC ini sudah
                menggunakan jadwal terbaru.
              </span>
              {state.connectedToServer && (
                <button
                  type="button"
                  onClick={() => void window.desktopApi.pushLocalSnapshot(false)}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Kirim ke Server Sekarang
                </button>
              )}
            </div>
          )}

          {state.lastError && <p className="text-amber-300">Info: {state.lastError}</p>}
          {Math.abs(driftSec) > 5 && (
            <p className="text-amber-300">
              Jam PC selisih {Math.abs(driftSec)} detik dari jam server VPS (kompensasi otomatis{' '}
              {state.config.useServerTimeOffset ? 'AKTIF' : 'NONAKTIF'}).
            </p>
          )}
          {state.pendingLogCount > 0 && (
            <p className="text-slate-400">
              {state.pendingLogCount} log aktivitas offline menunggu koneksi server untuk dikirim.
            </p>
          )}
        </div>
      ) : null}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-5">
        {tab === 'today' && (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-400">
                      Profil Aktif Hari Ini (Jadwal v{state.snapshot?.version ?? 0})
                    </p>
                    <h2 className="text-lg font-bold text-white">
                      {resolved
                        ? resolved.profile?.name || 'Libur / Bel Nonaktif'
                        : 'Belum ada cache jadwal (sambungkan ke server VPS)'}
                    </h2>
                    {resolved?.source === 'override' && resolved.override && (
                      <p className="text-xs text-amber-300">
                        Override: {resolved.override.note}
                      </p>
                    )}
                  </div>
                  {nextSlot && (
                    <div className="rounded-xl bg-blue-600/20 px-3.5 py-2 text-right ring-1 ring-blue-500/40">
                      <p className="text-[11px] text-blue-300">Bel Berikutnya</p>
                      <p className="text-sm font-bold text-white">
                        {nextSlot.time} — {nextSlot.label}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  {!resolved || resolved.slots.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
                      Tidak ada slot bel aktif hari ini.
                    </div>
                  ) : (
                    resolved.slots.map((slot) => {
                      const isNext = nextSlot?.id === slot.id;
                      const missing = slot.steps
                        .map((s) => s.fileName)
                        .filter((f) => !availableSet.has(f.toLowerCase()));
                      return (
                        <div
                          key={slot.id}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                            isNext
                              ? 'border-blue-500/60 bg-blue-950/40'
                              : 'border-slate-800 bg-slate-950/60'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                              <span className="rounded-lg bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-white">
                                {slot.time}
                              </span>
                              <span className="truncate text-sm font-semibold text-slate-100">
                                {slot.label}
                              </span>
                              {!slot.enabled && (
                                <span className="text-[11px] text-slate-500">(Nonaktif)</span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-400">
                              {slot.steps.map((s) => s.fileName).join(' → ')}
                            </p>
                            {missing.length > 0 && (
                              <p className="mt-0.5 text-[11px] text-rose-400">
                                File tidak ditemukan di folder audio: {missing.join(', ')}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void window.desktopApi.playTestSteps(`Tes: ${slot.label}`, slot.steps)
                            }
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-700"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Tes
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Volume2 className="h-4 w-4 text-blue-400" />
                Log Lokal Terbaru
              </h3>
              <div className="mt-3 space-y-2">
                {state.recentLogs.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">Belum ada log lokal.</p>
                ) : (
                  state.recentLogs.slice(0, 12).map((log, i) => (
                    <div
                      key={log.id || i}
                      className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">{log.slotLabel}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                          {log.status}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {log.detail || log.files.join(', ') || '-'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'manage' && (
          <ScheduleManager
            snapshot={state.snapshot}
            audioFiles={state.audioFiles}
            clockOffsetMs={state.clockOffsetMs}
            hasLocalUnsyncedChanges={state.hasLocalUnsyncedChanges}
            onInitLocal={async () => {
              const next = await window.desktopApi.initLocalSnapshot();
              setState(next);
            }}
            onSaveSnapshot={async (nextSnap) => {
              const res = await window.desktopApi.saveLocalSnapshot(nextSnap);
              setState(res.state);
              return res;
            }}
          />
        )}

        {tab === 'audio' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">Folder Asset MP3 Lokal</h2>
                <p className="text-xs text-slate-400">{state.config.audioDir}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void window.desktopApi.pickAudioDir()}
                  className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Pilih Folder MP3...
                </button>
                <button
                  type="button"
                  onClick={() => void window.desktopApi.openAudioDir()}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold hover:bg-slate-700"
                >
                  Buka Folder di Explorer
                </button>
                <button
                  type="button"
                  onClick={() => void window.desktopApi.rescanAudio()}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold hover:bg-slate-700"
                >
                  Scan Ulang
                </button>
              </div>
            </div>

            <div className="mt-4 divide-y divide-slate-800">
              {state.audioFiles.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Belum ada file MP3/WAV/OGG/M4A di folder tersebut. Taruh file MP3 lewat Windows
                  Explorer, daftar akan otomatis tersinkron ke Web Admin.
                </div>
              ) : (
                state.audioFiles.map((file) => (
                  <div
                    key={file.relativePath}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">
                        {file.relativePath}
                      </p>
                      <p className="text-xs text-slate-500">
                        {(file.sizeBytes / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => playTestFile(file.relativePath)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold hover:bg-slate-700"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Putar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="mx-auto max-w-2xl space-y-5">
            <form
              onSubmit={handleSaveConfig}
              className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-white">
                    <HardDrive className="h-5 w-5 text-blue-400" />
                    Koneksi VPS & Pengaturan PC Bel
                  </h2>
                  <p className="text-xs text-slate-400">
                    Salin URL Server dan Device Token dari menu Pengaturan di Web Admin.
                  </p>
                </div>
                {savingMsg && (
                  <span className="rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
                    {savingMsg}
                  </span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    URL Server VPS
                  </label>
                  <input
                    type="url"
                    value={formConfig.serverUrl}
                    onChange={(e) =>
                      setFormConfig((prev) => (prev ? { ...prev, serverUrl: e.target.value } : prev))
                    }
                    placeholder="https://bel.smkn1adw.sch.id"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Device Token
                  </label>
                  <input
                    type="text"
                    value={formConfig.deviceToken}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, deviceToken: e.target.value.trim() } : prev
                      )
                    }
                    placeholder="adb-xxxxxxxxxxxx"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Nama Perangkat
                  </label>
                  <input
                    type="text"
                    value={formConfig.deviceName}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, deviceName: e.target.value } : prev
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Volume Master ({formConfig.masterVolume}%)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={formConfig.masterVolume}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, masterVolume: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-2 w-full"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Speaker Output
                  </label>
                  <select
                    value={formConfig.audioOutputDeviceId}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, audioOutputDeviceId: e.target.value } : prev
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Default Sistem Windows</option>
                    {audioDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Audio Output (${d.deviceId.slice(0, 8)})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2.5 border-t border-slate-800 pt-4 text-xs">
                <label className="flex items-center gap-2.5 text-slate-200">
                  <input
                    type="checkbox"
                    checked={formConfig.autoLaunch}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, autoLaunch: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Jalankan otomatis saat Windows menyala (Auto-Start)
                </label>

                <label className="flex items-center gap-2.5 text-slate-200">
                  <input
                    type="checkbox"
                    checked={formConfig.keepAwake}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, keepAwake: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Cegah PC masuk mode Sleep agar bel tidak terlewat
                </label>

                <label className="flex items-center gap-2.5 text-slate-200">
                  <input
                    type="checkbox"
                    checked={formConfig.useServerTimeOffset}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, useServerTimeOffset: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Kompensasi otomatis jika jam Windows selisih dari jam server VPS
                </label>

                <label className="flex items-center gap-2.5 text-amber-300">
                  <input
                    type="checkbox"
                    checked={formConfig.dryRunShutdown}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, dryRunShutdown: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Mode Simulasi Shutdown (Dry-Run — matikan centang ini di PC Windows produksi agar
                  benar-benar mematikan komputer)
                </label>
              </div>

              {/* App Lock configuration */}
              <div className="space-y-3 border-t border-slate-800 pt-4 text-xs">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Keamanan & Kunci Aplikasi Desktop
                </h3>

                <label className="flex items-center gap-2.5 text-slate-200">
                  <input
                    type="checkbox"
                    checked={formConfig.lockEnabled}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, lockEnabled: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Aktifkan Kunci PIN / Password saat aplikasi dibuka
                </label>

                <label className="flex items-center gap-2.5 text-slate-200">
                  <input
                    type="checkbox"
                    checked={formConfig.lockOnHide}
                    disabled={!formConfig.lockEnabled}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, lockOnHide: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded"
                  />
                  Kunci otomatis saat jendela ditutup ke System Tray
                </label>

                <div className="flex items-center gap-2 text-slate-300">
                  <span>Kunci otomatis jika tidak aktif selama:</span>
                  <select
                    value={formConfig.lockTimeoutMinutes}
                    disabled={!formConfig.lockEnabled}
                    onChange={(e) =>
                      setFormConfig((prev) =>
                        prev ? { ...prev, lockTimeoutMinutes: Number(e.target.value) } : prev
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white"
                  >
                    <option value={0}>Tidak otomatis (manual saja)</option>
                    <option value={1}>1 menit</option>
                    <option value={5}>5 menit</option>
                    <option value={15}>15 menit</option>
                    <option value={30}>30 menit</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    void window.desktopApi.triggerShutdownDemo(
                      'shutdown',
                      10,
                      'Uji coba countdown shutdown lokal'
                    )
                  }
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Tes Overlay Countdown Shutdown
                </button>

                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Simpan Pengaturan
                </button>
              </div>
            </form>

            {/* Change Lock PIN Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPinChangeMsg(null);
                const res = await window.desktopApi.changeLockPin(curPin, newPin);
                setState(res.state);
                if (res.ok) {
                  setCurPin('');
                  setNewPin('');
                  setPinChangeMsg({ text: 'PIN / password kunci berhasil diperbarui.', ok: true });
                } else {
                  setPinChangeMsg({ text: res.error || 'Gagal memperbarui PIN.', ok: false });
                }
              }}
              className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-6"
            >
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <KeyRound className="h-4 w-4 text-amber-400" />
                Ubah PIN / Password Kunci Aplikasi
              </h3>

              {pinChangeMsg && (
                <div
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    pinChangeMsg.ok
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {pinChangeMsg.text}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    PIN / Password Saat Ini
                  </label>
                  <input
                    type="password"
                    value={curPin}
                    onChange={(e) => setCurPin(e.target.value)}
                    placeholder={state.lockPinIsDefault ? '123456' : 'PIN saat ini'}
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    PIN / Password Baru (min. 4 karakter)
                  </label>
                  <input
                    type="password"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    minLength={4}
                    placeholder="PIN baru..."
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Perbarui PIN Kunci
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
