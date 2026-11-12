import { useEffect, useState } from 'react';
import {
  BellOff,
  CalendarDays,
  Clock,
  Copy,
  Layers,
  Plus,
  Power,
  RotateCcw,
  Save,
  Trash2,
  Wand2
} from 'lucide-react';
import {
  createId,
  DAY_NAMES_ID,
  generateScheduleSlots,
  getZonedDateParts,
  normalizeShutdownSettings,
  shiftTimeHHMM,
  sortSlots,
  type AudioFileEntry,
  type GenerateScheduleBreak,
  type ScheduleProfile,
  type ScheduleSlot,
  type ScheduleSnapshot
} from '@jadwal-adb/shared';
import type { SnapshotSaveResult } from '../../electron/preload.js';

interface ScheduleManagerProps {
  snapshot: ScheduleSnapshot | null;
  audioFiles: AudioFileEntry[];
  clockOffsetMs: number;
  hasLocalUnsyncedChanges: boolean;
  onInitLocal: () => Promise<void>;
  onSaveSnapshot: (next: ScheduleSnapshot) => Promise<SnapshotSaveResult>;
}

type ManagerSubTab = 'profiles' | 'calendar' | 'shutdown';

const COLOR_OPTIONS = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#dc2626', '#0d9488'];
const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 0];

function cloneSnapshot(snap: ScheduleSnapshot): ScheduleSnapshot {
  return JSON.parse(JSON.stringify(snap)) as ScheduleSnapshot;
}

