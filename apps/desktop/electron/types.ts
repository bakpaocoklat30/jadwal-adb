import type {
  AudioFileEntry,
  AudioStep,
  BellLogInput,
  ScheduleSnapshot,
  ShutdownAction,
  ShutdownState
} from '@jadwal-adb/shared';

export interface DesktopConfig {
  serverUrl: string;
  deviceToken: string;
  deviceName: string;
  audioDir: string;
  audioOutputDeviceId: string;
  masterVolume: number;
  autoLaunch: boolean;
  keepAwake: boolean;
  useServerTimeOffset: boolean;
  dryRunShutdown: boolean;
}

export interface DesktopUIState {
  config: DesktopConfig;
  appVersion: string;
  platform: string;
  connectedToServer: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  clockOffsetMs: number;
  snapshot: ScheduleSnapshot | null;
  hasLocalUnsyncedChanges: boolean;
  localBaseVersion: number | null;
  localModifiedAt: string | null;
  conflictingServerSnapshot: ScheduleSnapshot | null;
  audioFiles: AudioFileEntry[];
  pendingLogCount: number;
  recentLogs: BellLogInput[];
  isPlaying: boolean;
  currentPlayingLabel: string | null;
  shutdownState: ShutdownState;
  shutdownAction: ShutdownAction | null;
  shutdownRemainingSec: number | null;
  shutdownReason: string | null;
}

export interface AudioPlayJob {
  jobId: string;
  triggerType: 'scheduled' | 'manual';
  profileName: string | null;
  slotLabel: string;
  scheduledTime: string | null;
  actorName: string | null;
  steps: AudioStep[];
}

export interface AudioPlayResult {
  jobId: string;
  triggerType: 'scheduled' | 'manual';
  status: 'played' | 'partial' | 'missing_file' | 'failed' | 'stopped';
  profileName: string | null;
  slotLabel: string;
  scheduledTime: string | null;
  files: string[];
  actorName: string | null;
  detail: string | null;
}
