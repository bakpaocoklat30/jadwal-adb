export type UserRole = 'admin' | 'waka' | 'piket';

export interface UserPublic {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AudioStep {
  id: string;
  fileName: string;
  delayBeforeMs: number;
  volume: number; // 0 - 100
}

export interface ScheduleSlot {
  id: string;
  time: string; // HH:MM
  label: string;
  enabled: boolean;
  steps: AudioStep[];
}

export interface ScheduleProfile {
  id: string;
  name: string;
  description: string;
  color: string;
  slots: ScheduleSlot[];
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyRule {
  dayOfWeek: number; // 0 = Minggu .. 6 = Sabtu
  profileId: string | null;
  updatedAt: string;
}

export interface DateOverride {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  profileId: string | null; // null = Libur / Matikan Bel
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface ShutdownSettings {
  enabled: boolean;
  time: string; // HH:MM
  daysOfWeek: number[];
  graceSeconds: number;
  updatedAt: string;
}

export interface ScheduleSnapshot {
  version: number;
  schoolName: string;
  timeZone: string;
  profiles: ScheduleProfile[];
  weeklyRules: WeeklyRule[];
  dateOverrides: DateOverride[];
  shutdownSettings: ShutdownSettings;
  generatedAt: string;
}

export interface AudioFileEntry {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  updatedAt: string;
}

export type ShutdownState = 'idle' | 'pending' | 'shutting_down';
export type ShutdownAction = 'shutdown' | 'restart';

export interface DeviceStatus {
  online: boolean;
  deviceName: string;
  platform: string;
  appVersion: string;
  audioDir: string;
  audioCount: number;
  activeScheduleVersion: number;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  clockDriftMs: number;
  isPlaying: boolean;
  currentPlayingLabel: string | null;
  shutdownState: ShutdownState;
  shutdownAction: ShutdownAction | null;
  shutdownRemainingSec: number | null;
  shutdownReason: string | null;
  lastShutdownReason: string | null;
  lastShutdownAt: string | null;
}

export type BellLogTrigger = 'scheduled' | 'manual' | 'system';
export type BellLogStatus =
  | 'played'
  | 'partial'
  | 'missing_file'
  | 'failed'
  | 'stopped'
  | 'shutdown_triggered'
  | 'shutdown_cancelled';

export interface BellLog {
  id: string;
  occurredAt: string;
  triggerType: BellLogTrigger;
  status: BellLogStatus;
  profileName: string | null;
  slotLabel: string;
  scheduledTime: string | null;
  files: string[];
  actorName: string | null;
  detail: string | null;
}

export interface BellLogInput {
  id?: string;
  occurredAt: string;
  triggerType: BellLogTrigger;
  status: BellLogStatus;
  profileName: string | null;
  slotLabel: string;
  scheduledTime: string | null;
  files: string[];
  actorName: string | null;
  detail: string | null;
}

export type RemoteCommand =
  | {
      type: 'play_manual';
      commandId: string;
      label: string;
      steps: AudioStep[];
      requestedBy: string;
    }
  | {
      type: 'stop_audio';
      commandId: string;
      requestedBy: string;
    }
  | {
      type: 'sync_now';
      commandId: string;
      requestedBy: string;
    }
  | {
      type: 'shutdown_pc';
      commandId: string;
      action: ShutdownAction;
      graceSeconds: number;
      reason: string;
      requestedBy: string;
    }
  | {
      type: 'cancel_shutdown';
      commandId: string;
      requestedBy: string;
    };

export interface ZonedDateParts {
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM
  second: number;
  dayOfWeek: number; // 0 = Minggu .. 6 = Sabtu
  minutesOfDay: number;
}

export interface ResolvedDaySchedule {
  dateStr: string;
  dayOfWeek: number;
  source: 'override' | 'weekly' | 'none';
  override: DateOverride | null;
  profile: ScheduleProfile | null;
  slots: ScheduleSlot[];
}

export interface GenerateScheduleBreak {
  afterLesson: number;
  durationMinutes: number;
  label: string;
  fileName: string;
}

export interface GenerateScheduleInput {
  startTime: string; // HH:MM
  lessonCount: number;
  lessonDurationMinutes: number;
  introFileName?: string;
  introDelayMs?: number;
  lessonFilePattern?: string; // e.g. "jam_{n}.mp3" or fixed file
  endOfDayLabel?: string;
  endOfDayFileName?: string;
  breaks: GenerateScheduleBreak[];
}
