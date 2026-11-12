import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDueSlots,
  generateScheduleSlots,
  getNextBellSlot,
  getZonedDateParts,
  resolveDaySchedule,
  shiftTimeHHMM,
  shouldTriggerAutoShutdown
} from './resolver.js';
import type { ScheduleSnapshot } from './types.js';

function createSampleSnapshot(): ScheduleSnapshot {
  return {
    version: 1,
    schoolName: 'SMK Negeri 1 Adiwerna',
    timeZone: 'Asia/Jakarta',
    profiles: [
      {
        id: 'p-senin',
        name: 'Senin (Upacara)',
        description: 'Upacara pagi lalu KBM',
        color: '#2563eb',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        slots: [
          {
            id: 's1',
            time: '07:00',
            label: 'Upacara Bendera',
            enabled: true,
            steps: [
              { id: 'st1', fileName: 'pengumuman_upacara.mp3', delayBeforeMs: 0, volume: 100 },
              { id: 'st2', fileName: 'bel_upacara.mp3', delayBeforeMs: 2000, volume: 100 }
            ]
          },
          {
            id: 's2',
            time: '07:45',
            label: 'Jam ke-2',
            enabled: true,
            steps: [{ id: 'st3', fileName: 'jam_2.mp3', delayBeforeMs: 0, volume: 100 }]
          }
        ]
      },
      {
        id: 'p-ujian',
        name: 'Ujian / PAS',
        description: 'Jadwal ujian',
        color: '#d97706',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        slots: [
          {
            id: 'u1',
            time: '07:30',
            label: 'Mulai Ujian Sesi 1',
            enabled: true,
            steps: [{ id: 'ust1', fileName: 'ujian_mulai.mp3', delayBeforeMs: 0, volume: 100 }]
          }
        ]
      }
    ],
    weeklyRules: [
      { dayOfWeek: 0, profileId: null, updatedAt: '2026-01-01T00:00:00Z' },
      { dayOfWeek: 1, profileId: 'p-senin', updatedAt: '2026-01-01T00:00:00Z' },
      { dayOfWeek: 2, profileId: null, updatedAt: '2026-01-01T00:00:00Z' },
      { dayOfWeek: 3, profileId: null, updatedAt: '2026-01-01T00:00:00Z' },
      { dayOfWeek: 4, profileId: null, updatedAt: '2026-01-01T00:00:00Z' },
      { dayOfWeek: 5, profileId: null, updatedAt: '2026-01-01T00:00:00Z' },
      { dayOfWeek: 6, profileId: null, updatedAt: '2026-01-01T00:00:00Z' }
    ],
    dateOverrides: [
      {
        id: 'ov-range',
        startDate: '2026-11-09',
        endDate: '2026-11-14',
        profileId: 'p-ujian',
        note: 'PAS Semester Ganjil',
        createdBy: 'waka',
        createdAt: '2026-11-01T00:00:00Z'
      },
      {
        id: 'ov-single-off',
        startDate: '2026-11-11',
        endDate: '2026-11-11',
        profileId: null,
        note: 'Libur Khusus',
        createdBy: 'piket',
        createdAt: '2026-11-10T00:00:00Z'
      }
    ],
    shutdownSettings: {
      enabled: true,
      time: '16:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      graceSeconds: 20,
      updatedAt: '2026-01-01T00:00:00Z'
    },
    generatedAt: '2026-11-01T00:00:00Z'
  };
}

test('resolveDaySchedule prioritizes narrowest override over range override and weekly rule', () => {
  const snapshot = createSampleSnapshot();

  // Monday outside override -> weekly rule p-senin
  const monday = resolveDaySchedule(snapshot, '2026-11-02', 1);
  assert.equal(monday.source, 'weekly');
  assert.equal(monday.profile?.id, 'p-senin');
  assert.equal(monday.slots.length, 2);

  // Monday inside exam range -> override p-ujian
  const examMonday = resolveDaySchedule(snapshot, '2026-11-09', 1);
  assert.equal(examMonday.source, 'override');
  assert.equal(examMonday.profile?.id, 'p-ujian');

  // Single-day libur inside exam range -> single-day wins
  const singleOff = resolveDaySchedule(snapshot, '2026-11-11', 3);
  assert.equal(singleOff.source, 'override');
  assert.equal(singleOff.profile, null);
  assert.equal(singleOff.slots.length, 0);
});

test('findDueSlots and getNextBellSlot behave accurately', () => {
  const snapshot = createSampleSnapshot();
  const monday = resolveDaySchedule(snapshot, '2026-11-02', 1);

  assert.equal(findDueSlots(monday, '07:00').length, 1);
  assert.equal(findDueSlots(monday, '07:01').length, 0);
  assert.equal(getNextBellSlot(monday, '07:00', false)?.id, 's2');
  assert.equal(getNextBellSlot(monday, '07:00', true)?.id, 's1');
  assert.equal(getNextBellSlot(monday, '08:00', true), null);
});

test('shiftTimeHHMM shifts and clamps cleanly', () => {
  assert.deepEqual(shiftTimeHHMM('07:00', 15), { time: '07:15', clamped: false });
  assert.deepEqual(shiftTimeHHMM('07:10', -20), { time: '06:50', clamped: false });
  assert.deepEqual(shiftTimeHHMM('00:05', -10), { time: '00:00', clamped: true });
});

test('generateScheduleSlots builds JP + breaks + end of day with optional intro', () => {
  const slots = generateScheduleSlots({
    startTime: '07:00',
    lessonCount: 3,
    lessonDurationMinutes: 40,
    introFileName: 'intro.mp3',
    introDelayMs: 1500,
    lessonFilePattern: 'jam_{n}.mp3',
    endOfDayLabel: 'Pulang',
    endOfDayFileName: 'pulang.mp3',
    breaks: [
      {
        afterLesson: 2,
        durationMinutes: 15,
        label: 'Istirahat 1',
        fileName: 'istirahat.mp3'
      }
    ]
  });

  assert.deepEqual(
    slots.map((s) => ({ time: s.time, label: s.label, files: s.steps.map((st) => st.fileName) })),
    [
      { time: '07:00', label: 'Jam Pelajaran ke-1', files: ['intro.mp3', 'jam_1.mp3'] },
      { time: '07:40', label: 'Jam Pelajaran ke-2', files: ['intro.mp3', 'jam_2.mp3'] },
      { time: '08:20', label: 'Istirahat 1', files: ['istirahat.mp3'] },
      { time: '08:35', label: 'Jam Pelajaran ke-3', files: ['intro.mp3', 'jam_3.mp3'] },
      { time: '09:15', label: 'Pulang', files: ['pulang.mp3'] }
    ]
  );
});

test('shouldTriggerAutoShutdown respects enabled, dayOfWeek, and time', () => {
  const snapshot = createSampleSnapshot();
  assert.equal(shouldTriggerAutoShutdown(snapshot.shutdownSettings, 1, '16:30'), true);
  assert.equal(shouldTriggerAutoShutdown(snapshot.shutdownSettings, 6, '16:30'), false);
  assert.equal(shouldTriggerAutoShutdown(snapshot.shutdownSettings, 1, '16:31'), false);
});

test('getZonedDateParts formats Asia/Jakarta properly', () => {
  // 2026-11-12T00:00:00Z is 07:00:00 Asia/Jakarta (Thursday)
  const parts = getZonedDateParts(Date.parse('2026-11-12T00:00:00Z'), 'Asia/Jakarta');
  assert.equal(parts.dateStr, '2026-11-12');
  assert.equal(parts.timeStr, '07:00');
  assert.equal(parts.dayOfWeek, 4);
});
