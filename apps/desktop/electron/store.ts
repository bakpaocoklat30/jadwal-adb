import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BellLogInput, ScheduleSnapshot } from '@jadwal-adb/shared';
import type { DesktopConfig } from './types.js';

interface PersistedRuntimeState {
  playedKeys: string[];
  shutdownTriggeredDates: string[];
  pendingLogs: BellLogInput[];
  recentLogs: BellLogInput[];
  hasLocalUnsyncedChanges: boolean;
  localBaseVersion: number | null;
  localModifiedAt: string | null;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export class DesktopStore {
  private readonly configPath: string;
  private readonly snapshotPath: string;
  private readonly statePath: string;

  public config: DesktopConfig;
  public snapshot: ScheduleSnapshot | null;
  public state: PersistedRuntimeState;

  constructor(userDataDir: string, defaultAudioDir: string) {
    this.configPath = path.join(userDataDir, 'config.json');
    this.snapshotPath = path.join(userDataDir, 'snapshot.json');
    this.statePath = path.join(userDataDir, 'state.json');

    const defaultConfig: DesktopConfig = {
      serverUrl: 'http://localhost:4000',
      deviceToken: '',
      deviceName: os.hostname() || 'PC-Bel-SMKN1-Adiwerna',
      audioDir: defaultAudioDir,
      audioOutputDeviceId: '',
      masterVolume: 100,
      autoLaunch: true,
      keepAwake: true,
      useServerTimeOffset: true,
      dryRunShutdown: process.platform !== 'win32'
    };

    const loadedConfig = readJsonSafe<Partial<DesktopConfig>>(this.configPath);
    this.config = { ...defaultConfig, ...(loadedConfig ?? {}) };
    if (!loadedConfig) {
      writeJsonAtomic(this.configPath, this.config);
    }

    fs.mkdirSync(this.config.audioDir, { recursive: true });

    this.snapshot = readJsonSafe<ScheduleSnapshot>(this.snapshotPath);
    const loadedState = readJsonSafe<Partial<PersistedRuntimeState>>(this.statePath);
    this.state = {
      playedKeys: loadedState?.playedKeys ?? [],
      shutdownTriggeredDates: loadedState?.shutdownTriggeredDates ?? [],
      pendingLogs: loadedState?.pendingLogs ?? [],
      recentLogs: loadedState?.recentLogs ?? [],
      hasLocalUnsyncedChanges: loadedState?.hasLocalUnsyncedChanges ?? false,
      localBaseVersion: loadedState?.localBaseVersion ?? null,
      localModifiedAt: loadedState?.localModifiedAt ?? null
    };
  }

  public updateConfig(patch: Partial<DesktopConfig>): DesktopConfig {
    this.config = { ...this.config, ...patch };
    if (this.config.audioDir) {
      fs.mkdirSync(this.config.audioDir, { recursive: true });
    }
    writeJsonAtomic(this.configPath, this.config);
    return this.config;
  }

  public saveSnapshot(snapshot: ScheduleSnapshot): void {
    this.snapshot = snapshot;
    writeJsonAtomic(this.snapshotPath, snapshot);
  }

  public saveLocalModifiedSnapshot(snapshot: ScheduleSnapshot): void {
    if (!this.state.hasLocalUnsyncedChanges) {
      this.state.localBaseVersion = this.snapshot?.version ?? snapshot.version;
    }
    this.state.hasLocalUnsyncedChanges = true;
    this.state.localModifiedAt = new Date().toISOString();
    this.snapshot = snapshot;
    writeJsonAtomic(this.snapshotPath, snapshot);
    this.saveState();
  }

  public markSnapshotSynced(serverSnapshot: ScheduleSnapshot): void {
    this.snapshot = serverSnapshot;
    writeJsonAtomic(this.snapshotPath, serverSnapshot);
    this.state.hasLocalUnsyncedChanges = false;
    this.state.localBaseVersion = serverSnapshot.version;
    this.state.localModifiedAt = null;
    this.saveState();
  }

  public markPlayed(key: string, currentDateStr: string): void {
    if (!this.state.playedKeys.includes(key)) {
      this.state.playedKeys.push(key);
    }
    // Keep only current date keys to prevent unbounded growth
    this.state.playedKeys = this.state.playedKeys
      .filter((k) => k.startsWith(`${currentDateStr}|`))
      .slice(-200);
    this.saveState();
  }

  public hasPlayed(key: string): boolean {
    return this.state.playedKeys.includes(key);
  }

  public markShutdownTriggered(dateStr: string): void {
    if (!this.state.shutdownTriggeredDates.includes(dateStr)) {
      this.state.shutdownTriggeredDates.push(dateStr);
    }
    this.state.shutdownTriggeredDates = this.state.shutdownTriggeredDates.slice(-14);
    this.saveState();
  }

  public hasShutdownTriggered(dateStr: string): boolean {
    return this.state.shutdownTriggeredDates.includes(dateStr);
  }

  public enqueueLog(log: BellLogInput): void {
    const withId: BellLogInput = {
      ...log,
      id: log.id || crypto.randomUUID()
    };
    this.state.pendingLogs.push(withId);
    this.state.pendingLogs = this.state.pendingLogs.slice(-500);

    this.state.recentLogs.unshift(withId);
    this.state.recentLogs = this.state.recentLogs.slice(0, 50);
    this.saveState();
  }

  public removePendingLogs(count: number): void {
    this.state.pendingLogs = this.state.pendingLogs.slice(count);
    this.saveState();
  }

  private saveState(): void {
    writeJsonAtomic(this.statePath, this.state);
  }
}
