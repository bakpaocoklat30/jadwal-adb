import { contextBridge, ipcRenderer } from 'electron';
import type { AudioStep, ShutdownAction } from '@jadwal-adb/shared';
import type {
  AudioPlayJob,
  AudioPlayResult,
  DesktopConfig,
  DesktopUIState
} from './types.js';

export interface DesktopBridge {
  getState: () => Promise<DesktopUIState>;
  saveConfig: (patch: Partial<DesktopConfig>) => Promise<DesktopUIState>;
  pickAudioDir: () => Promise<string | null>;
  openAudioDir: () => Promise<void>;
  rescanAudio: () => Promise<DesktopUIState>;
  syncNow: () => Promise<DesktopUIState>;
  playTestSteps: (label: string, steps: AudioStep[]) => Promise<void>;
  stopAudio: () => Promise<void>;
  reportAudioStarted: (jobId: string, label: string) => void;
  reportAudioFinished: (result: AudioPlayResult) => void;
  triggerShutdownDemo: (action: ShutdownAction, graceSeconds: number, reason: string) => Promise<void>;
  cancelShutdown: () => Promise<void>;
  onStateUpdated: (cb: (state: DesktopUIState) => void) => () => void;
  onPlayAudioJob: (cb: (job: AudioPlayJob) => void) => () => void;
  onStopAudioCommand: (cb: () => void) => () => void;
}

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  saveConfig: (patch) => ipcRenderer.invoke('desktop:save-config', patch),
  pickAudioDir: () => ipcRenderer.invoke('desktop:pick-audio-dir'),
  openAudioDir: () => ipcRenderer.invoke('desktop:open-audio-dir'),
  rescanAudio: () => ipcRenderer.invoke('desktop:rescan-audio'),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
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
  }
};

contextBridge.exposeInMainWorld('desktopApi', bridge);
