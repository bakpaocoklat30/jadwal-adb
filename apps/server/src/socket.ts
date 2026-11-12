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

export class RealtimeHub {
  public readonly io: SocketIOServer;
  private readonly deviceSockets = new Set<string>();

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
          if (auth.deviceToken !== this.db.getDeviceToken()) {
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
