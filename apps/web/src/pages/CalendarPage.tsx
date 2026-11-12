import { useState } from 'react';
import { CalendarDays, Plus, Save, Trash2 } from 'lucide-react';
import { DAY_NAMES_ID, type ScheduleSnapshot } from '@jadwal-adb/shared';

interface CalendarPageProps {
  snapshot: ScheduleSnapshot;
  onUpdateWeeklyRules: (rules: Array<{ dayOfWeek: number; profileId: string | null }>) => Promise<void>;
  onCreateOverride: (payload: {
    startDate: string;
    endDate: string;
    profileId: string | null;
    note: string;
  }) => Promise<void>;
  onDeleteOverride: (id: string) => Promise<void>;
}

const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 0];

export function CalendarPage({
  snapshot,
  onUpdateWeeklyRules,
  onCreateOverride,
  onDeleteOverride
}: CalendarPageProps) {
  const [weeklyMap, setWeeklyMap] = useState<Record<number, string | null>>(() => {
    const map: Record<number, string | null> = {};
    for (const r of snapshot.weeklyRules) {
      map[r.dayOfWeek] = r.profileId;
    }
    return map;
  });
  const [savingWeekly, setSavingWeekly] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [overrideProfileId, setOverrideProfileId] = useState<string>('');
  const [note, setNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const handleSaveWeekly = async () => {
    setSavingWeekly(true);
    try {
      await onUpdateWeeklyRules(
        [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          profileId: weeklyMap[dayOfWeek] ?? null
        }))
      );
    } finally {
      setSavingWeekly(false);
    }
  };

  const handleAddOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSavingOverride(true);
    try {
      await onCreateOverride({
        startDate,
        endDate: endDate < startDate ? startDate : endDate,
        profileId: overrideProfileId || null,
        note: note.trim()
      });
      setNote('');
    } finally {
      setSavingOverride(false);
    }
  };

  const profileById = new Map(snapshot.profiles.map((p) => [p.id, p]));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Weekly Mapping */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h2 className="text-lg font-bold text-slate-900">Aturan Mingguan</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Tentukan profil jadwal default untuk setiap hari (misal Senin = Upacara, Selasa–Kamis =
          Reguler, Jumat = Jumat).
        </p>

        <div className="mt-4 space-y-2.5">
          {ORDERED_DAYS.map((dayIdx) => (
            <div
              key={dayIdx}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5"
            >
              <span className="w-24 text-sm font-semibold text-slate-800">
                {DAY_NAMES_ID[dayIdx]}
              </span>
              <select
                value={weeklyMap[dayIdx] ?? ''}
                onChange={(e) =>
                  setWeeklyMap((prev) => ({
                    ...prev,
                    [dayIdx]: e.target.value || null
                  }))
                }
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Libur / Bel Nonaktif</option>
                {snapshot.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSaveWeekly}
          disabled={savingWeekly}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {savingWeekly ? 'Menyimpan...' : 'Simpan Aturan Mingguan'}
        </button>
      </div>

      {/* Date Overrides */}
      <div className="space-y-5">
        <form
          onSubmit={handleAddOverride}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
        >
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <CalendarDays className="h-5 w-5 text-amber-600" />
            Kalender Pengecualian (Ujian / Libur)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Menimpa aturan mingguan pada tanggal atau rentang tanggal tertentu.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Tanggal Mulai</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Tanggal Selesai
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Profil Dipakai
              </label>
              <select
                value={overrideProfileId}
                onChange={(e) => setOverrideProfileId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Libur / Matikan Bel</option>
                {snapshot.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Keterangan Agenda
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: PAS Semester Ganjil / Libur Hari Besar"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingOverride}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {savingOverride ? 'Menyimpan...' : 'Tambahkan Pengecualian'}
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="font-semibold text-slate-900">
            Daftar Pengecualian ({snapshot.dateOverrides.length})
          </h3>
          <div className="mt-3 space-y-2">
            {snapshot.dateOverrides.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                Belum ada jadwal pengecualian.
              </p>
            ) : (
              snapshot.dateOverrides.map((ov) => {
                const prof = ov.profileId ? profileById.get(ov.profileId) : null;
                return (
                  <div
                    key={ov.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-800">
                          {ov.startDate === ov.endDate
                            ? ov.startDate
                            : `${ov.startDate} s.d. ${ov.endDate}`}
                        </span>
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                          {prof ? prof.name : 'Libur / Nonaktif'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {ov.note} • oleh {ov.createdBy}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteOverride(ov.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Hapus"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
