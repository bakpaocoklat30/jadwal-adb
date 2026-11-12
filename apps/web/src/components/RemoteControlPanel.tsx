import { useState } from 'react';
import { Play, Plus, Power, RotateCcw, Square, Trash2, Volume2 } from 'lucide-react';
import {
  createId,
  type AudioFileEntry,
  type AudioStep,
  type DeviceStatus,
  type ServerAudioFile,
  type ShutdownAction
} from '@jadwal-adb/shared';
import { UploadAudioCard } from './UploadAudioCard.js';

interface RemoteControlPanelProps {
  status: DeviceStatus;
  audioFiles: AudioFileEntry[];
  serverAudioFiles: ServerAudioFile[];
  onUploadAudio: (file: File) => Promise<ServerAudioFile>;
  onPlayManual: (label: string, steps: AudioStep[]) => Promise<void>;
  onStopAudio: () => Promise<void>;
  onShutdownPc: (action: ShutdownAction, graceSeconds: number, reason: string) => Promise<void>;
}

export function RemoteControlPanel({
  status,
  audioFiles,
  serverAudioFiles,
  onUploadAudio,
  onPlayManual,
  onStopAudio,
  onShutdownPc
}: RemoteControlPanelProps) {
  const [label, setLabel] = useState('Bel Manual / Pengumuman');
  const [steps, setSteps] = useState<AudioStep[]>([
    {
      id: createId(),
      fileName: audioFiles[0]?.relativePath || '',
      delayBeforeMs: 0,
      volume: 100
    }
  ]);
  const [powerModal, setPowerModal] = useState<{ action: ShutdownAction } | null>(null);
  const [graceSeconds, setGraceSeconds] = useState(20);
  const [reason, setReason] = useState('Dimatikan dari jarak jauh lewat Web Admin');
  const [submitting, setSubmitting] = useState(false);

  const selectedFirst = steps[0]?.fileName || audioFiles[0]?.relativePath || '';

  const handleAddStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        id: createId(),
        fileName: audioFiles[0]?.relativePath || '',
        delayBeforeMs: 1500,
        volume: 100
      }
    ]);
  };

  const handlePlay = async () => {
    const cleanSteps = steps
      .map((st, idx) => ({
        ...st,
        fileName: idx === 0 && !st.fileName ? selectedFirst : st.fileName.trim()
      }))
      .filter((st) => st.fileName.length > 0);

    if (cleanSteps.length === 0) return;
    setSubmitting(true);
    try {
      await onPlayManual(label.trim() || 'Bel Manual', cleanSteps);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePowerConfirm = async () => {
    if (!powerModal) return;
    setSubmitting(true);
    try {
      await onShutdownPc(powerModal.action, graceSeconds, reason.trim() || 'Perintah jarak jauh');
      setPowerModal(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-slate-900">
              <Volume2 className="h-5 w-5 text-blue-600" />
              Bunyikan Bel Manual
            </h3>
            <p className="text-xs text-slate-500">
              Putar 1 MP3 atau rangkaian pengumuman + bel langsung di PC sekolah.
            </p>
          </div>
          {status.isPlaying && (
            <button
              type="button"
              onClick={onStopAudio}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Keterangan Log</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Contoh: Panggilan Kumpul Lapangan"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">Urutan Audio MP3</label>
              <button
                type="button"
                onClick={handleAddStep}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Audio
              </button>
            </div>

            {steps.map((step, index) => (
              <div
                key={step.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5 sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <input
                    list="remote-audio-files"
                    value={index === 0 && !step.fileName ? selectedFirst : step.fileName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSteps((prev) =>
                        prev.map((s) => (s.id === step.id ? { ...s, fileName: val } : s))
                      );
                    }}
                    placeholder="Pilih atau ketik nama file MP3..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {index > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">Jeda</span>
                    <input
                      type="number"
                      min={0}
                      max={60000}
                      step={500}
                      value={step.delayBeforeMs}
                      onChange={(e) => {
                        const ms = Number(e.target.value || 0);
                        setSteps((prev) =>
                          prev.map((s) => (s.id === step.id ? { ...s, delayBeforeMs: ms } : s))
                        );
                      }}
                      className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                    />
                    <span className="text-xs text-slate-500">ms</span>
                  </div>
                )}
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSteps((prev) => prev.filter((s) => s.id !== step.id))}
                    className="self-end rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:self-auto"
                    title="Hapus langkah"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}

            <datalist id="remote-audio-files">
              {Array.from(
                new Set([
                  ...audioFiles.map((f) => f.relativePath),
                  ...serverAudioFiles.map((f) => f.relativePath)
                ])
              ).map((relPath) => (
                <option key={relPath} value={relPath} />
              ))}
            </datalist>
          </div>

          <button
            type="button"
            onClick={handlePlay}
            disabled={!status.online || submitting || (!selectedFirst && steps.every((s) => !s.fileName))}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Play className="h-4 w-4 fill-current" />
            {status.online ? 'Bunyikan Sekarang di PC Bel' : 'PC Bel Sedang Offline'}
          </button>
        </div>
      </div>

      <UploadAudioCard
        status={status}
        onUploadAudio={onUploadAudio}
        onPlayManual={onPlayManual}
      />

      {/* Remote Power Control */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <Power className="h-5 w-5 text-rose-600" />
          Kontrol Daya PC Bel
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Matikan atau restart komputer bel dari jarak jauh. Muncul hitung mundur pengaman di layar PC
          Windows agar petugas di lokasi bisa membatalkan jika komputer masih dipakai.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setReason('Dimatikan jarak jauh setelah kegiatan sekolah selesai');
              setPowerModal({ action: 'shutdown' });
            }}
            disabled={!status.online || status.shutdownState !== 'idle'}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Power className="h-4 w-4" />
            Matikan PC
          </button>
          <button
            type="button"
            onClick={() => {
              setReason('Restart PC Bel dari jarak jauh');
              setPowerModal({ action: 'restart' });
            }}
            disabled={!status.online || status.shutdownState !== 'idle'}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Restart PC
          </button>
        </div>
      </div>

      {powerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="text-lg font-bold text-slate-900">
              Konfirmasi {powerModal.action === 'shutdown' ? 'Matikan PC Bel' : 'Restart PC Bel'}
            </h4>
            <p className="mt-1 text-sm text-slate-600">
              Perintah akan dikirim ke komputer bel Windows. Hitung mundur tampil di layar PC sebelum
              eksekusi.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Jeda Hitung Mundur Pengaman (detik)
                </label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={graceSeconds}
                  onChange={(e) => setGraceSeconds(Number(e.target.value || 20))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Alasan</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPowerModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handlePowerConfirm}
                disabled={submitting}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                  powerModal.action === 'shutdown'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {submitting
                  ? 'Mengirim...'
                  : powerModal.action === 'shutdown'
                    ? 'Ya, Matikan PC'
                    : 'Ya, Restart PC'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
