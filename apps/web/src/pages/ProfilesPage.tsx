import { useState } from 'react';
import { Clock, Copy, Edit3, Plus, Trash2 } from 'lucide-react';
import type { AudioFileEntry, ScheduleProfile, ScheduleSlot } from '@jadwal-adb/shared';
import { ProfileEditorModal } from '../components/ProfileEditorModal.js';

interface ProfilesPageProps {
  profiles: ScheduleProfile[];
  audioFiles: AudioFileEntry[];
  onCreateProfile: (payload: {
    name: string;
    description: string;
    color: string;
    slots: ScheduleSlot[];
  }) => Promise<void>;
  onUpdateProfile: (
    id: string,
    payload: { name: string; description: string; color: string; slots: ScheduleSlot[] }
  ) => Promise<void>;
  onDuplicateProfile: (id: string) => Promise<void>;
  onShiftProfile: (id: string, deltaMinutes: number) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
}

export function ProfilesPage({
  profiles,
  audioFiles,
  onCreateProfile,
  onUpdateProfile,
  onDuplicateProfile,
  onShiftProfile,
  onDeleteProfile
}: ProfilesPageProps) {
  const [editing, setEditing] = useState<{ open: boolean; profile: ScheduleProfile | null }>({
    open: false,
    profile: null
  });
  const [shiftModal, setShiftModal] = useState<ScheduleProfile | null>(null);
  const [deltaMinutes, setDeltaMinutes] = useState(15);

  const handleShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftModal) return;
    await onShiftProfile(shiftModal.id, deltaMinutes);
    setShiftModal(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Master Profil Jadwal</h2>
          <p className="text-xs text-slate-500">
            Buat template jadwal (Senin Upacara, Reguler, Jumat, Ujian, Ramadhan). Bisa duplikat,
            generate massal, dan geser semua jam sekaligus.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ open: true, profile: null })}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Buat Profil Baru
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: profile.color }}
                  />
                  <div>
                    <h3 className="font-bold text-slate-900">{profile.name}</h3>
                    <p className="text-xs text-slate-500">{profile.description || 'Tanpa keterangan'}</p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  {profile.slots.length} slot
                </span>
              </div>

              <div className="mt-4 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {profile.slots.length === 0 ? (
                  <p className="text-xs text-slate-400">Belum ada slot jam.</p>
                ) : (
                  profile.slots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono font-bold text-slate-800">{slot.time}</span>
                        <span className="truncate text-slate-700">{slot.label}</span>
                      </div>
                      <span className="ml-2 shrink-0 text-[11px] text-slate-400">
                        {slot.steps.map((s) => s.fileName).join(' + ')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setEditing({ open: true, profile })}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit & Generator
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeltaMinutes(15);
                  setShiftModal(profile);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Clock className="h-3.5 w-3.5" />
                Geser Jam
              </button>
              <button
                type="button"
                onClick={() => onDuplicateProfile(profile.id)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Duplikat
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Hapus profil "${profile.name}"?`)) {
                    void onDeleteProfile(profile.id);
                  }
                }}
                className="ml-auto inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing.open && (
        <ProfileEditorModal
          profile={editing.profile}
          audioFiles={audioFiles}
          onClose={() => setEditing({ open: false, profile: null })}
          onSave={async (payload) => {
            if (editing.profile) {
              await onUpdateProfile(editing.profile.id, payload);
            } else {
              await onCreateProfile(payload);
            }
          }}
        />
      )}

      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleShiftSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="font-bold text-slate-900">Geser Semua Jam: {shiftModal.name}</h4>
            <p className="mt-1 text-xs text-slate-500">
              Masukkan selisih menit (+ untuk memundurkan, - untuk memajukan semua jam di profil ini).
            </p>
            <input
              type="number"
              min={-360}
              max={360}
              value={deltaMinutes}
              onChange={(e) => setDeltaMinutes(Number(e.target.value || 0))}
              className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShiftModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Terapkan Pergeseran
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
