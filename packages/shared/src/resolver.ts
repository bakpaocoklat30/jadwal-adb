import type {
  AudioStep,
  DateOverride,
  GenerateScheduleInput,
  ResolvedDaySchedule,
  ScheduleProfile,
  ScheduleSlot,
  ScheduleSnapshot,
  ShutdownSettings,
  ZonedDateParts
} from './types.js';

export const DAY_NAMES_ID = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu'
] as const;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function getZonedDateParts(nowMs: number, timeZone = 'Asia/Jakarta'): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false
  });

  const parts = formatter.formatToParts(new Date(nowMs));
  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      lookup[p.type] = p.value;
    }
  }

  const rawHour = lookup.hour === '24' ? '00' : lookup.hour ?? '00';
  const hour = Number(rawHour);
  const minute = Number(lookup.minute ?? '0');
  const second = Number(lookup.second ?? '0');
  const dateStr = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const dayOfWeek = WEEKDAY_MAP[lookup.weekday ?? 'Mon'] ?? 1;

  return {
    dateStr,
    timeStr,
    second,
    dayOfWeek,
    minutesOfDay: hour * 60 + minute
  };
}

export function timeToMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(':');
  return Number(hStr) * 60 + Number(mStr);
}

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function shiftTimeHHMM(
  timeStr: string,
  deltaMinutes: number
): { time: string; clamped: boolean } {
  const raw = timeToMinutes(timeStr) + deltaMinutes;
  const clamped = raw < 0 || raw > 23 * 60 + 59;
  return {
    time: minutesToTime(raw),
    clamped
  };
}

export function sortSlots(slots: ScheduleSlot[]): ScheduleSlot[] {
  return [...slots].sort((a, b) => a.time.localeCompare(b.time));
}

function dateDiffDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function pickActiveDateOverride(
  overrides: DateOverride[],
  dateStr: string
): DateOverride | null {
  const matching = overrides.filter(
    (ov) => ov.startDate <= dateStr && dateStr <= ov.endDate
  );
  if (matching.length === 0) return null;

  // Prefer the most specific (shortest range) override, then newest createdAt
  matching.sort((a, b) => {
    const spanDiff = dateDiffDays(a.startDate, a.endDate) - dateDiffDays(b.startDate, b.endDate);
    if (spanDiff !== 0) return spanDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return matching[0] ?? null;
}

export function resolveDaySchedule(
  snapshot: ScheduleSnapshot,
  dateStr: string,
  dayOfWeek: number
): ResolvedDaySchedule {
  const profilesById = new Map<string, ScheduleProfile>();
  for (const p of snapshot.profiles) {
    profilesById.set(p.id, p);
  }

  const override = pickActiveDateOverride(snapshot.dateOverrides, dateStr);
  if (override) {
    const profile = override.profileId ? profilesById.get(override.profileId) ?? null : null;
    return {
      dateStr,
      dayOfWeek,
      source: 'override',
      override,
      profile,
      slots: profile ? sortSlots(profile.slots) : []
    };
  }

  const weekly = snapshot.weeklyRules.find((r) => r.dayOfWeek === dayOfWeek);
  if (weekly) {
    const profile = weekly.profileId ? profilesById.get(weekly.profileId) ?? null : null;
    return {
      dateStr,
      dayOfWeek,
      source: 'weekly',
      override: null,
      profile,
      slots: profile ? sortSlots(profile.slots) : []
    };
  }

  return {
    dateStr,
    dayOfWeek,
    source: 'none',
    override: null,
    profile: null,
    slots: []
  };
}

export function findDueSlots(resolved: ResolvedDaySchedule, timeStr: string): ScheduleSlot[] {
  return resolved.slots.filter((slot) => slot.enabled && slot.time === timeStr);
}

export function getNextBellSlot(
  resolved: ResolvedDaySchedule,
  currentTimeStr: string,
  inclusive = false
): ScheduleSlot | null {
  const enabled = resolved.slots.filter((s) => s.enabled);
  for (const slot of enabled) {
    if (inclusive ? slot.time >= currentTimeStr : slot.time > currentTimeStr) {
      return slot;
    }
  }
  return null;
}

export function shouldTriggerAutoShutdown(
  shutdown: ShutdownSettings,
  dayOfWeek: number,
  timeStr: string
): boolean {
  if (!shutdown.enabled) return false;
  if (!shutdown.daysOfWeek.includes(dayOfWeek)) return false;
  return shutdown.time === timeStr;
}

function makeStep(fileName: string, delayBeforeMs = 0, volume = 100): AudioStep {
  return {
    id: crypto.randomUUID(),
    fileName,
    delayBeforeMs,
    volume
  };
}

export function generateScheduleSlots(input: GenerateScheduleInput): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  let cursorMinutes = timeToMinutes(input.startTime);

  const breaksByLesson = new Map(input.breaks.map((b) => [b.afterLesson, b]));
  const pattern = input.lessonFilePattern?.trim() || 'jam_{n}.mp3';

  for (let lesson = 1; lesson <= input.lessonCount; lesson += 1) {
    const lessonFile = pattern.replace(/\{n\}/g, String(lesson));
    const steps: AudioStep[] = [];

    if (input.introFileName?.trim()) {
      steps.push(makeStep(input.introFileName.trim(), 0, 100));
      steps.push(makeStep(lessonFile, input.introDelayMs ?? 1500, 100));
    } else {
      steps.push(makeStep(lessonFile, 0, 100));
    }

    slots.push({
      id: crypto.randomUUID(),
      time: minutesToTime(cursorMinutes),
      label: `Jam Pelajaran ke-${lesson}`,
      enabled: true,
      steps
    });

    cursorMinutes += input.lessonDurationMinutes;

    const brk = breaksByLesson.get(lesson);
    if (brk) {
      slots.push({
        id: crypto.randomUUID(),
        time: minutesToTime(cursorMinutes),
        label: brk.label,
        enabled: true,
        steps: [makeStep(brk.fileName, 0, 100)]
      });
      cursorMinutes += brk.durationMinutes;
    }
  }

  if (input.endOfDayFileName?.trim()) {
    slots.push({
      id: crypto.randomUUID(),
      time: minutesToTime(cursorMinutes),
      label: input.endOfDayLabel?.trim() || 'Bel Pulang',
      enabled: true,
      steps: [makeStep(input.endOfDayFileName.trim(), 0, 100)]
    });
  }

  return sortSlots(slots);
}
