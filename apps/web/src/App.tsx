import { useCallback, useEffect, useState } from 'react';
import type {
  AudioFileEntry,
  AudioStep,
  BellLog,
  DeviceStatus,
  ScheduleProfile,
  ScheduleSlot,
  ScheduleSnapshot,
  ServerAudioFile,
  ShutdownAction,
  ShutdownSettings,
  UserPublic
} from '@jadwal-adb/shared';
import {
  ApiError,
  api,
  connectAdminSocket,
  getStoredToken,
  setStoredToken
} from './api.js';
import { Layout, type NavTab } from './components/Layout.js';
import { StatusBanner } from './components/StatusBanner.js';
import { AudioFilesPage } from './pages/AudioFilesPage.js';
import { CalendarPage } from './pages/CalendarPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProfilesPage } from './pages/ProfilesPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

export function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [booting, setBooting] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [audioFiles, setAudioFiles] = useState<AudioFileEntry[]>([]);
  const [serverAudioFiles, setServerAudioFiles] = useState<ServerAudioFile[]>([]);
  const [logs, setLogs] = useState<BellLog[]>([]);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [toast, setToast] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  const notify = useCallback((text: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  }, []);

  const loadAll = useCallback(async () => {
    const [snapRes, devRes, srvAudioRes] = await Promise.all([
      api.getSnapshot(),
      api.getDeviceState(),
      api.listServerAudio()
    ]);
    setSnapshot(snapRes.snapshot);
    setDeviceStatus(devRes.status);
    setAudioFiles(devRes.audioFiles);
    setServerAudioFiles(srvAudioRes.files);
    setLogs(devRes.logs);
    setServerTimeOffsetMs(snapRes.serverNowMs - Date.now());
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then(async (res) => {
        setUser(res.user);
        await loadAll();
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => setBooting(false));
  }, [loadAll]);

  useEffect(() => {
    if (!user) return;
    const token = getStoredToken();
    if (!token) return;

    const socket = connectAdminSocket(token);
    socket.on(
      'schedule:updated',
      (payload: { snapshot: ScheduleSnapshot; serverNowMs: number }) => {
        setSnapshot(payload.snapshot);
        setServerTimeOffsetMs(payload.serverNowMs - Date.now());
      }
    );
    socket.on('device:status', (status: DeviceStatus) => {
      setDeviceStatus(status);
    });
    socket.on('audio:updated', (files: AudioFileEntry[]) => {
      setAudioFiles(files);
    });
    socket.on('server_audio:updated', (files: ServerAudioFile[]) => {
      setServerAudioFiles(files);
    });
    socket.on('logs:updated', (nextLogs: BellLog[]) => {
      setLogs(nextLogs);
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);

  const runAction = async (fn: () => Promise<void>, successMessage?: string) => {
    try {
      await fn();
      if (successMessage) notify(successMessage, 'ok');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStoredToken(null);
        setUser(null);
      }
      notify(err instanceof Error ? err.message : 'Terjadi kesalahan', 'err');
      throw err;
    }
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Memuat Bel Sekolah ADB...
      </div>
    );
  }

  if (!user || !snapshot || !deviceStatus) {
    return (
      <LoginPage
        onLogin={async (username, password) => {
          const res = await api.login(username, password);
          setStoredToken(res.token);
          setUser(res.user);
          await loadAll();
        }}
      />
    );
  }

  return (
    <Layout
      user={user}
      activeTab={activeTab}
      onChangeTab={setActiveTab}
      onLogout={() => {
        setStoredToken(null);
        setUser(null);
      }}
    >
      {toast && (
        <div
          className={`fixed right-4 bottom-4 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === 'err' ? 'bg-rose-600' : 'bg-slate-900'
          }`}
        >
          {toast.text}
        </div>
      )}

      <StatusBanner
        status={deviceStatus}
        snapshot={snapshot}
        onStopAudio={() =>
          void runAction(async () => {
            await api.stopAudio();
          }, 'Perintah stop audio dikirim')
        }
        onCancelShutdown={() =>
          void runAction(async () => {
            await api.cancelShutdown();
          }, 'Perintah pembatalan shutdown dikirim')
        }
        onSyncNow={() =>
          void runAction(async () => {
            await api.syncNow();
          }, 'Perintah sinkronisasi dikirim')
        }
      />

      {activeTab === 'dashboard' && (
        <DashboardPage
          snapshot={snapshot}
          status={deviceStatus}
          audioFiles={audioFiles}
          serverAudioFiles={serverAudioFiles}
          logs={logs}
          serverTimeOffsetMs={serverTimeOffsetMs}
          onUploadAudio={async (file) => {
            let uploaded!: ServerAudioFile;
            await runAction(async () => {
              const res = await api.uploadAudioFile(file);
              uploaded = res.file;
              setServerAudioFiles(res.files);
            }, `File "${file.name}" berhasil diupload ke server`);
            return uploaded;
          }}
          onSetTodayOverride={(profileId, note) =>
            runAction(async () => {
              const res = await api.setTodayOverride({ profileId, note });
              setSnapshot(res.snapshot);
            }, 'Jadwal khusus hari ini diterapkan')
          }
          onDeleteOverride={(id) =>
            runAction(async () => {
              const res = await api.deleteOverride(id);
              setSnapshot(res.snapshot);
            }, 'Override hari ini dibatalkan')
          }
          onPlayManual={(label, steps: AudioStep[]) =>
            runAction(async () => {
              await api.playManual(label, steps);
            }, 'Perintah bunyikan bel dikirim ke PC Bel')
          }
          onStopAudio={() =>
            runAction(async () => {
              await api.stopAudio();
            }, 'Perintah hentikan audio dikirim')
          }
          onShutdownPc={(action: ShutdownAction, graceSeconds, reason) =>
            runAction(async () => {
              await api.shutdownPc(action, graceSeconds, reason);
            }, `Perintah ${action === 'restart' ? 'restart' : 'shutdown'} dikirim ke PC Bel`)
          }
        />
      )}

      {activeTab === 'profiles' && (
        <ProfilesPage
          profiles={snapshot.profiles}
          audioFiles={audioFiles}
          onCreateProfile={(payload: {
            name: string;
            description: string;
            color: string;
            slots: ScheduleSlot[];
          }) =>
            runAction(async () => {
              const res = await api.createProfile(payload);
              setSnapshot(res.snapshot);
            }, 'Profil baru disimpan & disinkronkan')
          }
          onUpdateProfile={(
            id: string,
            payload: Omit<ScheduleProfile, 'id' | 'createdAt' | 'updatedAt'>
          ) =>
            runAction(async () => {
              const res = await api.updateProfile(id, payload);
              setSnapshot(res.snapshot);
            }, 'Profil diperbarui & disinkronkan')
          }
          onDuplicateProfile={(id) =>
            runAction(async () => {
              const res = await api.duplicateProfile(id);
              setSnapshot(res.snapshot);
            }, 'Profil berhasil diduplikat')
          }
          onShiftProfile={(id, deltaMinutes) =>
            runAction(async () => {
              const res = await api.shiftProfile(id, deltaMinutes);
              setSnapshot(res.snapshot);
            }, 'Semua jam di profil berhasil digeser')
          }
          onDeleteProfile={(id) =>
            runAction(async () => {
              const res = await api.deleteProfile(id);
              setSnapshot(res.snapshot);
            }, 'Profil dihapus')
          }
        />
      )}

      {activeTab === 'calendar' && (
        <CalendarPage
          snapshot={snapshot}
          onUpdateWeeklyRules={(rules) =>
            runAction(async () => {
              const res = await api.updateWeeklyRules(rules);
              setSnapshot(res.snapshot);
            }, 'Aturan mingguan disimpan & disinkronkan')
          }
          onCreateOverride={(payload) =>
            runAction(async () => {
              const res = await api.createOverride(payload);
              setSnapshot(res.snapshot);
            }, 'Jadwal pengecualian ditambahkan')
          }
          onDeleteOverride={(id) =>
            runAction(async () => {
              const res = await api.deleteOverride(id);
              setSnapshot(res.snapshot);
            }, 'Jadwal pengecualian dihapus')
          }
        />
      )}

      {activeTab === 'audio' && (
        <AudioFilesPage
          userRole={user.role}
          status={deviceStatus}
          audioFiles={audioFiles}
          serverAudioFiles={serverAudioFiles}
          snapshot={snapshot}
          onUploadAudio={async (file) => {
            let uploaded!: ServerAudioFile;
            await runAction(async () => {
              const res = await api.uploadAudioFile(file);
              uploaded = res.file;
              setServerAudioFiles(res.files);
            }, `File "${file.name}" berhasil diupload ke server`);
            return uploaded;
          }}
          onDeleteServerAudio={(fileName) =>
            runAction(async () => {
              const res = await api.deleteServerAudio(fileName);
              setServerAudioFiles(res.files);
            }, `File "${fileName}" dihapus dari server`)
          }
          onPlayManual={(label, steps) =>
            runAction(async () => {
              await api.playManual(label, steps);
            }, 'Memutar audio di PC Bel...')
          }
        />
      )}

      {activeTab === 'settings' && (
        <SettingsPage
          currentUser={user}
          shutdownSettings={snapshot.shutdownSettings}
          onUpdateShutdownSettings={(settings: Omit<ShutdownSettings, 'updatedAt'>) =>
            runAction(async () => {
              const res = await api.updateShutdownSettings(settings);
              setSnapshot(res.snapshot);
            }, 'Pengaturan Auto-Shutdown disimpan')
          }
          onPasswordChanged={(updated) => setUser(updated)}
          onNotify={(msg) => notify(msg, 'ok')}
        />
      )}
    </Layout>
  );
}
