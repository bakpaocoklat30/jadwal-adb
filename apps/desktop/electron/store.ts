import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeShutdownSettings,
  type BellLogInput,
  type ScheduleSnapshot
} from '@jadwal-adb/shared';
import type { DesktopConfig } from './types.js';

interface PersistedRuntimeState {
  playedKeys: string[];
  shutdownTriggeredDates: string[];
  pendingLogs: BellLogInput[];
  recentLogs: BellLogInput[];
  hasLocalUnsyncedChanges: boolean;
  localBaseVersion: number | null;
  localModifiedAt: string | null;
  lockPinHash: string;
  lockPinIsDefault: boolean;
}

export function hashLockPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyLockPinHash(pin: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(pin, salt, 64);
  const expected = Buffer.from(keyHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
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
      dryRunShutdown: process.platform !== 'win32',
      lockEnabled: true,
      lockOnHide: true,
      lockTimeoutMinutes: 5
    };

    const loadedConfig = readJsonSafe<Partial<DesktopConfig>>(this.configPath);
    this.config = { ...defaultConfig, ...(loadedConfig ?? {}) };
    if (!loadedConfig) {
      writeJsonAtomic(this.configPath, this.config);
    }

    fs.mkdirSync(this.config.audioDir, { recursive: true });

    const loadedSnap = readJsonSafe<ScheduleSnapshot>(this.snapshotPath);
    this.snapshot = loadedSnap
      ? { ...loadedSnap, shutdownSettings: normalizeShutdownSettings(loadedSnap.shutdownSettings) }
      : null;
    const loadedState = readJsonSafe<Partial<PersistedRuntimeState>>(this.statePath);
    const hasPin = typeof loadedState?.lockPinHash === 'string' && loadedState.lockPinHash.includes(':');
    this.state = {
      playedKeys: loadedState?.playedKeys ?? [],
      shutdownTriggeredDates: loadedState?.shutdownTriggeredDates ?? [],
      pendingLogs: loadedState?.pendingLogs ?? [],
      recentLogs: loadedState?.recentLogs ?? [],
      hasLocalUnsyncedChanges: loadedState?.hasLocalUnsyncedChanges ?? false,
      localBaseVersion: loadedState?.localBaseVersion ?? null,
      localModifiedAt: loadedState?.localModifiedAt ?? null,
      lockPinHash: hasPin ? loadedState!.lockPinHash! : hashLockPin('123456'),
      lockPinIsDefault: hasPin ? (loadedState?.lockPinIsDefault ?? false) : true
    };
    if (!hasPin) {
      this.saveState();
    }
  }

  public verifyLockPin(pin: string): boolean {
    return verifyLockPinHash(pin, this.state.lockPinHash);
  }

  public setLockPin(newPin: string): void {
    this.state.lockPinHash = hashLockPin(newPin);
    this.state.lockPinIsDefault = false;
    this.saveState();
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
    const normalized = {
      ...snapshot,
      shutdownSettings: normalizeShutdownSettings(snapshot.shutdownSettings)
    };
    if (fs.existsSync(this.snapshotPath)) {
      try {
        fs.copyFileSync(this.snapshotPath, `${this.snapshotPath}.bak`);
      } catch {
        // Best-effort local backup
      }
    }
    this.snapshot = normalized;
    writeJsonAtomic(this.snapshotPath, normalized);
  }

  public saveLocalModifiedSnapshot(snapshot: ScheduleSnapshot): void {
    if (!this.state.hasLocalUnsyncedChanges) {
      this.state.localBaseVersion = this.snapshot?.version ?? snapshot.version;
    }
    const normalized = {
      ...snapshot,
      shutdownSettings: normalizeShutdownSettings(snapshot.shutdownSettings)
    };
    if (fs.existsSync(this.snapshotPath)) {
      try {
        fs.copyFileSync(this.snapshotPath, `${this.snapshotPath}.bak`);
      } catch {
        // Best-effort local backup
      }
    }
    this.state.hasLocalUnsyncedChanges = true;
    this.state.localModifiedAt = new Date().toISOString();
    this.snapshot = normalized;
    writeJsonAtomic(this.snapshotPath, normalized);
    this.saveState();
  }

  public markSnapshotSynced(serverSnapshot: ScheduleSnapshot): void {
    const normalized = {
      ...serverSnapshot,
      shutdownSettings: normalizeShutdownSettings(serverSnapshot.shutdownSettings)
    };
    this.snapshot = normalized;
    writeJsonAtomic(this.snapshotPath, normalized);
    this.state.hasLocalUnsyncedChanges = false;
    this.state.localBaseVersion = normalized.version;
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
