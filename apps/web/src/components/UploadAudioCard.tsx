import { useRef, useState } from 'react';
import { Play, Upload } from 'lucide-react';
import {
  createId,
  type AudioStep,
  type DeviceStatus,
  type ServerAudioFile
} from '@jadwal-adb/shared';

interface UploadAudioCardProps {
  status: DeviceStatus;
  onUploadAudio: (file: File) => Promise<ServerAudioFile>;
  onPlayManual: (label: string, steps: AudioStep[]) => Promise<void>;
}

export function UploadAudioCard({
  status,
  onUploadAudio,
  onPlayManual
}: UploadAudioCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const handleUpload = async (playAfterUpload: boolean) => {
    if (!selectedFile) return;
    setBusy(true);
    try {
      const uploaded = await onUploadAudio(selectedFile);
      if (playAfterUpload && status.online) {
        const label =
          customLabel.trim() || `Putar Audio Web: ${uploaded.fileName}`;
        await onPlayManual(label, [
          {
            id: createId(),
            fileName: uploaded.relativePath,
            delayBeforeMs: 0,
            volume: 100
          }
        ]);
      }
      setSelectedFile(null);
      setCustomLabel('');
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900">
        <Upload className="h-5 w-5 text-indigo-600" />
        Upload & Putar MP3 dari Web
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Kirim file MP3/WAV/M4A dari HP atau laptop ke server, lalu langsung bunyikan di PC Bel
        (tersimpan juga di folder <code className="rounded bg-slate-100 px-1">_web/</code>).
      </p>

      <div className="mt-3 space-y-2.5">
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.wav,.ogg,.m4a,.aac,audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setSelectedFile(file);
            if (file && !customLabel) {
              setCustomLabel(file.name.replace(/\.[^.]+$/, ''));
            }
          }}
          className="block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-700"
        />

        {selectedFile && (
          <input
            type="text"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Keterangan di riwayat log..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
          />
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={!selectedFile || !status.online || busy}
            onClick={() => void handleUpload(true)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {busy ? 'Mengupload...' : 'Upload & Putar di PC Bel'}
          </button>

          <button
            type="button"
            disabled={!selectedFile || busy}
            onClick={() => void handleUpload(false)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Simpan Saja
          </button>
        </div>
      </div>
    </div>
  );
}
