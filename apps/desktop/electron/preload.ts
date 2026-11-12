import { contextBridge, ipcRenderer } from 'electron';
import type {
  AudioStep,
  LiveMicChunkPayload,
  LiveMicStartPayload,
  LiveMicStopPayload,
  ScheduleSnapshot,
  ShutdownAction
} from '@jadwal-adb/shared';
import type {
  AudioPlayJob,
  AudioPlayResult,
  DesktopConfig,
  DesktopUIState
} from './types.js';

export interface SnapshotSaveResult {
  state: DesktopUIState;
  synced: boolean;
  conflict: boolean;
  message: string;
}

export interface PinActionResult {
  ok: boolean;
  error?: string;
  state: DesktopUIState;
}

export interface DesktopBridge {
  getState: () => Promise<DesktopUIState>;
  unlock: (pin: string) => Promise<PinActionResult>;
  lockNow: () => Promise<DesktopUIState>;
  changeLockPin: (currentPin: string, newPin: string) => Promise<PinActionResult>;
  touchActivity: () => void;
  saveConfig: (patch: Partial<DesktopConfig>) => Promise<DesktopUIState>;
  pickAudioDir: () => Promise<string | null>;
  openAudioDir: () => Promise<void>;
  rescanAudio: () => Promise<DesktopUIState>;
  syncNow: () => Promise<DesktopUIState>;
  initLocalSnapshot: () => Promise<DesktopUIState>;
  saveLocalSnapshot: (snapshot: ScheduleSnapshot) => Promise<SnapshotSaveResult>;
  pushLocalSnapshot: (force: boolean) => Promise<SnapshotSaveResult>;
  acceptServerSnapshot: () => Promise<DesktopUIState>;
  playTestSteps: (label: string, steps: AudioStep[]) => Promise<void>;
  stopAudio: () => Promise<void>;
  reportAudioStarted: (jobId: string, label: string) => void;
  reportAudioFinished: (result: AudioPlayResult) => void;
  triggerShutdownDemo: (action: ShutdownAction, graceSeconds: number, reason: string) => Promise<void>;
  cancelShutdown: () => Promise<void>;
  onStateUpdated: (cb: (state: DesktopUIState) => void) => () => void;
  onPlayAudioJob: (cb: (job: AudioPlayJob) => void) => () => void;
  onStopAudioCommand: (cb: () => void) => () => void;
  onPlayChime: (cb: () => void) => () => void;
  onLiveMicStart: (cb: (payload: LiveMicStartPayload) => void) => () => void;
  onLiveMicChunk: (cb: (payload: LiveMicChunkPayload) => void) => () => void;
  onLiveMicStop: (cb: (payload: LiveMicStopPayload) => void) => () => void;
}

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  unlock: (pin) => ipcRenderer.invoke('desktop:unlock', pin),
  lockNow: () => ipcRenderer.invoke('desktop:lock-now'),
  changeLockPin: (currentPin, newPin) =>
    ipcRenderer.invoke('desktop:change-lock-pin', { currentPin, newPin }),
  touchActivity: () => ipcRenderer.send('desktop:touch-activity'),
  saveConfig: (patch) => ipcRenderer.invoke('desktop:save-config', patch),
  pickAudioDir: () => ipcRenderer.invoke('desktop:pick-audio-dir'),
  openAudioDir: () => ipcRenderer.invoke('desktop:open-audio-dir'),
  rescanAudio: () => ipcRenderer.invoke('desktop:rescan-audio'),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  initLocalSnapshot: () => ipcRenderer.invoke('desktop:init-local-snapshot'),
  saveLocalSnapshot: (snapshot) => ipcRenderer.invoke('desktop:save-local-snapshot', snapshot),
  pushLocalSnapshot: (force) => ipcRenderer.invoke('desktop:push-local-snapshot', force),
  acceptServerSnapshot: () => ipcRenderer.invoke('desktop:accept-server-snapshot'),
  playTestSteps: (label, steps) => ipcRenderer.invoke('desktop:play-test', { label, steps }),
  stopAudio: () => ipcRenderer.invoke('desktop:stop-audio'),
  reportAudioStarted: (jobId, label) => ipcRenderer.send('audio:started', { jobId, label }),
  reportAudioFinished: (result) => ipcRenderer.send('audio:finished', result),
  triggerShutdownDemo: (action, graceSeconds, reason) =>
    ipcRenderer.invoke('desktop:trigger-shutdown', { action, graceSeconds, reason }),
  cancelShutdown: () => ipcRenderer.invoke('desktop:cancel-shutdown'),
  onStateUpdated: (cb) => {
    const listener = (_: unknown, state: DesktopUIState) => cb(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  },
  onPlayAudioJob: (cb) => {
    const listener = (_: unknown, job: AudioPlayJob) => cb(job);
    ipcRenderer.on('audio:play', listener);
    return () => ipcRenderer.removeListener('audio:play', listener);
  },
  onStopAudioCommand: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('audio:stop', listener);
    return () => ipcRenderer.removeListener('audio:stop', listener);
  },
  onPlayChime: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('audio:play-chime', listener);
    return () => ipcRenderer.removeListener('audio:play-chime', listener);
  },
  onLiveMicStart: (cb) => {
    const listener = (_: unknown, payload: LiveMicStartPayload) => cb(payload);
    ipcRenderer.on('live:start', listener);
    return () => ipcRenderer.removeListener('live:start', listener);
  },
  onLiveMicChunk: (cb) => {
    const listener = (_: unknown, payload: LiveMicChunkPayload) => cb(payload);
    ipcRenderer.on('live:chunk', listener);
    return () => ipcRenderer.removeListener('live:chunk', listener);
  },
  onLiveMicStop: (cb) => {
    const listener = (_: unknown, payload: LiveMicStopPayload) => cb(payload);
    ipcRenderer.on('live:stop', listener);
    return () => ipcRenderer.removeListener('live:stop', listener);
  }
};

contextBridge.exposeInMainWorld('desktopApi', bridge);
