import { useMemo, useState } from 'react';
import { AlertTriangle, FileAudio, Play, Search } from 'lucide-react';
import {
  createId,
  type AudioFileEntry,
  type AudioStep,
  type DeviceStatus,
  type ScheduleSnapshot
} from '@jadwal-adb/shared';

interface AudioFilesPageProps {
  status: DeviceStatus;
  audioFiles: AudioFileEntry[];
  snapshot: ScheduleSnapshot;
  onPlayManual: (label: string, steps: AudioStep[]) => Promise<void>;
}

export function AudioFilesPage({
  status,
  audioFiles,
  snapshot,
  onPlayManual
}: AudioFilesPageProps) {
  const [query, setQuery] = useState('');

  const availableSet = useMemo(
    () => new Set(audioFiles.map((f) => f.relativePath.toLowerCase())),
    [audioFiles]
  );

  const missingReferences = useMemo(() => {
    if (audioFiles.length === 0) return [];
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
  }, [audioFiles.length, availableSet, snapshot.profiles]);

  const filtered = audioFiles.filter((f) =>
    f.relativePath.toLowerCase().includes(query.trim().toLowerCase())
  );

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

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <FileAudio className="h-5 w-5 text-blue-600" />
              Daftar MP3 dari Windows Explorer ({audioFiles.length})
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
