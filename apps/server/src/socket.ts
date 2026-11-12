import crypto from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  audioManifestUploadSchema,
  bellLogInputSchema,
  deviceHeartbeatSchema,
  type RemoteCommand
} from '@jadwal-adb/shared';
import { z } from 'zod';
import { verifyUserToken } from './auth.js';
import type { AppDatabase } from './db.js';
import { safeTokenEquals } from './security.js';

export class RealtimeHub {
  public readonly io: SocketIOServer;
  private readonly deviceSockets = new Set<string>();
  private activeLiveBroadcast: {
    sessionId: string;
    userId: string;
    displayName: string;
    socketId: string;
  } | null = null;

  constructor(
    httpServer: HttpServer,
    private readonly db: AppDatabase,
    corsOrigin: string | string[] | boolean
  ) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigin,
        credentials: true
      }
    });

    this.io.use(async (socket, next) => {
      try {
        const auth = socket.handshake.auth as Record<string, unknown>;
        if (auth?.kind === 'device') {
          if (
            typeof auth.deviceToken !== 'string' ||
            !safeTokenEquals(auth.deviceToken, this.db.getDeviceToken())
          ) {
            return next(new Error('Invalid device token'));
          }
          socket.data.kind = 'device';
          return next();
        }

        if (auth?.kind === 'user' && typeof auth.token === 'string') {
          const payload = await verifyUserToken(auth.token, this.db.getJwtSecret());
          if (!payload) return next(new Error('Invalid user token'));
          const user = this.db.findUserById(payload.sub);
          if (!user || !user.active) return next(new Error('User inactive'));
          socket.data.kind = 'user';
          socket.data.user = this.db.toPublicUser(user);
          return next();
        }

        return next(new Error('Unauthorized socket handshake'));
      } catch {
        return next(new Error('Socket authentication error'));
      }
    });

    this.io.on('connection', (socket) => this.handleConnection(socket));
  }

  private handleConnection(socket: Socket): void {
    if (socket.data.kind === 'device') {
      this.deviceSockets.add(socket.id);
      socket.join('device');

      const nowIso = new Date().toISOString();
      this.db.updateDeviceStatus({
        online: true,
        lastHeartbeatAt: nowIso
      });

      socket.emit('schedule:updated', {
        snapshot: this.db.getScheduleSnapshot(),
        serverNowMs: Date.now()
      });
      socket.emit('server_audio:updated', this.db.listServerAudioFiles());
      this.broadcastDeviceStatus();

      socket.on('device:heartbeat', (raw, ack) => {
        const parsed = deviceHeartbeatSchema.safeParse(raw);
        if (!parsed.success) return;
        const serverNowMs = Date.now();
        const data = parsed.data;
        this.db.updateDeviceStatus({
          online: true,
          deviceName: data.deviceName,
          platform: data.platform,
          appVersion: data.appVersion,
          audioDir: data.audioDir,
          audioCount: data.audioCount,
          activeScheduleVersion: data.activeScheduleVersion,
          lastHeartbeatAt: new Date(serverNowMs).toISOString(),
          clockDriftMs: serverNowMs - data.clientNowMs,
          isPlaying: data.isPlaying,
          currentPlayingLabel: data.currentPlayingLabel,
          shutdownState: data.shutdownState,
          shutdownAction: data.shutdownAction,
          shutdownRemainingSec: data.shutdownRemainingSec,
          shutdownReason: data.shutdownReason
        });
        this.broadcastDeviceStatus();
        if (typeof ack === 'function') {
          ack({
            serverNowMs,
            scheduleVersion: this.db.getScheduleVersion()
          });
        }
      });

      socket.on('device:audio_manifest', (raw) => {
        const parsed = audioManifestUploadSchema.safeParse(raw);
        if (!parsed.success) return;
        this.db.setAudioManifest(parsed.data.files, parsed.data.audioDir);
        this.broadcastAudioManifest();
        this.broadcastDeviceStatus();
      });

      socket.on('device:logs_batch', (raw, ack) => {
        const parsed = z.array(bellLogInputSchema).safeParse(raw);
        if (!parsed.success) return;
        const inserted = this.db.insertBellLogs(parsed.data);
        if (inserted.length > 0) {
          this.broadcastLogsUpdated();
        }
        if (typeof ack === 'function') {
          ack({ saved: inserted.length });
        }
      });

      socket.on('device:graceful_shutdown', (raw: unknown) => {
        const reason =
          typeof raw === 'object' && raw !== null && 'reason' in raw
            ? String((raw as { reason: unknown }).reason)
            : 'Shutdown terencana';
        this.db.updateDeviceStatus({
          shutdownState: 'shutting_down',
          lastShutdownReason: reason,
          lastShutdownAt: new Date().toISOString()
        });
        this.broadcastDeviceStatus();
      });

      socket.on('disconnect', () => {
        this.deviceSockets.delete(socket.id);
        if (this.deviceSockets.size === 0) {
          this.db.updateDeviceStatus({
            online: false,
            isPlaying: false,
            currentPlayingLabel: null,
            shutdownState: 'idle',
            shutdownAction: null,
            shutdownRemainingSec: null,
            shutdownReason: null
          });
          this.broadcastDeviceStatus();
        }
      });
      return;
    }

    if (socket.data.kind === 'user') {
      socket.join('admins');
      let chunkWindowStart = Date.now();
      let chunkWindowCount = 0;

      socket.on('announce:live_start', (raw: unknown, ack) => {
        const replyAck = (payload: Record<string, unknown>) => {
          if (typeof ack === 'function') ack(payload);
        };

        if (!this.isDeviceConnected()) {
          replyAck({ ok: false, error: 'PC Bel sedang offline / tidak terhubung ke server' });
          return;
        }

        const authUser = socket.data.user as { id?: string } | undefined;
        const freshRow = authUser?.id ? this.db.findUserById(authUser.id) : null;
        if (!freshRow || !freshRow.active) {
          replyAck({ ok: false, error: 'Akun tidak aktif atau sesi tidak valid' });
          return;
        }
        const freshUser = this.db.toPublicUser(freshRow);
        if (freshUser.role !== 'admin' && freshUser.role !== 'waka') {
          replyAck({ ok: false, error: 'Hanya Admin atau Waka Kurikulum yang dapat menggunakan Live Mic' });
          return;
        }
        if (freshUser.mustChangePassword) {
          replyAck({
            ok: false,
            error: 'Demi keamanan, ganti password bawaan di menu Pengaturan sebelum memakai Live Mic'
          });
          return;
        }

        if (this.activeLiveBroadcast && this.activeLiveBroadcast.socketId !== socket.id) {
          if (freshUser.role !== 'admin') {
            replyAck({
              ok: false,
              error: `Live Mic sedang dipakai oleh ${this.activeLiveBroadcast.displayName}`
            });
            return;
          }
          // Admin taking over cleanly stops previous session
          this.io.to('device').emit('device:live_mic_stop', {
            sessionId: this.activeLiveBroadcast.sessionId,
            requestedBy: this.activeLiveBroadcast.displayName
          });
          this.activeLiveBroadcast = null;
        }

        const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        const withChime = body.withChime !== false;
        const sampleRate =
          typeof body.sampleRate === 'number' && body.sampleRate >= 8000 && body.sampleRate <= 48000
            ? Math.round(body.sampleRate)
            : 16000;
        const sessionId = crypto.randomUUID();
        this.activeLiveBroadcast = {
          sessionId,
          userId: freshUser.id,
          displayName: freshUser.displayName,
          socketId: socket.id
        };

        this.io.to('device').emit('device:live_mic_start', {
          sessionId,
          requestedBy: freshUser.displayName,
          withChime,
          sampleRate
        });

        replyAck({ ok: true, sessionId });
      });

      socket.on('announce:live_chunk', (raw: unknown) => {
        if (
          !this.activeLiveBroadcast ||
          this.activeLiveBroadcast.socketId !== socket.id ||
          !this.isDeviceConnected()
        ) {
          return;
        }
        const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        if (body.sessionId !== this.activeLiveBroadcast.sessionId) return;
        if (typeof body.pcmBase64 !== 'string' || body.pcmBase64.length === 0 || body.pcmBase64.length > 65536) {
          return;
        }
        const now = Date.now();
        if (now - chunkWindowStart >= 1000) {
          chunkWindowStart = now;
          chunkWindowCount = 0;
        }
        chunkWindowCount += 1;
        if (chunkWindowCount > 40) return;

        const sampleRate =
          typeof body.sampleRate === 'number' && body.sampleRate >= 8000 && body.sampleRate <= 48000
            ? Math.round(body.sampleRate)
            : 16000;
        this.io.to('device').emit('device:live_mic_chunk', {
          sessionId: this.activeLiveBroadcast.sessionId,
          pcmBase64: body.pcmBase64,
          sampleRate
        });
      });

      socket.on('announce:live_stop', (raw: unknown) => {
        if (!this.activeLiveBroadcast || this.activeLiveBroadcast.socketId !== socket.id) return;
        const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        if (body.sessionId && body.sessionId !== this.activeLiveBroadcast.sessionId) return;
        const finished = this.activeLiveBroadcast;
        this.activeLiveBroadcast = null;
        this.io.to('device').emit('device:live_mic_stop', {
          sessionId: finished.sessionId,
          requestedBy: finished.displayName
        });
      });

      socket.on('disconnect', () => {
        if (this.activeLiveBroadcast && this.activeLiveBroadcast.socketId === socket.id) {
          const finished = this.activeLiveBroadcast;
          this.activeLiveBroadcast = null;
          this.io.to('device').emit('device:live_mic_stop', {
            sessionId: finished.sessionId,
            requestedBy: finished.displayName
          });
        }
      });
    }
  }

  public isDeviceConnected(): boolean {
    return this.deviceSockets.size > 0;
  }

  public broadcastScheduleUpdated(): void {
    const payload = {
      snapshot: this.db.getScheduleSnapshot(),
      serverNowMs: Date.now()
    };
    this.io.to('device').to('admins').emit('schedule:updated', payload);
  }

  public broadcastDeviceStatus(): void {
    this.io.to('admins').emit('device:status', this.db.getDeviceStatus());
  }

  public broadcastAudioManifest(): void {
    this.io.to('admins').emit('audio:updated', this.db.getAudioManifest());
  }

  public broadcastServerAudioUpdated(): void {
    this.io.to('device').to('admins').emit('server_audio:updated', this.db.listServerAudioFiles());
  }

  public broadcastLogsUpdated(): void {
    this.io.to('admins').emit('logs:updated', this.db.listBellLogs(100));
  }

  public sendCommandToDevice(command: RemoteCommand): boolean {
    if (this.deviceSockets.size === 0) {
      return false;
    }
    this.io.to('device').emit('device:command', command);
    return true;
  }
}