export function ScheduleManager({
  snapshot,
  audioFiles,
  clockOffsetMs,
  hasLocalUnsyncedChanges,
  onInitLocal,
  onSaveSnapshot
}: ScheduleManagerProps) {
  const [subTab, setSubTab] = useState<ManagerSubTab>('profiles');
  const [draft, setDraft] = useState<ScheduleSnapshot | null>(() =>
    snapshot ? cloneSnapshot(snapshot) : null
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    snapshot?.profiles[0]?.id ?? ''
  );
  const [hasEdits, setHasEdits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  // Generator state
  const [showGen, setShowGen] = useState(false);
  const [genStartTime, setGenStartTime] = useState('07:00');
  const [genCount, setGenCount] = useState(8);
  const [genDuration, setGenDuration] = useState(40);
  const [genPattern, setGenPattern] = useState('jam_{n}.mp3');
  const [genIntro, setGenIntro] = useState('');
  const [genIntroDelay, setGenIntroDelay] = useState(1500);
  const [genEndLabel, setGenEndLabel] = useState('Bel Pulang');
  const [genEndFile, setGenEndFile] = useState('pulang.mp3');
  const [genBreaks, setGenBreaks] = useState<GenerateScheduleBreak[]>([
    { afterLesson: 4, durationMinutes: 15, label: 'Istirahat 1', fileName: 'istirahat_1.mp3' }
  ]);

  // Shift state
  const [shiftDelta, setShiftDelta] = useState(15);

  // Override form state
  const todayStr = getZonedDateParts(
    Date.now() + clockOffsetMs,
    snapshot?.timeZone || 'Asia/Jakarta'
  ).dateStr;
  const [ovStart, setOvStart] = useState(todayStr);
  const [ovEnd, setOvEnd] = useState(todayStr);
  const [ovProfileId, setOvProfileId] = useState('');
  const [ovNote, setOvNote] = useState('');

  useEffect(() => {
    if (!hasEdits && snapshot) {
      setDraft(cloneSnapshot(snapshot));
      if (
        !snapshot.profiles.some((p) => p.id === selectedProfileId) &&
        snapshot.profiles.length > 0
      ) {
        setSelectedProfileId(snapshot.profiles[0]!.id);
      }
    }
  }, [snapshot, hasEdits, selectedProfileId]);

  if (!draft) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <Layers className="mx-auto h-10 w-10 text-blue-400" />
        <h2 className="mt-3 text-lg font-bold text-white">Belum Ada Jadwal Lokal</h2>
        <p className="mt-1 text-xs text-slate-400">
          Jika server VPS belum terhubung, Anda bisa langsung membuat template jadwal lokal di PC
          ini dan mensinkronkannya nanti saat terhubung.
        </p>
        <button
          type="button"
          onClick={() => void onInitLocal()}
          className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Buat Template Jadwal Lokal
        </button>
      </div>
    );
  }

  const updateDraft = (updater: (prev: ScheduleSnapshot) => ScheduleSnapshot) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
    setHasEdits(true);
  };

  const activeProfile =
    draft.profiles.find((p) => p.id === selectedProfileId) ?? draft.profiles[0] ?? null;

  const updateActiveProfile = (updater: (p: ScheduleProfile) => ScheduleProfile) => {
    if (!activeProfile) return;
    updateDraft((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === activeProfile.id ? updater(p) : p))
    }));
  };

  const handleSaveAll = async () => {
    if (!draft) return;
    setSaving(true);
    setFeedback(null);
    try {
      const normalized: ScheduleSnapshot = {
        ...draft,
        profiles: draft.profiles.map((p) => ({
          ...p,
          slots: sortSlots(p.slots)
        }))
      };
      const res = await onSaveSnapshot(normalized);
      setHasEdits(false);
      setFeedback({ text: res.message, ok: !res.conflict });
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'Gagal menyimpan jadwal',
        ok: false
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDraft = () => {
    if (!snapshot) return;
    setDraft(cloneSnapshot(snapshot));
    setHasEdits(false);
    setFeedback(null);
  };

  const handleCreateProfile = () => {
    const now = new Date().toISOString();
    const id = createId();
    const newProf: ScheduleProfile = {
      id,
      name: `Profil Baru (${draft.profiles.length + 1})`,
      description: '',
      color: COLOR_OPTIONS[draft.profiles.length % COLOR_OPTIONS.length]!,
      slots: [],
      createdAt: now,
      updatedAt: now
    };
    updateDraft((prev) => ({
      ...prev,
      profiles: [...prev.profiles, newProf]
    }));
    setSelectedProfileId(id);
  };

  const handleDuplicateProfile = () => {
    if (!activeProfile) return;
    const now = new Date().toISOString();
    const id = createId();
    const copy: ScheduleProfile = {
      ...activeProfile,
      id,
      name: `${activeProfile.name} (Salinan)`,
      slots: activeProfile.slots.map((s) => ({
        ...s,
        id: createId(),
        steps: s.steps.map((st) => ({ ...st, id: createId() }))
      })),
      createdAt: now,
      updatedAt: now
    };
    updateDraft((prev) => ({
      ...prev,
      profiles: [...prev.profiles, copy]
    }));
    setSelectedProfileId(id);
  };

  const handleDeleteProfile = () => {
    if (!activeProfile) return;
    if (!confirm(`Hapus profil "${activeProfile.name}"?`)) return;
    const deletedId = activeProfile.id;
    const remaining = draft.profiles.filter((p) => p.id !== deletedId);
    updateDraft((prev) => ({
      ...prev,
      profiles: remaining,
      weeklyRules: prev.weeklyRules.map((r) =>
        r.profileId === deletedId ? { ...r, profileId: null } : r
      ),
      dateOverrides: prev.dateOverrides.map((ov) =>
        ov.profileId === deletedId ? { ...ov, profileId: null } : ov
      )
    }));
    setSelectedProfileId(remaining[0]?.id ?? '');
  };

  const handleApplyGenerator = () => {
    if (!activeProfile) return;
    const generated = generateScheduleSlots({
      startTime: genStartTime,
      lessonCount: genCount,
      lessonDurationMinutes: genDuration,
      introFileName: genIntro.trim() || undefined,
      introDelayMs: genIntroDelay,
      lessonFilePattern: genPattern,
      endOfDayLabel: genEndLabel.trim() || undefined,
      endOfDayFileName: genEndFile.trim() || undefined,
      breaks: genBreaks
    });
    updateActiveProfile((p) => ({ ...p, slots: generated }));
    setShowGen(false);
  };

  const handleShiftProfile = () => {
    if (!activeProfile) return;
    updateActiveProfile((p) => ({
      ...p,
      slots: sortSlots(
        p.slots.map((s) => ({
          ...s,
          time: shiftTimeHHMM(s.time, shiftDelta).time
        }))
      )
    }));
  };

  const addSlot = () => {
    if (!activeProfile) return;
    const newSlot: ScheduleSlot = {
      id: createId(),
      time: '07:00',
      label: 'Jam Baru',
      enabled: true,
      steps: [
        {
          id: createId(),
          fileName: audioFiles[0]?.relativePath || 'jam_1.mp3',
          delayBeforeMs: 0,
          volume: 100
        }
      ]
    };
    updateActiveProfile((p) => ({ ...p, slots: [...p.slots, newSlot] }));
  };

  const profileById = new Map(draft.profiles.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      {/* Top Action & Save Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'profiles' as const, label: 'Profil & Slot Jam', icon: <Layers className="h-4 w-4" /> },
            {
              id: 'calendar' as const,
              label: 'Mingguan & Kalender',
              icon: <CalendarDays className="h-4 w-4" />
            },
            { id: 'shutdown' as const, label: 'Auto-Shutdown PC', icon: <Power className="h-4 w-4" /> }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ${
                subTab === item.id
                  ? 'bg-slate-100 text-slate-900'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasEdits && (
            <button
              type="button"
              onClick={handleResetDraft}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          <button
            type="button"
            disabled={saving || (!hasEdits && !hasLocalUnsyncedChanges)}
            onClick={() => void handleSaveAll()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            <Save className="h-4 w-4" />
            {saving
              ? 'Menyimpan...'
              : hasEdits
                ? 'Simpan & Terapkan Jadwal'
                : 'Tersimpan'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            feedback.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* SUBTAB 1: PROFILES & SLOTS */}
      {subTab === 'profiles' && (
        <div className="grid gap-4 lg:grid-cols-4">
          {/* Profile selector sidebar */}
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Daftar Profil
              </h3>
              <button
                type="button"
                onClick={handleCreateProfile}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Baru
              </button>
            </div>

            <div className="space-y-1.5 pt-1">
              {draft.profiles.map((p) => {
                const selected = activeProfile?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProfileId(p.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                      selected
                        ? 'bg-blue-600/20 text-white ring-1 ring-blue-500'
                        : 'bg-slate-950/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="truncate">{p.name}</span>
                    </div>
                    <span className="ml-2 shrink-0 text-[11px] text-slate-400">
                      {p.slots.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Profile editor */}
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:col-span-3">
            {!activeProfile ? (
              <p className="py-10 text-center text-sm text-slate-500">
                Pilih atau buat profil jadwal baru.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-400">
                      Nama Profil
                    </label>
                    <input
                      type="text"
                      value={activeProfile.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        updateActiveProfile((p) => ({ ...p, name }));
                      }}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Warna</label>
                    <div className="flex items-center gap-2 pt-1.5">
                      {COLOR_OPTIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => updateActiveProfile((p) => ({ ...p, color: c }))}
                          className={`h-6 w-6 rounded-full border-2 ${
                            activeProfile.color === c ? 'border-white scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-800 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowGen((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/25"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {showGen ? 'Tutup Generator' : 'Generator Jam Otomatis'}
                    </button>

                    <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-2 py-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="number"
                        value={shiftDelta}
                        onChange={(e) => setShiftDelta(Number(e.target.value || 0))}
                        className="w-14 bg-transparent text-center text-xs text-white focus:outline-none"
                      />
                      <span className="text-[11px] text-slate-400">mnt</span>
                      <button
                        type="button"
                        onClick={handleShiftProfile}
                        className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        Geser Jam
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDuplicateProfile}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Duplikat
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteProfile}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </button>
                  </div>
                </div>

                {showGen && (
                  <div className="space-y-3 rounded-xl border border-indigo-500/30 bg-slate-950 p-3.5 text-xs">
                    <div className="grid gap-2.5 sm:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-slate-400">Jam Mulai</label>
                        <input
                          type="time"
                          value={genStartTime}
                          onChange={(e) => setGenStartTime(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-slate-400">Jumlah JP</label>
                        <input
                          type="number"
                          min={1}
                          max={16}
                          value={genCount}
                          onChange={(e) => setGenCount(Number(e.target.value || 1))}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-slate-400">Durasi JP (mnt)</label>
                        <input
                          type="number"
                          min={10}
                          max={120}
                          value={genDuration}
                          onChange={(e) => setGenDuration(Number(e.target.value || 40))}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-slate-400">Pola MP3 JP</label>
                        <input
                          type="text"
                          value={genPattern}
                          onChange={(e) => setGenPattern(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-slate-400">Intro Opsional</label>
                        <input
                          list="desktop-editor-audio"
                          value={genIntro}
                          onChange={(e) => setGenIntro(e.target.value)}
                          placeholder="Kosongkan jika langsung bel"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-slate-400">Jeda Intro (ms)</label>
                        <input
                          type="number"
                          value={genIntroDelay}
                          onChange={(e) => setGenIntroDelay(Number(e.target.value || 0))}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-slate-400">MP3 Pulang</label>
                        <input
                          list="desktop-editor-audio"
                          value={genEndFile}
                          onChange={(e) => setGenEndFile(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-white"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Istirahat</span>
                        <button
                          type="button"
                          onClick={() =>
                            setGenBreaks((prev) => [
                              ...prev,
                              {
                                afterLesson: 6,
                                durationMinutes: 30,
                                label: 'Istirahat 2',
                                fileName: 'istirahat_2.mp3'
                              }
                            ])
                          }
                          className="text-indigo-400 hover:underline"
                        >
                          + Tambah Istirahat
                        </button>
                      </div>
                      {genBreaks.map((brk, idx) => (
                        <div key={idx} className="grid gap-2 sm:grid-cols-5">
                          <input
                            type="number"
                            value={brk.afterLesson}
                            onChange={(e) =>
                              setGenBreaks((prev) =>
                                prev.map((b, i) =>
                                  i === idx ? { ...b, afterLesson: Number(e.target.value || 1) } : b
                                )
                              )
                            }
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                          />
                          <input
                            type="number"
                            value={brk.durationMinutes}
                            onChange={(e) =>
                              setGenBreaks((prev) =>
                                prev.map((b, i) =>
                                  i === idx
                                    ? { ...b, durationMinutes: Number(e.target.value || 10) }
                                    : b
                                )
                              )
                            }
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                          />
                          <input
                            type="text"
                            value={brk.label}
                            onChange={(e) =>
                              setGenBreaks((prev) =>
                                prev.map((b, i) => (i === idx ? { ...b, label: e.target.value } : b))
                              )
                            }
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                          />
                          <input
                            list="desktop-editor-audio"
                            value={brk.fileName}
                            onChange={(e) =>
                              setGenBreaks((prev) =>
                                prev.map((b, i) =>
                                  i === idx ? { ...b, fileName: e.target.value } : b
                                )
                              )
                            }
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setGenBreaks((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded-lg border border-rose-500/30 px-2 py-1 text-rose-300"
                          >
                            Hapus
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <input
                        type="text"
                        value={genEndLabel}
                        onChange={(e) => setGenEndLabel(e.target.value)}
                        placeholder="Label Pulang"
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-white"
                      />
                      <button
                        type="button"
                        onClick={handleApplyGenerator}
                        className="rounded-xl bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700"
                      >
                        Terapkan Hasil Generator
                      </button>
                    </div>
                  </div>
                )}

                {/* Slots */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Slot Jam ({activeProfile.slots.length})
                    </h4>
                    <button
                      type="button"
                      onClick={addSlot}
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Jam
                    </button>
                  </div>

                  {activeProfile.slots.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
                      Belum ada slot. Klik <strong>Tambah Jam</strong> atau pakai{' '}
                      <strong>Generator Jam Otomatis</strong>.
                    </div>
                  ) : (
                    activeProfile.slots.map((slot) => (
                      <div
                        key={slot.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="time"
                            value={slot.time}
                            onChange={(e) => {
                              const time = e.target.value;
                              updateActiveProfile((p) => ({
                                ...p,
                                slots: p.slots.map((s) => (s.id === slot.id ? { ...s, time } : s))
                              }));
                            }}
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white"
                          />
                          <input
                            type="text"
                            value={slot.label}
                            onChange={(e) => {
                              const label = e.target.value;
                              updateActiveProfile((p) => ({
                                ...p,
                                slots: p.slots.map((s) => (s.id === slot.id ? { ...s, label } : s))
                              }));
                            }}
                            className="min-w-[160px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                          />
                          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={slot.enabled}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                updateActiveProfile((p) => ({
                                  ...p,
                                  slots: p.slots.map((s) =>
                                    s.id === slot.id ? { ...s, enabled } : s
                                  )
                                }));
                              }}
                              className="h-4 w-4 rounded"
                            />
                            Aktif
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveProfile((p) => ({
                                ...p,
                                slots: p.slots.filter((s) => s.id !== slot.id)
                              }))
                            }
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="mt-2 space-y-1.5 border-t border-slate-800/80 pt-2">
                          {slot.steps.map((st, idx) => (
                            <div key={st.id} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="w-14 text-[11px] text-slate-500">#{idx + 1}</span>
                              <input
                                list="desktop-editor-audio"
                                value={st.fileName}
                                onChange={(e) => {
                                  const fileName = e.target.value;
                                  updateActiveProfile((p) => ({
                                    ...p,
                                    slots: p.slots.map((s) =>
                                      s.id === slot.id
                                        ? {
                                            ...s,
                                            steps: s.steps.map((x) =>
                                              x.id === st.id ? { ...x, fileName } : x
                                            )
                                          }
                                        : s
                                    )
                                  }));
                                }}
                                className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                              />
                              {idx > 0 && (
                                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                  <span>Jeda</span>
                                  <input
                                    type="number"
                                    value={st.delayBeforeMs}
                                    onChange={(e) => {
                                      const delayBeforeMs = Number(e.target.value || 0);
                                      updateActiveProfile((p) => ({
                                        ...p,
                                        slots: p.slots.map((s) =>
                                          s.id === slot.id
                                            ? {
                                                ...s,
                                                steps: s.steps.map((x) =>
                                                  x.id === st.id ? { ...x, delayBeforeMs } : x
                                                )
                                              }
                                            : s
                                        )
                                      }));
                                    }}
                                    className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                                  />
                                  <span>ms</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                <span>Vol</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={st.volume}
                                  onChange={(e) => {
                                    const volume = Number(e.target.value || 100);
                                    updateActiveProfile((p) => ({
                                      ...p,
                                      slots: p.slots.map((s) =>
                                        s.id === slot.id
                                          ? {
                                              ...s,
                                              steps: s.steps.map((x) =>
                                                x.id === st.id ? { ...x, volume } : x
                                              )
                                            }
                                          : s
                                      )
                                    }));
                                  }}
                                  className="w-14 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-white"
                                />
                              </div>
                              {slot.steps.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateActiveProfile((p) => ({
                                      ...p,
                                      slots: p.slots.map((s) =>
                                        s.id === slot.id
                                          ? { ...s, steps: s.steps.filter((x) => x.id !== st.id) }
                                          : s
                                      )
                                    }))
                                  }
                                  className="text-rose-400 hover:underline"
                                >
                                  Hapus
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveProfile((p) => ({
                                ...p,
                                slots: p.slots.map((s) =>
                                  s.id === slot.id
                                    ? {
                                        ...s,
                                        steps: [
                                          ...s.steps,
                                          {
                                            id: createId(),
                                            fileName: audioFiles[0]?.relativePath || '',
                                            delayBeforeMs: 1500,
                                            volume: 100
                                          }
                                        ]
                                      }
                                    : s
                                )
                              }))
                            }
                            className="text-[11px] font-medium text-blue-400 hover:underline"
                          >
                            + Tambah Audio Lanjutan
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <datalist id="desktop-editor-audio">
            {audioFiles.map((f) => (
              <option key={f.relativePath} value={f.relativePath} />
            ))}
          </datalist>
        </div>
      )}

      {/* SUBTAB 2: WEEKLY & CALENDAR OVERRIDES */}
      {subTab === 'calendar' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="font-bold text-white">Aturan Mingguan</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Pasangkan setiap hari dengan profil jadwalnya.
            </p>
            <div className="mt-3 space-y-2">
              {ORDERED_DAYS.map((dayIdx) => {
                const currentRule = draft.weeklyRules.find((r) => r.dayOfWeek === dayIdx);
                return (
                  <div
                    key={dayIdx}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <span className="w-24 text-xs font-semibold text-slate-200">
                      {DAY_NAMES_ID[dayIdx]}
                    </span>
                    <select
                      value={currentRule?.profileId ?? ''}
                      onChange={(e) => {
                        const profileId = e.target.value || null;
                        updateDraft((prev) => ({
                          ...prev,
                          weeklyRules: prev.weeklyRules.map((r) =>
                            r.dayOfWeek === dayIdx
                              ? { ...r, profileId, updatedAt: new Date().toISOString() }
                              : r
                          )
                        }));
                      }}
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="">Libur / Bel Nonaktif</option>
                      {draft.profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-white">Pengecualian Tanggal (Ujian / Libur)</h3>
                <button
                  type="button"
                  onClick={() => {
                    updateDraft((prev) => ({
                      ...prev,
                      dateOverrides: [
                        ...prev.dateOverrides.filter(
                          (o) => !(o.startDate === todayStr && o.endDate === todayStr)
                        ),
                        {
                          id: createId(),
                          startDate: todayStr,
                          endDate: todayStr,
                          profileId: null,
                          note: 'Bel dimatikan dari PC Bel',
                          createdBy: 'PC Bel Desktop',
                          createdAt: new Date().toISOString()
                        }
                      ]
                    }));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  Matikan Bel Hari Ini
                </button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  type="date"
                  value={ovStart}
                  onChange={(e) => {
                    setOvStart(e.target.value);
                    if (ovEnd < e.target.value) setOvEnd(e.target.value);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
                <input
                  type="date"
                  value={ovEnd}
                  min={ovStart}
                  onChange={(e) => setOvEnd(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                />
                <select
                  value={ovProfileId}
                  onChange={(e) => setOvProfileId(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white sm:col-span-2"
                >
                  <option value="">Libur / Matikan Bel</option>
                  {draft.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={ovNote}
                  onChange={(e) => setOvNote(e.target.value)}
                  placeholder="Catatan (misal: Ujian PAS / Libur Nasional)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white sm:col-span-2"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!ovNote.trim()) return;
                    updateDraft((prev) => ({
                      ...prev,
                      dateOverrides: [
                        ...prev.dateOverrides,
                        {
                          id: createId(),
                          startDate: ovStart,
                          endDate: ovEnd < ovStart ? ovStart : ovEnd,
                          profileId: ovProfileId || null,
                          note: ovNote.trim(),
                          createdBy: 'PC Bel Desktop',
                          createdAt: new Date().toISOString()
                        }
                      ]
                    }));
                    setOvNote('');
                  }}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 sm:col-span-2"
                >
                  + Tambah Pengecualian
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {draft.dateOverrides.map((ov) => {
                  const prof = ov.profileId ? profileById.get(ov.profileId) : null;
                  return (
                    <div
                      key={ov.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-slate-200">
                            {ov.startDate === ov.endDate
                              ? ov.startDate
                              : `${ov.startDate} s.d. ${ov.endDate}`}
                          </span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                            {prof ? prof.name : 'Libur'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">{ov.note}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            dateOverrides: prev.dateOverrides.filter((x) => x.id !== ov.id)
                          }))
                        }
                        className="rounded p-1 text-rose-400 hover:bg-rose-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: AUTO-SHUTDOWN */}
      {subTab === 'shutdown' && (() => {
        const sd = normalizeShutdownSettings(draft.shutdownSettings);
        const updateSdDay = (dayOfWeek: number, patch: { enabled?: boolean; time?: string }) => {
          updateDraft((prev) => {
            const cur = normalizeShutdownSettings(prev.shutdownSettings);
            return {
              ...prev,
              shutdownSettings: {
                ...cur,
                dayRules: cur.dayRules.map((r) =>
                  r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r
                )
              }
            };
          });
        };
        const copyMondayToTueThu = () => {
          const mon = sd.dayRules.find((r) => r.dayOfWeek === 1);
          if (!mon) return;
          updateDraft((prev) => {
            const cur = normalizeShutdownSettings(prev.shutdownSettings);
            return {
              ...prev,
              shutdownSettings: {
                ...cur,
                dayRules: cur.dayRules.map((r) =>
                  r.dayOfWeek >= 2 && r.dayOfWeek <= 4
                    ? { ...r, enabled: mon.enabled, time: mon.time }
                    : r
                )
              }
            };
          });
        };

        return (
          <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div>
              <h3 className="font-bold text-white">Auto-Shutdown PC Bel Per Hari</h3>
              <p className="text-xs text-slate-400">
                Atur jam mati otomatis berbeda tiap hari (misal Senin–Kamis, Jumat, Sabtu, dan
                Minggu masing-masing berbeda).
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-200">
                <input
                  type="checkbox"
                  checked={sd.enabled}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      shutdownSettings: {
                        ...normalizeShutdownSettings(prev.shutdownSettings),
                        enabled: e.target.checked
                      }
                    }))
                  }
                  className="h-4 w-4 rounded"
                />
                Aktifkan Auto-Shutdown Terjadwal
              </label>

              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span>Countdown:</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={sd.graceSeconds}
                  onChange={(e) =>
                    updateDraft((prev) => ({
                      ...prev,
                      shutdownSettings: {
                        ...normalizeShutdownSettings(prev.shutdownSettings),
                        graceSeconds: Number(e.target.value || 20)
                      }
                    }))
                  }
                  className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-center font-semibold text-white"
                />
                <span className="text-slate-400">detik</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Jadwal Mati per Hari</span>
                <button
                  type="button"
                  onClick={copyMondayToTueThu}
                  className="font-semibold text-blue-400 hover:underline"
                >
                  Samakan Senin → Sel–Kam
                </button>
              </div>

              <div className="space-y-1.5">
                {ORDERED_DAYS.map((dayIdx) => {
                  const rule = sd.dayRules.find((r) => r.dayOfWeek === dayIdx) ?? {
                    dayOfWeek: dayIdx,
                    enabled: false,
                    time: '16:30'
                  };
                  return (
                    <div
                      key={dayIdx}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                        rule.enabled
                          ? 'border-slate-700 bg-slate-950/70'
                          : 'border-slate-800/80 bg-slate-950/30 opacity-65'
                      }`}
                    >
                      <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-200">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => updateSdDay(dayIdx, { enabled: e.target.checked })}
                          className="h-4 w-4 rounded"
                        />
                        <span className={dayIdx === 0 || dayIdx === 6 ? 'text-amber-300' : ''}>
                          {DAY_NAMES_ID[dayIdx]}
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        {!rule.enabled && (
                          <span className="text-[11px] text-slate-500">Nonaktif</span>
                        )}
                        <input
                          type="time"
                          value={rule.time}
                          disabled={!rule.enabled}
                          onChange={(e) => updateSdDay(dayIdx, { time: e.target.value })}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
