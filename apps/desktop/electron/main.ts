import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  protocol,
  shell,
  Tray
} from 'electron';
import { io, type Socket } from 'socket.io-client';
import {
  findDueSlots,
  getZonedDateParts,
  resolveDaySchedule,
  shouldTriggerAutoShutdown,
  sortSlots,
  type AudioFileEntry,
  type AudioStep,
  type BellLogInput,
  type RemoteCommand,
  type ScheduleSnapshot,
  type ServerAudioFile,
  type ShutdownAction,
  type ShutdownState
} from '@jadwal-adb/shared';
import { DesktopStore } from './store.js';
import type { AudioPlayJob, AudioPlayResult, DesktopConfig, DesktopUIState } from './types.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bell-audio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac']);
const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac'
};

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let store: DesktopStore;
let socket: Socket | null = null;
let audioWatcher: fs.FSWatcher | null = null;
let powerSaveId: number | null = null;

// Live runtime state
let connectedToServer = false;
let lastError: string | null = null;
let lastSyncAt: string | null = null;
let clockOffsetMs = 0;
let conflictingServerSnapshot: ScheduleSnapshot | null = null;
let audioFiles: AudioFileEntry[] = [];
let isPlaying = false;
let currentPlayingLabel: string | null = null;
let activeJobId: string | null = null;

let shutdownState: ShutdownState = 'idle';
let shutdownAction: ShutdownAction | null = null;
let shutdownRemainingSec: number | null = null;
let shutdownReason: string | null = null;
let shutdownActor: string | null = null;
let shutdownTimer: NodeJS.Timeout | null = null;
let waitingAudioTimer: NodeJS.Timeout | null = null;

function buildUIState(): DesktopUIState {
  return {
    config: store.config,
    appVersion: app.getVersion(),
    platform: process.platform,
    connectedToServer,
    lastError,
    lastSyncAt,
    clockOffsetMs,
    snapshot: store.snapshot,
    hasLocalUnsyncedChanges: store.state.hasLocalUnsyncedChanges,
    localBaseVersion: store.state.localBaseVersion,
    localModifiedAt: store.state.localModifiedAt,
    conflictingServerSnapshot,
    audioFiles,
    pendingLogCount: store.state.pendingLogs.length,
    recentLogs: store.state.recentLogs,
    isPlaying,
    currentPlayingLabel,
    shutdownState,
    shutdownAction,
    shutdownRemainingSec,
    shutdownReason
  };
}

function emitUIState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:state', buildUIState());
  }
}

function scanAudioDirectory(dir: string): AudioFileEntry[] {
  const results: AudioFileEntry[] = [];
  if (!dir || !fs.existsSync(dir)) return results;

  const walk = (currentDir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            const rel = path.relative(dir, fullPath).split(path.sep).join('/');
            results.push({
              fileName: entry.name,
              relativePath: rel,
              sizeBytes: stat.size,
              updatedAt: stat.mtime.toISOString()
            });
          } catch {
            // Skip unreadable file
          }
        }
      }
    }
  };

  walk(dir, 0);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

function refreshAudioFiles(): void {
  audioFiles = scanAudioDirectory(store.config.audioDir);
  if (socket && socket.connected) {
    socket.emit('device:audio_manifest', {
      audioDir: store.config.audioDir,
      files: audioFiles
    });
  } else {
    void postAudioManifestRest();
  }
  emitUIState();
}

function setupAudioWatcher(): void {
  if (audioWatcher) {
    audioWatcher.close();
    audioWatcher = null;
  }
  if (!store.config.audioDir || !fs.existsSync(store.config.audioDir)) return;

  let debounce: NodeJS.Timeout | null = null;
  try {
    audioWatcher = fs.watch(store.config.audioDir, { recursive: process.platform !== 'linux' }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        refreshAudioFiles();
      }, 600);
    });
  } catch {
    // Fallback periodic scan already runs every 30s
  }
}

function updatePowerSaveBlocker(): void {
  if (store.config.keepAwake) {
    if (powerSaveId === null || !powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } else if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
  }
}

function updateAutoLaunch(): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: store.config.autoLaunch
    });
  } catch {
    // Ignore on unsupported dev environments
  }
}

