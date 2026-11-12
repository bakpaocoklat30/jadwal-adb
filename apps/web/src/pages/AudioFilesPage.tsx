import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CloudUpload,
  FileAudio,
  Headphones,
  Play,
  Search,
  Trash2
} from 'lucide-react';
import {
  createId,
  type AudioFileEntry,
  type AudioStep,
  type DeviceStatus,
  type ScheduleSnapshot,
  type ServerAudioFile,
  type UserRole
} from '@jadwal-adb/shared';
import { api } from '../api.js';
import { UploadAudioCard } from '../components/UploadAudioCard.js';

interface AudioFilesPageProps {
  userRole: UserRole;
  status: DeviceStatus;
  audioFiles: AudioFileEntry[];
  serverAudioFiles: ServerAudioFile[];
  snapshot: ScheduleSnapshot;
  onUploadAudio: (file: File) => Promise<ServerAudioFile>;
  onDeleteServerAudio: (fileName: string) => Promise<void>;
  onPlayManual: (label: string, steps: AudioStep[]) => Promise<void>;
}

export function AudioFilesPage({
  userRole,
  status,
  audioFiles,
  serverAudioFiles,
  snapshot,
  onUploadAudio,
  onDeleteServerAudio,
  onPlayManual
}: AudioFilesPageProps) {
  const [query, setQuery] = useState('');
  const [previewAudio, setPreviewAudio] = useState<{
    fileName: string;
    objectUrl: string;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewAudio) {
        URL.revokeObjectURL(previewAudio.objectUrl);
      }
    };
  }, [previewAudio]);

  const availableSet = useMemo(
    () =>
      new Set([
        ...audioFiles.map((f) => f.relativePath.toLowerCase()),
        ...serverAudioFiles.map((f) => f.relativePath.toLowerCase())
      ]),
    [audioFiles, serverAudioFiles]
  );

  const missingReferences = useMemo(() => {
    if (audioFiles.length === 0 && serverAudioFiles.length === 0) return [];
    const missing: Array<{ profileName: string; slotTime: string; fileName: string }> = [];
    for (const profile of snapshot.profiles) {
      for (const slot of profile.slots) {
        for (const step of slot.steps) {
          if (!availableSet.has(step.fileName.toLowerCase())) {
            missing.push({
              profileName: profile.name,
              slotTime: slot.time,
              fileName: step.fileName
            });
          }
        }
      }
    }
    return missing;
  }, [audioFiles.length, availableSet, serverAudioFiles.length, snapshot.profiles]);

  const filtered = audioFiles.filter((f) =>
    f.relativePath.toLowerCase().includes(query.trim().toLowerCase())
  );

  const canDeleteServerAudio = userRole === 'admin' || userRole === 'waka';

  const handlePreview = async (fileName: string) => {
    setLoadingPreview(fileName);
    try {
      const url = await api.fetchServerAudioBlobUrl(fileName);
      setPreviewAudio((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return { fileName, objectUrl: url };
      });
    } finally {
      setLoadingPreview(null);
    }
  };

  return (
    <div className="space-y-5">
      {missingReferences.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <span>
              Ada {missingReferences.length} referensi file audio di jadwal yang belum ditemukan di
              folder PC Windows
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs text-amber-800">
            {missingReferences.slice(0, 12).map((item, idx) => (
              <li key={idx}>
                <strong>{item.fileName}</strong> (dipakai di {item.profileName} pukul {item.slotTime})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload & Server Audio Section */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div>
          <UploadAudioCard
            status={status}
            onUploadAudio={onUploadAudio}
            onPlayManual={onPlayManual}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <CloudUpload className="h-5 w-5 text-indigo-600" />
                Audio Diupload Lewat Web ({serverAudioFiles.length})
              </h2>
              <p className="text-xs text-slate-500">
                Otomatis tersinkron ke folder <code className="rounded bg-slate-100 px-1">_web/</code> di
                PC Bel Windows agar tetap bisa dipakai walau offline.
              </p>
            </div>
          </div>

          {previewAudio && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-semibold text-indigo-950">
                Pratinjau Browser: {previewAudio.fileName}
              </span>
              <audio controls autoPlay src={previewAudio.objectUrl} className="h-8 max-w-full" />
            </div>
          )}

          <div className="mt-4 divide-y divide-slate-100">
            {serverAudioFiles.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Belum ada file MP3 yang diupload dari web.
              </p>
            ) : (
              serverAudioFiles.map((file) => (
                <div
                  key={file.fileName}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{file.fileName}</p>
                    <p className="text-xs text-slate-400">
                      {(file.sizeBytes / 1024).toFixed(0)} KB • diupload oleh {file.uploadedBy} •{' '}
                      <span className="font-mono">{file.relativePath}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={loadingPreview === file.fileName}
                      onClick={() => void handlePreview(file.fileName)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Headphones className="h-3.5 w-3.5" />
                      {loadingPreview === file.fileName ? 'Memuat...' : 'Dengar di HP/PC'}
                    </button>
                    <button
                      type="button"
                      disabled={!status.online}
                      onClick={() =>
                        onPlayManual(`Putar Audio Web: ${file.fileName}`, [
                          {
                            id: createId(),
                            fileName: file.relativePath,
                            delayBeforeMs: 0,
                            volume: 100
                          }
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Putar di PC Bel
                    </button>
                    {canDeleteServerAudio && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Hapus file "${file.fileName}" dari server?`)) {
                            void onDeleteServerAudio(file.fileName);
                          }
                        }}
                        className="rounded-xl p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Hapus dari server"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Local PC Bel Audio Files */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <FileAudio className="h-5 w-5 text-blue-600" />
              Daftar MP3 di PC Bel Windows ({audioFiles.length})
            </h2>
            <p className="text-xs text-slate-500">
              Folder lokal PC Bel: <strong>{status.audioDir || 'Belum dipilih di Desktop App'}</strong>
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama file MP3..."
              className="w-full rounded-xl border border-slate-200 py-2 pr-3 pl-9 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {audioFiles.length === 0
                ? 'Belum ada daftar MP3 yang tersinkron dari aplikasi Windows.'
                : 'Tidak ada file MP3 yang cocok dengan pencarian.'}
            </p>
          ) : (
            filtered.map((file) => (
              <div
                key={file.relativePath}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{file.relativePath}</p>
                  <p className="text-xs text-slate-400">
                    {(file.sizeBytes / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!status.online}
                  onClick={() =>
                    onPlayManual(`Tes Audio: ${file.fileName}`, [
                      {
                        id: createId(),
                        fileName: file.relativePath,
                        delayBeforeMs: 0,
                        volume: 100
                      }
                    ])
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Tes Putar
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
