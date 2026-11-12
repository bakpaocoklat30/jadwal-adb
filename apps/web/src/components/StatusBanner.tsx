import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  PowerOff,
  RefreshCw,
  Square,
  Volume2,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { DeviceStatus, ScheduleSnapshot } from '@jadwal-adb/shared';

interface StatusBannerProps {
  status: DeviceStatus;
  snapshot: ScheduleSnapshot;
  onStopAudio: () => void;
  onCancelShutdown: () => void;
  onSyncNow: () => void;
  busy?: boolean;
}

export function StatusBanner({
  status,
  snapshot,
  onStopAudio,
  onCancelShutdown,
  onSyncNow,
  busy
}: StatusBannerProps) {
  const driftSec = Math.round(status.clockDriftMs / 1000);
  const hasClockDrift = status.online && Math.abs(driftSec) > 5;
  const versionOutdated =
    status.online && status.activeScheduleVersion !== snapshot.version;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                status.online
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-rose-50 text-rose-600'
              }`}
            >
              {status.online ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{status.deviceName}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    status.online
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status.online ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                    }`}
                  />
                  {status.online ? 'Online' : 'Offline'}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  Jadwal v{status.activeScheduleVersion || 0} / Server v{snapshot.version}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>Audio lokal: {status.audioCount} file</span>
                {status.audioDir && <span className="truncate max-w-xs">Folder: {status.audioDir}</span>}
                {status.lastHeartbeatAt && (
                  <span>
                    Aktif terakhir:{' '}
                    {new Date(status.lastHeartbeatAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status.online && (
              <>
                <button
                  type="button"
                  onClick={onSyncNow}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Sinkronkan
                </button>
                <button
                  type="button"
                  onClick={onStopAudio}
                  disabled={busy}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                    status.isPlaying
                      ? 'bg-rose-600 text-white shadow-xs hover:bg-rose-700'
                      : 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {status.isPlaying ? 'OFF / Stop Audio' : 'OFF Audio'}
                </button>
              </>
            )}
          </div>
        </div>

        {status.isPlaying && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 animate-bounce text-blue-600" />
              <span>
                Sedang memutar: <strong>{status.currentPlayingLabel || 'Bel Sekolah'}</strong>
              </span>
            </div>
          </div>
        )}

        {hasClockDrift && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Jam PC Windows selisih {Math.abs(driftSec)} detik dibanding jam server. Aplikasi desktop
              otomatis mengompensasi selisih waktu ini, namun sebaiknya periksa jam BIOS/Windows PC.
            </span>
          </div>
        )}

        {versionOutdated && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
            <BellRing className="h-4 w-4 shrink-0" />
            <span>PC Bel sedang menyelaraskan jadwal terbaru (v{snapshot.version})...</span>
          </div>
        )}

        {!status.online && status.lastShutdownAt && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-xs text-slate-700">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-500" />
            <span>
              Terakhir dimatikan secara terencana:{' '}
              {new Date(status.lastShutdownAt).toLocaleString('id-ID')} ({status.lastShutdownReason || '-'})
            </span>
          </div>
        )}
      </div>

      {status.shutdownState === 'pending' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="font-semibold">
                PC Bel akan {status.shutdownAction === 'restart' ? 'Restart' : 'Shutdown'} dalam{' '}
                {status.shutdownRemainingSec ?? '...'} detik
              </p>
              <p className="text-xs text-rose-700">Alasan: {status.shutdownReason || '-'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelShutdown}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-100"
          >
            <PowerOff className="h-4 w-4" />
            Batalkan Shutdown
          </button>
        </div>
      )}
    </div>
  );
}