function buildHeartbeatPayload() {
  return {
    deviceName: store.config.deviceName,
    platform: process.platform,
    appVersion: app.getVersion(),
    audioDir: store.config.audioDir,
    audioCount: audioFiles.length,
    activeScheduleVersion: store.snapshot?.version ?? 0,
    clientNowMs: Date.now(),
    isPlaying,
    currentPlayingLabel,
    shutdownState,
    shutdownAction,
    shutdownRemainingSec,
    shutdownReason
  };
}

async function fetchJson<T>(urlPath: string, init: RequestInit = {}): Promise<T> {
  const base = store.config.serverUrl.replace(/\/+$/, '');
  const headers = new Headers(init.headers);
  headers.set('x-device-token', store.config.deviceToken);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${base}${urlPath}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function downloadServerAudioFile(fileName: string, targetPath: string): Promise<void> {
  const base = store.config.serverUrl.replace(/\/+$/, '');
  const res = await fetch(
    `${base}/api/device/server-audio/${encodeURIComponent(path.basename(fileName))}`,
    {
      headers: { 'x-device-token': store.config.deviceToken }
    }
  );
  if (!res.ok) {
    throw new Error(`Gagal mengunduh audio ${fileName}: HTTP ${res.status}`);
  }
  const arrayBuf = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, Buffer.from(arrayBuf));
  fs.renameSync(tmpPath, targetPath);
}

let syncingServerAudio = false;
async function syncServerAudioFiles(serverFiles?: ServerAudioFile[]): Promise<void> {
  if (!store.config.serverUrl || !store.config.deviceToken || !store.config.audioDir) return;
  if (syncingServerAudio) return;
  syncingServerAudio = true;

  try {
    const list =
      serverFiles ??
      (await fetchJson<{ files: ServerAudioFile[] }>('/api/device/server-audio')).files;

    const webDir = path.join(store.config.audioDir, '_web');
    fs.mkdirSync(webDir, { recursive: true });

    let changed = false;
    const expectedNames = new Set(list.map((f) => path.basename(f.fileName)));

    for (const entry of list) {
      const safeName = path.basename(entry.fileName);
      const localPath = path.join(webDir, safeName);
      const needsDownload = !fs.existsSync(localPath) || sha256File(localPath) !== entry.sha256;
      if (needsDownload) {
        await downloadServerAudioFile(safeName, localPath);
        changed = true;
      }
    }

    for (const existing of fs.readdirSync(webDir)) {
      if (existing.endsWith('.tmp')) continue;
      if (!expectedNames.has(existing)) {
        fs.unlinkSync(path.join(webDir, existing));
        changed = true;
      }
    }

    if (changed) {
      refreshAudioFiles();
    }
  } catch {
    // Keep offline copy intact if server is unreachable
  } finally {
    syncingServerAudio = false;
  }
}

async function postAudioManifestRest(): Promise<void> {
  if (!store.config.serverUrl || !store.config.deviceToken) return;
  try {
    await fetchJson('/api/device/audio-manifest', {
      method: 'POST',
      body: JSON.stringify({
        audioDir: store.config.audioDir,
        files: audioFiles
      })
    });
  } catch {
    // Will sync when server returns
  }
}

async function flushPendingLogs(): Promise<void> {
  if (store.state.pendingLogs.length === 0) return;
  const batch = [...store.state.pendingLogs];

  if (socket && socket.connected) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 2000);
      socket!.emit('device:logs_batch', batch, () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          store.removePendingLogs(batch.length);
          emitUIState();
          resolve();
        }
      });
    });
    return;
  }

  if (store.config.serverUrl && store.config.deviceToken) {
    try {
      await fetchJson('/api/device/logs', {
        method: 'POST',
        body: JSON.stringify(batch)
      });
      store.removePendingLogs(batch.length);
      emitUIState();
    } catch {
      // Keep queued offline
    }
  }
}

