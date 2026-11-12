import { useState } from 'react';
import { Plus, Trash2, Wand2, X } from 'lucide-react';
import {
  createId,
  type AudioFileEntry,
  type GenerateScheduleBreak,
  type ScheduleProfile,
  type ScheduleSlot
} from '@jadwal-adb/shared';
import { api } from '../api.js';

interface ProfileEditorModalProps {
  profile: ScheduleProfile | null;
  audioFiles: AudioFileEntry[];
  onClose: () => void;
  onSave: (payload: {
    name: string;
    description: string;
    color: string;
    slots: ScheduleSlot[];
  }) => Promise<void>;
}

const COLOR_OPTIONS = [
  { label: 'Biru', value: '#2563eb' },
  { label: 'Hijau', value: '#059669' },
  { label: 'Ungu', value: '#7c3aed' },
  { label: 'Oranye', value: '#d97706' },
  { label: 'Merah', value: '#dc2626' },
  { label: 'Teal', value: '#0d9488' }
];

export function ProfileEditorModal({
  profile,
  audioFiles,
  onClose,
  onSave
}: ProfileEditorModalProps) {
  const [name, setName] = useState(profile?.name || '');
  const [description, setDescription] = useState(profile?.description || '');
  const [color, setColor] = useState(profile?.color || '#2563eb');
  const [slots, setSlots] = useState<ScheduleSlot[]>(
    profile?.slots.map((s) => ({
      ...s,
      steps: s.steps.map((st) => ({ ...st }))
    })) || []
  );

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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    try {
      const res = await api.generatePreview({
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
      setSlots(res.slots);
      setShowGen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat jadwal otomatis');
    }
  };

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
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
      }
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Nama profil wajib diisi');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        color,
        slots: [...slots].sort((a, b) => a.time.localeCompare(b.time))
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan profil');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {profile ? `Edit Profil: ${profile.name}` : 'Buat Profil Jadwal Baru'}
            </h3>
            <p className="text-xs text-slate-500">
              Atur jam bel dan rangkaian file MP3 (pengumuman + bel) untuk profil ini.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-700">Nama Profil</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Senin (Upacara)"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Warna Label</label>
                <div className="flex items-center gap-2 pt-1.5">
                  {COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setColor(opt.value)}
                      className={`h-7 w-7 rounded-full border-2 ${
                        color === opt.value ? 'border-slate-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: opt.value }}
                      title={opt.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Deskripsi</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Catatan singkat kapan profil ini dipakai..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Bulk Generator */}
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold text-indigo-950">
                    <Wand2 className="h-4 w-4 text-indigo-600" />
                    Generator Jam Pelajaran Otomatis
                  </h4>
                  <p className="text-xs text-indigo-700">
                    Isi jam mulai, durasi per JP, dan istirahat untuk membangkitkan seluruh jadwal sekaligus.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGen((v) => !v)}
                  className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                >
                  {showGen ? 'Tutup Generator' : 'Buka Generator'}
                </button>
              </div>

              {showGen && (
                <div className="mt-4 space-y-3 border-t border-indigo-200/70 pt-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Jam Mulai</label>
                      <input
                        type="time"
                        value={genStartTime}
                        onChange={(e) => setGenStartTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Jumlah JP</label>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={genCount}
                        onChange={(e) => setGenCount(Number(e.target.value || 1))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Durasi JP (menit)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={120}
                        value={genDuration}
                        onChange={(e) => setGenDuration(Number(e.target.value || 40))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Pola MP3 JP
                      </label>
                      <input
                        type="text"
                        value={genPattern}
                        onChange={(e) => setGenPattern(e.target.value)}
                        placeholder="jam_{n}.mp3"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Intro/Pengumuman Sebelum Bel (opsional)
                      </label>
                      <input
                        list="editor-audio-files"
                        value={genIntro}
                        onChange={(e) => setGenIntro(e.target.value)}
                        placeholder="Kosongkan jika langsung bel"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Jeda Intro (ms)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30000}
                        step={500}
                        value={genIntroDelay}
                        onChange={(e) => setGenIntroDelay(Number(e.target.value || 0))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        MP3 Pulang
                      </label>
                      <input
                        list="editor-audio-files"
                        value={genEndFile}
                        onChange={(e) => setGenEndFile(e.target.value)}
                        placeholder="pulang.mp3"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">Istirahat</span>
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
                        className="text-xs font-medium text-indigo-700 hover:underline"
                      >
                        + Tambah Istirahat
                      </button>
                    </div>
                    {genBreaks.map((brk, idx) => (
                      <div key={idx} className="grid gap-2 sm:grid-cols-5">
                        <input
                          type="number"
                          min={1}
                          value={brk.afterLesson}
                          onChange={(e) =>
                            setGenBreaks((prev) =>
                              prev.map((b, i) =>
                                i === idx ? { ...b, afterLesson: Number(e.target.value || 1) } : b
                              )
                            )
                          }
                          placeholder="Setelah JP"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                        <input
                          type="number"
                          min={5}
                          value={brk.durationMinutes}
                          onChange={(e) =>
                            setGenBreaks((prev) =>
                              prev.map((b, i) =>
                                i === idx ? { ...b, durationMinutes: Number(e.target.value || 10) } : b
                              )
                            )
                          }
                          placeholder="Durasi (mnt)"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                        <input
                          type="text"
                          value={brk.label}
                          onChange={(e) =>
                            setGenBreaks((prev) =>
                              prev.map((b, i) => (i === idx ? { ...b, label: e.target.value } : b))
                            )
                          }
                          placeholder="Label"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                        <input
                          list="editor-audio-files"
                          value={brk.fileName}
                          onChange={(e) =>
                            setGenBreaks((prev) =>
                              prev.map((b, i) => (i === idx ? { ...b, fileName: e.target.value } : b))
                            )
                          }
                          placeholder="File MP3"
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setGenBreaks((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600">Label Pulang:</label>
                      <input
                        type="text"
                        value={genEndLabel}
                        onChange={(e) => setGenEndLabel(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerate}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      Generate & Ganti Daftar Slot
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Slot list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">
                  Daftar Slot Jam ({slots.length})
                </h4>
                <button
                  type="button"
                  onClick={addSlot}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Jam
                </button>
              </div>

              {slots.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  Belum ada slot jadwal. Klik <strong>Tambah Jam</strong> atau pakai{' '}
                  <strong>Generator Jam Pelajaran</strong>.
                </div>
              ) : (
                <div className="space-y-3">
                  {slots.map((slot) => (
                    <div
                      key={slot.id}
                      className={`rounded-xl border p-3.5 ${
                        slot.enabled
                          ? 'border-slate-200 bg-white'
                          : 'border-slate-200 bg-slate-50 opacity-70'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2.5">
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) => {
                            const time = e.target.value;
                            setSlots((prev) =>
                              prev.map((s) => (s.id === slot.id ? { ...s, time } : s))
                            );
                          }}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold"
                          required
                        />
                        <input
                          type="text"
                          value={slot.label}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSlots((prev) =>
                              prev.map((s) => (s.id === slot.id ? { ...s, label: val } : s))
                            );
                          }}
                          placeholder="Label kegiatan"
                          className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                          required
                        />
                        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={slot.enabled}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              setSlots((prev) =>
                                prev.map((s) => (s.id === slot.id ? { ...s, enabled } : s))
                              );
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Aktif
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setSlots((prev) => prev.filter((s) => s.id !== slot.id))
                          }
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Hapus slot"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Audio steps */}
                      <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
                        {slot.steps.map((step, stIdx) => (
                          <div key={step.id} className="flex flex-wrap items-center gap-2">
                            <span className="w-16 text-[11px] font-medium text-slate-500">
                              Audio #{stIdx + 1}
                            </span>
                            <input
                              list="editor-audio-files"
                              value={step.fileName}
                              onChange={(e) => {
                                const fileName = e.target.value;
                                setSlots((prev) =>
                                  prev.map((s) =>
                                    s.id === slot.id
                                      ? {
                                          ...s,
                                          steps: s.steps.map((st) =>
                                            st.id === step.id ? { ...st, fileName } : st
                                          )
                                        }
                                      : s
                                  )
                                );
                              }}
                              placeholder="nama_file.mp3"
                              className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
                              required
                            />
                            {stIdx > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-slate-500">Jeda</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={60000}
                                  step={500}
                                  value={step.delayBeforeMs}
                                  onChange={(e) => {
                                    const ms = Number(e.target.value || 0);
                                    setSlots((prev) =>
                                      prev.map((s) =>
                                        s.id === slot.id
                                          ? {
                                              ...s,
                                              steps: s.steps.map((st) =>
                                                st.id === step.id ? { ...st, delayBeforeMs: ms } : st
                                              )
                                            }
                                          : s
                                      )
                                    );
                                  }}
                                  className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                                />
                                <span className="text-[11px] text-slate-500">ms</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-slate-500">Vol</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={step.volume}
                                onChange={(e) => {
                                  const vol = Number(e.target.value || 100);
                                  setSlots((prev) =>
                                    prev.map((s) =>
                                      s.id === slot.id
                                        ? {
                                            ...s,
                                            steps: s.steps.map((st) =>
                                              st.id === step.id ? { ...st, volume: vol } : st
                                            )
                                          }
                                        : s
                                    )
                                  );
                                }}
                                className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                              />
                              <span className="text-[11px] text-slate-500">%</span>
                            </div>
                            {slot.steps.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSlots((prev) =>
                                    prev.map((s) =>
                                      s.id === slot.id
                                        ? {
                                            ...s,
                                            steps: s.steps.filter((st) => st.id !== step.id)
                                          }
                                        : s
                                    )
                                  )
                                }
                                className="text-xs text-rose-500 hover:underline"
                              >
                                Hapus
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setSlots((prev) =>
                              prev.map((s) =>
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
                            )
                          }
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          + Tambah Audio Lanjutan (misal pengumuman lalu bel)
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <datalist id="editor-audio-files">
              {audioFiles.map((file) => (
                <option key={file.relativePath} value={file.relativePath} />
              ))}
            </datalist>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan & Sinkronkan ke PC Bel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
