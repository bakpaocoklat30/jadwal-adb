import { io, type Socket } from 'socket.io-client';
import type {
  AudioFileEntry,
  AudioStep,
  BackupFileInfo,
  BackupSettings,
  BellLog,
  DeviceStatus,
  GenerateScheduleInput,
  ScheduleProfile,
  ScheduleSnapshot,
  ServerAudioFile,
  ShutdownAction,
  ShutdownSettings,
  UserPublic,
  UserRole
} from '@jadwal-adb/shared';

const TOKEN_STORAGE_KEY = 'jadwal_adb_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : `Terjadi kesalahan (${res.status})`,
      res.status
    );
  }

  return data as T;
}

export const api = {
  login(username: string, password: string) {
    return request<{ token: string; user: UserPublic }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },
  me() {
    return request<{ user: UserPublic }>('/api/auth/me');
  },
  changePassword(currentPassword: string, newPassword: string) {
    return request<{ user: UserPublic }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },
  getSnapshot() {
    return request<{ snapshot: ScheduleSnapshot; serverNowMs: number }>('/api/schedule/snapshot');
  },
  getDeviceState() {
    return request<{
      status: DeviceStatus;
      audioFiles: AudioFileEntry[];
      logs: BellLog[];
      serverNowMs: number;
    }>('/api/device/status');
  },
  createProfile(payload: Omit<ScheduleProfile, 'id' | 'createdAt' | 'updatedAt'>) {
    return request<{ profile: ScheduleProfile; snapshot: ScheduleSnapshot }>('/api/profiles', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateProfile(id: string, payload: Omit<ScheduleProfile, 'id' | 'createdAt' | 'updatedAt'>) {
    return request<{ profile: ScheduleProfile; snapshot: ScheduleSnapshot }>(`/api/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },
  duplicateProfile(id: string) {
    return request<{ profile: ScheduleProfile; snapshot: ScheduleSnapshot }>(
      `/api/profiles/${id}/duplicate`,
      { method: 'POST', body: '{}' }
    );
  },
  shiftProfile(id: string, deltaMinutes: number) {
    return request<{ profile: ScheduleProfile; snapshot: ScheduleSnapshot }>(
      `/api/profiles/${id}/shift`,
      { method: 'POST', body: JSON.stringify({ deltaMinutes }) }
    );
  },
  generatePreview(input: GenerateScheduleInput) {
    return request<{ slots: ScheduleProfile['slots'] }>('/api/profiles/generate-preview', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  deleteProfile(id: string) {
    return request<{ ok: boolean; snapshot: ScheduleSnapshot }>(`/api/profiles/${id}`, {
      method: 'DELETE'
    });
  },
  updateWeeklyRules(rules: Array<{ dayOfWeek: number; profileId: string | null }>) {
    return request<{ snapshot: ScheduleSnapshot }>('/api/weekly-rules', {
      method: 'PUT',
      body: JSON.stringify({ rules })
    });
  },
  createOverride(payload: {
    startDate: string;
    endDate: string;
    profileId: string | null;
    note: string;
  }) {
    return request<{ snapshot: ScheduleSnapshot }>('/api/overrides', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  setTodayOverride(payload: { date?: string; profileId: string | null; note: string }) {
    return request<{ snapshot: ScheduleSnapshot }>('/api/overrides/today', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  deleteOverride(id: string) {
    return request<{ snapshot: ScheduleSnapshot }>(`/api/overrides/${id}`, {
      method: 'DELETE'
    });
  },
  updateShutdownSettings(settings: Omit<ShutdownSettings, 'updatedAt'>) {
    return request<{ shutdownSettings: ShutdownSettings; snapshot: ScheduleSnapshot }>(
      '/api/settings/shutdown',
      {
        method: 'PUT',
        body: JSON.stringify(settings)
      }
    );
  },
  playManual(label: string, steps: AudioStep[]) {
    return request<{ ok: boolean; commandId: string }>('/api/remote/play-manual', {
      method: 'POST',
      body: JSON.stringify({ label, steps })
    });
  },
  stopAudio() {
    return request<{ ok: boolean }>('/api/remote/stop-audio', {
      method: 'POST',
      body: '{}'
    });
  },
  syncNow() {
    return request<{ ok: boolean }>('/api/remote/sync-now', {
      method: 'POST',
      body: '{}'
    });
  },
  shutdownPc(action: ShutdownAction, graceSeconds: number, reason: string) {
    return request<{ ok: boolean }>('/api/remote/shutdown', {
      method: 'POST',
      body: JSON.stringify({ action, graceSeconds, reason })
    });
  },
  cancelShutdown() {
    return request<{ ok: boolean }>('/api/remote/cancel-shutdown', {
      method: 'POST',
      body: '{}'
    });
  },
  getDeviceToken() {
    return request<{ deviceToken: string }>('/api/device/token');
  },
  rotateDeviceToken() {
    return request<{ deviceToken: string }>('/api/device/token/rotate', {
      method: 'POST',
      body: '{}'
    });
  },
  listUsers() {
    return request<{ users: UserPublic[] }>('/api/users');
  },
  createUser(payload: {
    username: string;
    displayName: string;
    role: UserRole;
    password: string;
  }) {
    return request<{ user: UserPublic }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateUser(
    id: string,
    payload: { displayName?: string; role?: UserRole; active?: boolean; password?: string }
  ) {
    return request<{ user: UserPublic }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  deleteUser(id: string) {
    return request<{ ok: boolean }>(`/api/users/${id}`, {
      method: 'DELETE'
    });
  },
  listServerAudio() {
    return request<{ files: ServerAudioFile[] }>('/api/audio/server-files');
  },
  async uploadAudioFile(file: File): Promise<{ file: ServerAudioFile; files: ServerAudioFile[] }> {
    const token = getStoredToken();
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const res = await fetch('/api/audio/upload', {
      method: 'POST',
      headers,
      body: form
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new ApiError(
        typeof data.error === 'string' ? data.error : `Upload gagal (${res.status})`,
        res.status
      );
    }
    return data as { file: ServerAudioFile; files: ServerAudioFile[] };
  },
  deleteServerAudio(fileName: string) {
    return request<{ ok: boolean; files: ServerAudioFile[] }>(
      `/api/audio/server-files/${encodeURIComponent(fileName)}`,
      { method: 'DELETE' }
    );
  },
  async fetchServerAudioBlobUrl(fileName: string): Promise<string> {
    const token = getStoredToken();
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const res = await fetch(`/api/audio/server-files/${encodeURIComponent(fileName)}/stream`, {
      headers
    });
    if (!res.ok) {
      throw new ApiError('Gagal memuat pratinjau audio', res.status);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  getBackups() {
    return request<{ settings: BackupSettings; files: BackupFileInfo[] }>('/api/backups');
  },
  updateBackupSettings(payload: { enabled: boolean; time: string; retainCount: number }) {
    return request<{ settings: BackupSettings }>('/api/backups/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },
  createBackup() {
    return request<{
      file: BackupFileInfo;
      settings: BackupSettings;
      files: BackupFileInfo[];
    }>('/api/backups/create', {
      method: 'POST',
      body: '{}'
    });
  },
  deleteBackup(fileName: string) {
    return request<{ ok: boolean; files: BackupFileInfo[] }>(
      `/api/backups/${encodeURIComponent(fileName)}`,
      { method: 'DELETE' }
    );
  },
  async downloadAuthorizedFile(url: string, fallbackName: string): Promise<void> {
    const token = getStoredToken();
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new ApiError(`Gagal mengunduh file (${res.status})`, res.status);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  },
  restoreScheduleJson(payload: unknown) {
    return request<{ snapshot: ScheduleSnapshot; files: BackupFileInfo[] }>(
      '/api/backups/restore-schedule',
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  }
};

export function connectAdminSocket(token: string): Socket {
  return io({
    auth: {
      kind: 'user',
      token
    }
  });
}