async function pushLocalSnapshotToServer(force = false): Promise<{
  synced: boolean;
  conflict: boolean;
  message: string;
}> {
  if (!store.snapshot) {
    return { synced: false, conflict: false, message: 'Belum ada jadwal lokal.' };
  }
  if (!store.config.serverUrl || !store.config.deviceToken) {
    return {
      synced: false,
      conflict: false,
      message: 'Tersimpan lokal (Server VPS belum dikonfigurasi).'
    };
  }

  const base = store.config.serverUrl.replace(/\/+$/, '');
  const baseVersion = store.state.localBaseVersion ?? store.snapshot.version;

  try {
    const res = await fetch(`${base}/api/device/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-token': store.config.deviceToken
      },
      body: JSON.stringify({
        baseVersion,
        force,
        profiles: store.snapshot.profiles,
        weeklyRules: store.snapshot.weeklyRules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          profileId: r.profileId
        })),
        dateOverrides: store.snapshot.dateOverrides,
        shutdownSettings: {
          enabled: store.snapshot.shutdownSettings.enabled,
          time: store.snapshot.shutdownSettings.time,
          daysOfWeek: store.snapshot.shutdownSettings.daysOfWeek,
          graceSeconds: store.snapshot.shutdownSettings.graceSeconds
        }
      })
    });

    const data = (await res.json()) as {
      snapshot?: ScheduleSnapshot;
      serverSnapshot?: ScheduleSnapshot;
      serverNowMs?: number;
      error?: string;
    };

    if (res.status === 409 && data.serverSnapshot) {
      conflictingServerSnapshot = data.serverSnapshot;
      emitUIState();
      return {
        synced: false,
        conflict: true,
        message: data.error || 'Konflik: jadwal di server telah diubah oleh admin lain.'
      };
    }

    if (!res.ok || !data.snapshot) {
      return {
        synced: false,
        conflict: false,
        message: data.error || `Gagal sinkron ke server (HTTP ${res.status})`
      };
    }

    if (data.serverNowMs) {
      clockOffsetMs = data.serverNowMs - Date.now();
    }
    conflictingServerSnapshot = null;
    store.markSnapshotSynced(data.snapshot);
    lastSyncAt = new Date().toISOString();
    lastError = null;
    emitUIState();
    sendHeartbeat();
    return {
      synced: true,
      conflict: false,
      message: `Jadwal tersimpan & tersinkron ke server (v${data.snapshot.version}).`
    };
  } catch {
    return {
      synced: false,
      conflict: false,
      message: 'Tersimpan lokal (Offline). Akan disinkronkan saat koneksi server pulih.'
    };
  }
}

function applyIncomingServerSnapshot(serverSnap: ScheduleSnapshot): void {
  if (!store.state.hasLocalUnsyncedChanges) {
    conflictingServerSnapshot = null;
    store.markSnapshotSynced(serverSnap);
    lastSyncAt = new Date().toISOString();
    lastError = null;
    emitUIState();
    sendHeartbeat();
    return;
  }

  const baseVer = store.state.localBaseVersion ?? store.snapshot?.version ?? 0;
  if (serverSnap.version === baseVer) {
    // Server did not change while offline: safely push our offline edits
    void pushLocalSnapshotToServer(false);
    return;
  }

  // Both server and local PC changed while offline -> ask operator via UI banner
  conflictingServerSnapshot = serverSnap;
  emitUIState();
}

function createStarterSnapshot(): ScheduleSnapshot {
  const now = new Date().toISOString();
  const profileId = crypto.randomUUID();
  return {
    version: 0,
    schoolName: 'SMK Negeri 1 Adiwerna',
    timeZone: 'Asia/Jakarta',
    profiles: [
      {
        id: profileId,
        name: 'Jadwal Reguler (Lokal)',
        description: 'Dibuat secara lokal di PC Bel',
        color: '#2563eb',
        slots: [],
        createdAt: now,
        updatedAt: now
      }
    ],
    weeklyRules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      profileId: dayOfWeek >= 1 && dayOfWeek <= 5 ? profileId : null,
      updatedAt: now
    })),
    dateOverrides: [],
    shutdownSettings: {
      enabled: false,
      time: '16:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      graceSeconds: 20,
      updatedAt: now
    },
    generatedAt: now
  };
}

async function syncWithServerRest(): Promise<void> {
  if (!store.config.serverUrl || !store.config.deviceToken) return;
  try {
    const reqStarted = Date.now();
    const res = await fetchJson<{ snapshot: ScheduleSnapshot; serverNowMs: number }>(
      '/api/device/sync'
    );
    const rtt = Date.now() - reqStarted;
    clockOffsetMs = res.serverNowMs + Math.round(rtt / 2) - Date.now();
    applyIncomingServerSnapshot(res.snapshot);
    await flushPendingLogs();
    await syncServerAudioFiles();
    await postAudioManifestRest();
    emitUIState();
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'Gagal sinkronisasi dengan server';
    emitUIState();
  }
}

function sendHeartbeat(): void {
  if (socket && socket.connected) {
    const sentAt = Date.now();
    socket.emit('device:heartbeat', buildHeartbeatPayload(), (ack?: { serverNowMs?: number }) => {
      if (ack?.serverNowMs) {
        const rtt = Date.now() - sentAt;
        clockOffsetMs = ack.serverNowMs + Math.round(rtt / 2) - Date.now();
      }
    });
  }
}

function recordAndFlushLog(log: BellLogInput): void {
  store.enqueueLog(log);
  emitUIState();
  void flushPendingLogs();
}

async function dispatchPlayJob(job: Omit<AudioPlayJob, 'jobId'>): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const fullJob: AudioPlayJob = {
    ...job,
    jobId: crypto.randomUUID()
  };
  activeJobId = fullJob.jobId;
  isPlaying = true;
  currentPlayingLabel = fullJob.slotLabel;
  emitUIState();
  sendHeartbeat();

  // Ensure any web-uploaded (_web/...) files are downloaded locally before playing
  for (const step of job.steps) {
    if (activeJobId !== fullJob.jobId) return;
    if (step.fileName.startsWith('_web/') && store.config.serverUrl && store.config.deviceToken) {
      const safeName = path.basename(step.fileName);
      const localPath = path.join(store.config.audioDir, '_web', safeName);
      if (!fs.existsSync(localPath)) {
        try {
          await downloadServerAudioFile(safeName, localPath);
          refreshAudioFiles();
        } catch {
          // Let renderer report missing_file if offline
        }
      }
    }
  }

  if (activeJobId !== fullJob.jobId || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('audio:play', fullJob);
}

function stopPlayback(): void {
  activeJobId = null;
  isPlaying = false;
  currentPlayingLabel = null;
  emitUIState();
  sendHeartbeat();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio:stop');
  }
}

function clearShutdownTimers(): void {
  if (shutdownTimer) {
    clearInterval(shutdownTimer);
    shutdownTimer = null;
  }
  if (waitingAudioTimer) {
    clearInterval(waitingAudioTimer);
    waitingAudioTimer = null;
  }
}

function resetShutdownState(): void {
  clearShutdownTimers();
  shutdownState = 'idle';
  shutdownAction = null;
  shutdownRemainingSec = null;
  shutdownReason = null;
  shutdownActor = null;
  emitUIState();
  sendHeartbeat();
}

function cancelPendingShutdown(cancelledBy: string): void {
  if (shutdownState === 'idle') return;
  const prevAction = shutdownAction;
  resetShutdownState();
  recordAndFlushLog({
    occurredAt: new Date().toISOString(),
    triggerType: 'system',
    status: 'shutdown_cancelled',
    profileName: null,
    slotLabel: `${prevAction === 'restart' ? 'Restart' : 'Shutdown'} PC Dibatalkan`,
    scheduledTime: null,
    files: [],
    actorName: cancelledBy,
    detail: `Dibatalkan oleh ${cancelledBy}`
  });
}

async function executeOsShutdown(action: ShutdownAction, reason: string, actor: string | null): Promise<void> {
  clearShutdownTimers();
  shutdownState = 'shutting_down';
  shutdownRemainingSec = 0;
  emitUIState();

  recordAndFlushLog({
    occurredAt: new Date().toISOString(),
    triggerType: 'system',
    status: 'shutdown_triggered',
    profileName: null,
    slotLabel: action === 'restart' ? 'Restart PC Bel' : 'Shutdown PC Bel',
    scheduledTime: null,
    files: [],
    actorName: actor,
    detail: reason
  });

  if (socket && socket.connected) {
    socket.emit('device:graceful_shutdown', { reason });
  }
  await flushPendingLogs();
  await new Promise((r) => setTimeout(r, 500));

  if (process.platform === 'win32' && !store.config.dryRunShutdown) {
    const flag = action === 'restart' ? '/r' : '/s';
    execFile('shutdown', [flag, '/t', '3', '/f', '/c', `Bel Sekolah ADB: ${reason}`]);
    return;
  }

  // Safe simulation when running on macOS / dry-run mode
  lastError = `Simulasi ${action.toUpperCase()} berhasil dijalankan (${reason}). Pada PC Windows mode produksi, komputer akan mati otomatis.`;
  resetShutdownState();
}

function initiateShutdown(
  action: ShutdownAction,
  graceSeconds: number,
  reason: string,
  actorName: string | null
): void {
  if (shutdownState !== 'idle') return;

  shutdownState = 'pending';
  shutdownAction = action;
  shutdownRemainingSec = graceSeconds;
  shutdownReason = reason;
  shutdownActor = actorName;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  emitUIState();
  sendHeartbeat();

  const startCountdown = () => {
    shutdownTimer = setInterval(() => {
      if (shutdownState !== 'pending') {
        clearShutdownTimers();
        return;
      }
      const next = (shutdownRemainingSec ?? 1) - 1;
      shutdownRemainingSec = Math.max(0, next);
      emitUIState();
      sendHeartbeat();

      if (shutdownRemainingSec <= 0) {
        void executeOsShutdown(action, reason, shutdownActor);
      }
    }, 1000);
  };

  if (isPlaying) {
    let waited = 0;
    waitingAudioTimer = setInterval(() => {
      waited += 1;
      if (!isPlaying || waited >= 120) {
        if (waitingAudioTimer) {
          clearInterval(waitingAudioTimer);
          waitingAudioTimer = null;
        }
        startCountdown();
      }
    }, 1000);
  } else {
    startCountdown();
  }
}

function handleRemoteCommand(cmd: RemoteCommand): void {
  switch (cmd.type) {
    case 'play_manual':
      void dispatchPlayJob({
        triggerType: 'manual',
        profileName: null,
        slotLabel: cmd.label,
        scheduledTime: null,
        actorName: cmd.requestedBy,
        steps: cmd.steps
      });
      break;
    case 'stop_audio':
      stopPlayback();
      break;
    case 'sync_now':
      void syncWithServerRest();
      refreshAudioFiles();
      break;
    case 'shutdown_pc':
      initiateShutdown(cmd.action, cmd.graceSeconds, cmd.reason, cmd.requestedBy);
      break;
    case 'cancel_shutdown':
      cancelPendingShutdown(cmd.requestedBy);
      break;
  }
}

function connectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  if (!store.config.serverUrl || !store.config.deviceToken) {
    connectedToServer = false;
    lastError = 'Masukkan URL Server dan Device Token di Pengaturan untuk menyambungkan ke VPS.';
    emitUIState();
    return;
  }

  const base = store.config.serverUrl.replace(/\/+$/, '');
  socket = io(base, {
    auth: {
      kind: 'device',
      deviceToken: store.config.deviceToken
    },
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 15000
  });

  socket.on('connect', () => {
    connectedToServer = true;
    lastError = null;
    refreshAudioFiles();
    sendHeartbeat();
    void flushPendingLogs();
    emitUIState();
  });

  socket.on('disconnect', () => {
    connectedToServer = false;
    emitUIState();
  });

  socket.on('connect_error', (err) => {
    connectedToServer = false;
    lastError = `Koneksi server gagal: ${err.message}`;
    emitUIState();
  });

  socket.on(
    'schedule:updated',
    (payload: { snapshot: ScheduleSnapshot; serverNowMs: number }) => {
      clockOffsetMs = payload.serverNowMs - Date.now();
      applyIncomingServerSnapshot(payload.snapshot);
    }
  );

  socket.on('device:command', (cmd: RemoteCommand) => {
    handleRemoteCommand(cmd);
  });

  socket.on('server_audio:updated', (files: ServerAudioFile[]) => {
    void syncServerAudioFiles(files);
  });
}

function runSchedulerTick(): void {
  const snapshot = store.snapshot;
  if (!snapshot) return;

  const effectiveNow = Date.now() + (store.config.useServerTimeOffset ? clockOffsetMs : 0);
  const parts = getZonedDateParts(effectiveNow, snapshot.timeZone);
  const resolved = resolveDaySchedule(snapshot, parts.dateStr, parts.dayOfWeek);
  const dueSlots = findDueSlots(resolved, parts.timeStr);

  for (const slot of dueSlots) {
    const key = `${parts.dateStr}|${slot.id}|${slot.time}`;
    if (!store.hasPlayed(key)) {
      store.markPlayed(key, parts.dateStr);
      void dispatchPlayJob({
        triggerType: 'scheduled',
        profileName: resolved.profile?.name ?? null,
        slotLabel: slot.label,
        scheduledTime: slot.time,
        actorName: null,
        steps: slot.steps
      });
    }
  }

  if (
    shouldTriggerAutoShutdown(snapshot.shutdownSettings, parts.dayOfWeek, parts.timeStr) &&
    !store.hasShutdownTriggered(parts.dateStr)
  ) {
    store.markShutdownTriggered(parts.dateStr);
    initiateShutdown(
      'shutdown',
      snapshot.shutdownSettings.graceSeconds,
      `Auto-Shutdown terjadwal pukul ${snapshot.shutdownSettings.time}`,
      'Jadwal Otomatis'
    );
  }
}

function registerAudioProtocol(): void {
  protocol.handle('bell-audio', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const relPath = parsedUrl.searchParams.get('path') || '';
      const audioRoot = path.resolve(store.config.audioDir);
      const targetPath = path.resolve(audioRoot, relPath);

      if (targetPath !== audioRoot && !targetPath.startsWith(audioRoot + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(targetPath)) {
        return new Response('Audio file not found', { status: 404 });
      }

      const stat = fs.statSync(targetPath);
      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
      const range = request.headers.get('range');

      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
          const chunkSize = end - start + 1;
          const nodeStream = fs.createReadStream(targetPath, { start, end });
          return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes'
            }
          });
        }
      }

      const nodeStream = fs.createReadStream(targetPath);
      return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes'
        }
      });
    } catch {
      return new Response('Error reading audio file', { status: 500 });
    }
  });
}

function getIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, '..', 'build', 'icon.png')
    : path.join(__dirname, '../build/icon.png');
}

function createWindow(): void {
  const iconCandidate = path.join(app.getAppPath(), 'build', 'icon.png');
  const iconPath = fs.existsSync(iconCandidate) ? iconCandidate : getIconPath();

  mainWindow = new BrowserWindow({
    width: 1020,
    height: 720,
    minWidth: 780,
    minHeight: 580,
    title: 'Bel Sekolah ADB — SMK Negeri 1 Adiwerna',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const iconCandidate = path.join(app.getAppPath(), 'build', 'icon.png');
  const img = fs.existsSync(iconCandidate)
    ? nativeImage.createFromPath(iconCandidate).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty();

  tray = new Tray(img);
  tray.setToolTip('Bel Sekolah ADB — SMK Negeri 1 Adiwerna');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Buka Jendela Bel Sekolah ADB',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
      {
        label: 'Sinkronkan Jadwal Sekarang',
        click: () => {
          void syncWithServerRest();
          refreshAudioFiles();
        }
      },
      {
        label: 'Hentikan Audio',
        click: () => stopPlayback()
      },
      { type: 'separator' },
      {
        label: 'Keluar Aplikasi',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerIpc(): void {
  ipcMain.handle('desktop:get-state', () => buildUIState());

  ipcMain.handle('desktop:save-config', async (_ev, patch: Partial<DesktopConfig>) => {
    const prevServer = store.config.serverUrl;
    const prevToken = store.config.deviceToken;
    const prevAudioDir = store.config.audioDir;

    store.updateConfig(patch);
    updatePowerSaveBlocker();
    updateAutoLaunch();

    if (patch.audioDir && patch.audioDir !== prevAudioDir) {
      setupAudioWatcher();
      refreshAudioFiles();
      void syncServerAudioFiles();
    }
    if (patch.serverUrl !== prevServer || patch.deviceToken !== prevToken) {
      connectSocket();
      void syncWithServerRest();
    }

    emitUIState();
    return buildUIState();
  });

  ipcMain.handle('desktop:pick-audio-dir', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Pilih Folder File MP3 Bel Sekolah',
      defaultPath: store.config.audioDir,
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const selected = res.filePaths[0]!;
    store.updateConfig({ audioDir: selected });
    setupAudioWatcher();
    refreshAudioFiles();
    void syncServerAudioFiles();
    return selected;
  });

  ipcMain.handle('desktop:open-audio-dir', async () => {
    if (store.config.audioDir) {
      await shell.openPath(store.config.audioDir);
    }
  });

  ipcMain.handle('desktop:rescan-audio', () => {
    refreshAudioFiles();
    return buildUIState();
  });

  ipcMain.handle('desktop:sync-now', async () => {
    refreshAudioFiles();
    await syncWithServerRest();
    return buildUIState();
  });

  ipcMain.handle('desktop:init-local-snapshot', () => {
    if (!store.snapshot) {
      store.saveLocalModifiedSnapshot(createStarterSnapshot());
      emitUIState();
    }
    return buildUIState();
  });

  ipcMain.handle('desktop:save-local-snapshot', async (_ev, incoming: ScheduleSnapshot) => {
    const normalized: ScheduleSnapshot = {
      ...incoming,
      profiles: incoming.profiles.map((p) => ({
        ...p,
        slots: sortSlots(p.slots),
        updatedAt: new Date().toISOString()
      })),
      generatedAt: new Date().toISOString()
    };
    store.saveLocalModifiedSnapshot(normalized);
    emitUIState();

    const result = await pushLocalSnapshotToServer(false);
    return {
      state: buildUIState(),
      ...result
    };
  });

  ipcMain.handle('desktop:push-local-snapshot', async (_ev, force: boolean) => {
    const result = await pushLocalSnapshotToServer(Boolean(force));
    return {
      state: buildUIState(),
      ...result
    };
  });

  ipcMain.handle('desktop:accept-server-snapshot', async () => {
    if (conflictingServerSnapshot) {
      const next = conflictingServerSnapshot;
      conflictingServerSnapshot = null;
      store.markSnapshotSynced(next);
      emitUIState();
      sendHeartbeat();
      return buildUIState();
    }
    store.state.hasLocalUnsyncedChanges = false;
    await syncWithServerRest();
    return buildUIState();
  });

  ipcMain.handle(
    'desktop:play-test',
    (_ev, payload: { label: string; steps: AudioStep[] }) => {
      void dispatchPlayJob({
        triggerType: 'manual',
        profileName: null,
        slotLabel: payload.label,
        scheduledTime: null,
        actorName: 'Operator Lokal PC',
        steps: payload.steps
      });
    }
  );

  ipcMain.handle('desktop:stop-audio', () => {
    stopPlayback();
  });

  ipcMain.handle(
    'desktop:trigger-shutdown',
    (_ev, payload: { action: ShutdownAction; graceSeconds: number; reason: string }) => {
      initiateShutdown(
        payload.action,
        payload.graceSeconds,
        payload.reason,
        'Operator Lokal PC'
      );
    }
  );

  ipcMain.handle('desktop:cancel-shutdown', () => {
    cancelPendingShutdown('Petugas di PC Bel');
  });

  ipcMain.on('audio:started', (_ev, payload: { jobId: string; label: string }) => {
    activeJobId = payload.jobId;
    isPlaying = true;
    currentPlayingLabel = payload.label;
    emitUIState();
    sendHeartbeat();
  });

  ipcMain.on('audio:finished', (_ev, result: AudioPlayResult) => {
    if (!activeJobId || activeJobId === result.jobId) {
      activeJobId = null;
      isPlaying = false;
      currentPlayingLabel = null;
    }

    recordAndFlushLog({
      occurredAt: new Date().toISOString(),
      triggerType: result.triggerType,
      status: result.status,
      profileName: result.profileName,
      slotLabel: result.slotLabel,
      scheduledTime: result.scheduledTime,
      files: result.files,
      actorName: result.actorName,
      detail: result.detail
    });
    emitUIState();
    sendHeartbeat();
  });
}

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const defaultAudioDir = path.join(app.getPath('documents'), 'BelSekolahADB-Audio');
    store = new DesktopStore(app.getPath('userData'), defaultAudioDir);

    registerAudioProtocol();
    registerIpc();
    createWindow();
    createTray();
    updatePowerSaveBlocker();
    updateAutoLaunch();

    refreshAudioFiles();
    setupAudioWatcher();
    connectSocket();
    void syncWithServerRest();

    setInterval(runSchedulerTick, 1000);
    setInterval(sendHeartbeat, 20000);
    setInterval(() => {
      refreshAudioFiles();
    }, 30000);
    setInterval(() => {
      if (!connectedToServer) {
        void syncWithServerRest();
      }
    }, 60000);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    clearShutdownTimers();
    if (audioWatcher) audioWatcher.close();
  });
}
