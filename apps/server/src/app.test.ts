import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { io as ioClient } from 'socket.io-client';
import { buildServerApp } from './app.js';
import type { ServerConfig } from './config.js';

function testConfig(tmpRoot: string): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    timeZone: 'Asia/Jakarta',
    schoolName: 'SMK Negeri 1 Adiwerna',
    dbPath: ':memory:',
    uploadsDir: path.join(tmpRoot, 'uploads'),
    backupsDir: path.join(tmpRoot, 'backups'),
    jwtSecret: 'test-jwt-secret-key-min-32-chars-long',
    corsOrigin: true,
    initialDeviceToken: 'test-device-token',
    webDistDir: '/tmp/nonexistent-web-dist'
  };
}

test('auth, role enforcement, schedule mutation, and device sync work end-to-end', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));

  try {
    // 1. Health check
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(healthRes.statusCode, 200);
    const health = healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.scheduleVersion, 1);

    // 2. Login as admin & piket
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' }
    });
    assert.equal(adminLogin.statusCode, 200);
    const adminToken = adminLogin.json().token as string;

    const piketLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'piket', password: 'piket123' }
    });
    assert.equal(piketLogin.statusCode, 200);
    const piketToken = piketLogin.json().token as string;

    // 3. Piket cannot create master profiles (403)
    const piketCreateProfile = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${piketToken}` },
      payload: { name: 'Ilegal', description: '', color: '#000', slots: [] }
    });
    assert.equal(piketCreateProfile.statusCode, 403);

    // 4. Admin can create profile and version increments
    const adminCreateProfile = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Ramadhan',
        description: 'Jadwal bulan suci',
        color: '#10b981',
        slots: [
          {
            id: 'slot-ram-1',
            time: '07:30',
            label: 'Masuk Ramadhan',
            enabled: true,
            steps: [{ id: 'st-1', fileName: 'jam_1.mp3', delayBeforeMs: 0, volume: 100 }]
          }
        ]
      }
    });
    assert.equal(adminCreateProfile.statusCode, 201);
    assert.equal(adminCreateProfile.json().snapshot.version, 2);

    // 5. Piket CAN set today override (e.g. matikan bel hari ini)
    const todayOverride = await app.inject({
      method: 'POST',
      url: '/api/overrides/today',
      headers: { authorization: `Bearer ${piketToken}` },
      payload: { profileId: null, note: 'Acara HUT Sekolah' }
    });
    assert.equal(todayOverride.statusCode, 201);
    assert.equal(todayOverride.json().snapshot.version, 3);

    // 6. Device sync requires valid x-device-token
    const badSync = await app.inject({ method: 'GET', url: '/api/device/sync' });
    assert.equal(badSync.statusCode, 401);

    const goodSync = await app.inject({
      method: 'GET',
      url: '/api/device/sync',
      headers: { 'x-device-token': 'test-device-token' }
    });
    assert.equal(goodSync.statusCode, 200);
    assert.equal(goodSync.json().snapshot.version, 3);

    // 7. Remote shutdown returns 409 when PC bell is offline (after admin changes default password)
    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { currentPassword: 'admin123', newPassword: 'admin-secure-password' }
    });
    const offlineRemote = await app.inject({
      method: 'POST',
      url: '/api/remote/shutdown',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: 'shutdown', graceSeconds: 20, reason: 'Pulang' }
    });
    assert.equal(offlineRemote.statusCode, 409);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('realtime Socket.IO device pairing, heartbeat, audio manifest, and remote commands work', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'waka', password: 'waka123' }
    });
    assert.equal(loginRes.statusCode, 200);
    const wakaToken = loginRes.json().token as string;

    const changePwRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: { currentPassword: 'waka123', newPassword: 'waka-secure-password' }
    });
    assert.equal(changePwRes.statusCode, 200);

    const deviceSocket = ioClient(address, {
      auth: { kind: 'device', deviceToken: 'test-device-token' },
      transports: ['websocket']
    });

    const initialSnapshot = await new Promise<{ snapshot: { version: number } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for initial snapshot')), 5000);
      deviceSocket.on('schedule:updated', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      deviceSocket.on('connect_error', reject);
    });
    assert.equal(initialSnapshot.snapshot.version, 1);

    // Send heartbeat with ack and audio manifest
    const ack = await new Promise<{ scheduleVersion: number }>((resolve) => {
      deviceSocket.emit(
        'device:heartbeat',
        {
          deviceName: 'PC-BEL-UJI',
          platform: 'win32',
          appVersion: '1.0.0',
          audioDir: 'D:\\Bel\\Audio',
          audioCount: 1,
          activeScheduleVersion: 1,
          clientNowMs: Date.now(),
          isPlaying: false,
          currentPlayingLabel: null,
          shutdownState: 'idle',
          shutdownAction: null,
          shutdownRemainingSec: null,
          shutdownReason: null
        },
        resolve
      );
    });
    assert.equal(ack.scheduleVersion, 1);

    deviceSocket.emit('device:audio_manifest', {
      audioDir: 'D:\\Bel\\Audio',
      files: [
        {
          fileName: 'upacara.mp3',
          relativePath: 'upacara.mp3',
          sizeBytes: 12345,
          updatedAt: new Date().toISOString()
        }
      ]
    });

    // Wait for remote shutdown command triggered by Waka
    const commandPromise = new Promise<{ type: string; action?: string; requestedBy: string }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for remote command')), 5000);
        deviceSocket.on('device:command', (cmd) => {
          clearTimeout(timer);
          resolve(cmd);
        });
      }
    );

    const shutdownRes = await app.inject({
      method: 'POST',
      url: '/api/remote/shutdown',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: { action: 'shutdown', graceSeconds: 15, reason: 'Uji shutdown' }
    });
    assert.equal(shutdownRes.statusCode, 200);

    const cmd = await commandPromise;
    assert.equal(cmd.type, 'shutdown_pc');
    assert.equal(cmd.action, 'shutdown');
    assert.equal(cmd.requestedBy, 'Waka Kurikulum');

    // Verify status reflects online PC
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/device/status',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.json().status.online, true);
    assert.equal(statusRes.json().status.deviceName, 'PC-BEL-UJI');
    assert.equal(statusRes.json().audioFiles.length, 1);

    deviceSocket.disconnect();
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('web audio upload, stream preview, device download, and deletion work', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    const piketLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'piket', password: 'piket123' }
    });
    const piketToken = piketLogin.json().token as string;

    const piketChangePw = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${piketToken}` },
      payload: { currentPassword: 'piket123', newPassword: 'piket-secure-password' }
    });
    assert.equal(piketChangePw.statusCode, 200);

    const wakaLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'waka', password: 'waka123' }
    });
    const wakaToken = wakaLogin.json().token as string;

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: { currentPassword: 'waka123', newPassword: 'waka-secure-password' }
    });

    // Upload MP3 via multipart FormData
    const form = new FormData();
    const fakeMp3 = new Blob([Buffer.from('ID3-fake-mp3-audio-bytes')], { type: 'audio/mpeg' });
    form.append('file', fakeMp3, 'Pengumuman Lomba (Baru).mp3');

    const uploadRes = await fetch(`${address}/api/audio/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${piketToken}` },
      body: form
    });
    assert.equal(uploadRes.status, 201);
    const uploadJson = (await uploadRes.json()) as {
      file: { fileName: string; relativePath: string };
    };
    assert.equal(uploadJson.file.fileName, 'Pengumuman_Lomba_Baru.mp3');
    assert.equal(uploadJson.file.relativePath, '_web/Pengumuman_Lomba_Baru.mp3');

    // Device can list & download it
    const devListRes = await app.inject({
      method: 'GET',
      url: '/api/device/server-audio',
      headers: { 'x-device-token': 'test-device-token' }
    });
    assert.equal(devListRes.statusCode, 200);
    assert.equal(devListRes.json().files.length, 1);

    const devDlRes = await app.inject({
      method: 'GET',
      url: '/api/device/server-audio/Pengumuman_Lomba_Baru.mp3',
      headers: { 'x-device-token': 'test-device-token' }
    });
    assert.equal(devDlRes.statusCode, 200);
    assert.equal(devDlRes.body, 'ID3-fake-mp3-audio-bytes');

    // Web Admin can stream preview
    const previewRes = await app.inject({
      method: 'GET',
      url: '/api/audio/server-files/Pengumuman_Lomba_Baru.mp3/stream',
      headers: { authorization: `Bearer ${piketToken}` }
    });
    assert.equal(previewRes.statusCode, 200);

    // Piket cannot delete server audio (403), Waka can (200)
    const piketDel = await app.inject({
      method: 'DELETE',
      url: '/api/audio/server-files/Pengumuman_Lomba_Baru.mp3',
      headers: { authorization: `Bearer ${piketToken}` }
    });
    assert.equal(piketDel.statusCode, 403);

    const wakaDel = await app.inject({
      method: 'DELETE',
      url: '/api/audio/server-files/Pengumuman_Lomba_Baru.mp3',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(wakaDel.statusCode, 200);
    assert.equal(wakaDel.json().files.length, 0);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('device snapshot push handles optimistic concurrency conflict and force overwrite', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));

  try {
    const syncRes = await app.inject({
      method: 'GET',
      url: '/api/device/sync',
      headers: { 'x-device-token': 'test-device-token' }
    });
    assert.equal(syncRes.statusCode, 200);
    const snap = syncRes.json().snapshot;
    assert.equal(snap.version, 1);

    // 1. Push with matching baseVersion -> 200, version bumps to 2
    const pushOk = await app.inject({
      method: 'POST',
      url: '/api/device/snapshot',
      headers: { 'x-device-token': 'test-device-token' },
      payload: {
        baseVersion: 1,
        force: false,
        profiles: [
          {
            id: 'p-local-1',
            name: 'Profil dari Desktop',
            description: 'Edit lokal',
            color: '#2563eb',
            slots: [
              {
                id: 's-1',
                time: '07:00',
                label: 'Masuk',
                enabled: true,
                steps: [{ id: 'st-1', fileName: 'jam_1.mp3', delayBeforeMs: 0, volume: 100 }]
              }
            ]
          }
        ],
        weeklyRules: snap.weeklyRules.map((r: { dayOfWeek: number }) => ({
          dayOfWeek: r.dayOfWeek,
          profileId: r.dayOfWeek === 1 ? 'p-local-1' : null
        })),
        dateOverrides: [],
        shutdownSettings: {
          enabled: true,
          graceSeconds: 20,
          dayRules: [
            { dayOfWeek: 0, enabled: false, time: '12:00' },
            { dayOfWeek: 1, enabled: true, time: '16:15' },
            { dayOfWeek: 2, enabled: true, time: '16:15' },
            { dayOfWeek: 3, enabled: true, time: '16:15' },
            { dayOfWeek: 4, enabled: true, time: '16:15' },
            { dayOfWeek: 5, enabled: true, time: '12:00' },
            { dayOfWeek: 6, enabled: true, time: '13:30' }
          ]
        }
      }
    });
    assert.equal(pushOk.statusCode, 200);
    assert.equal(pushOk.json().snapshot.version, 2);

    // 2. Push with stale baseVersion=1 and force=false -> 409 Conflict
    const pushConflict = await app.inject({
      method: 'POST',
      url: '/api/device/snapshot',
      headers: { 'x-device-token': 'test-device-token' },
      payload: {
        baseVersion: 1,
        force: false,
        profiles: [],
        weeklyRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, profileId: null })),
        dateOverrides: [],
        shutdownSettings: {
          enabled: false,
          graceSeconds: 20,
          dayRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d,
            enabled: false,
            time: '16:30'
          }))
        }
      }
    });
    assert.equal(pushConflict.statusCode, 409);
    assert.equal(pushConflict.json().currentVersion, 2);

    // 3. Push with force=true -> 200, version bumps to 3
    const pushForce = await app.inject({
      method: 'POST',
      url: '/api/device/snapshot',
      headers: { 'x-device-token': 'test-device-token' },
      payload: {
        baseVersion: 1,
        force: true,
        profiles: [],
        weeklyRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, profileId: null })),
        dateOverrides: [],
        shutdownSettings: {
          enabled: false,
          graceSeconds: 20,
          dayRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d,
            enabled: false,
            time: '16:30'
          }))
        }
      }
    });
    assert.equal(pushForce.statusCode, 200);
    assert.equal(pushForce.json().snapshot.version, 3);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('manual DB backup, auto-backup settings, download, delete, and JSON schedule restore work', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));

  try {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' }
    });
    const adminToken = adminLogin.json().token as string;

    const wakaLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'waka', password: 'waka123' }
    });
    const wakaToken = wakaLogin.json().token as string;

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: { currentPassword: 'waka123', newPassword: 'waka-secure-password' }
    });

    // 1. Waka cannot access full .db backup settings (403)
    const wakaBackupList = await app.inject({
      method: 'GET',
      url: '/api/backups',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(wakaBackupList.statusCode, 403);

    // 2. Admin can update auto-backup settings and trigger manual .db backup
    const settingsRes = await app.inject({
      method: 'PUT',
      url: '/api/backups/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true, time: '03:15', retainCount: 7 }
    });
    assert.equal(settingsRes.statusCode, 200);
    assert.equal(settingsRes.json().settings.time, '03:15');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/backups/create',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(createRes.statusCode, 200);
    const createdFileName = createRes.json().file.fileName as string;
    assert.ok(createdFileName.startsWith('backup-manual-'));
    assert.ok(createRes.json().file.sizeBytes > 0);

    // 3. Download .db backup
    const dlRes = await app.inject({
      method: 'GET',
      url: `/api/backups/${encodeURIComponent(createdFileName)}/download`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(dlRes.statusCode, 200);
    assert.ok(dlRes.rawPayload.subarray(0, 15).toString('utf8').includes('SQLite format 3'));

    // 4. Waka can export schedule JSON and restore modified schedule JSON
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/backups/schedule-json',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(exportRes.statusCode, 200);
    const exported = exportRes.json();
    assert.ok(Array.isArray(exported.profiles));

    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/backups/restore-schedule',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: {
        ...exported,
        profiles: [
          {
            id: 'restored-1',
            name: 'Profil Hasil Restore',
            description: 'Pulihan backup',
            color: '#059669',
            slots: []
          }
        ],
        weeklyRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          dayOfWeek: d,
          profileId: d === 1 ? 'restored-1' : null
        })),
        dateOverrides: []
      }
    });
    assert.equal(restoreRes.statusCode, 200);
    assert.equal(restoreRes.json().snapshot.profiles[0].name, 'Profil Hasil Restore');
    // Restore creates an automatic safety backup before overwriting
    assert.ok(restoreRes.json().files.length >= 2);

    // 5. Admin can delete a backup
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/backups/${encodeURIComponent(createdFileName)}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delRes.statusCode, 200);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('announcement chime, voice note upload, and realtime live mic Socket.IO relay work', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    const wakaLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'waka', password: 'waka123' }
    });
    const wakaToken = wakaLogin.json().token as string;

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: { currentPassword: 'waka123', newPassword: 'waka-secure-password' }
    });

    const deviceSocket = ioClient(address, {
      auth: { kind: 'device', deviceToken: 'test-device-token' },
      transports: ['websocket']
    });
    await new Promise<void>((resolve, reject) => {
      deviceSocket.on('connect', () => resolve());
      deviceSocket.on('connect_error', reject);
    });

    // 1. Standalone chime command
    const chimeCmdPromise = new Promise<{ type: string; requestedBy: string }>((resolve) => {
      deviceSocket.once('device:command', resolve);
    });
    const chimeRes = await fetch(`${address}/api/remote/play-chime`, {
      method: 'POST',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(chimeRes.status, 200);
    const chimeCmd = await chimeCmdPromise;
    assert.equal(chimeCmd.type, 'play_chime');
    assert.equal(chimeCmd.requestedBy, 'Waka Kurikulum');

    // 2. Voice note upload + device download
    const vnCmdPromise = new Promise<{
      type: string;
      fileName: string;
      withChime: boolean;
      label: string;
    }>((resolve) => {
      deviceSocket.once('device:command', resolve);
    });
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('fake-m4a-voice-note')], { type: 'audio/mp4' }), 'vn.m4a');
    const vnRes = await fetch(
      `${address}/api/remote/announce-voice-note?withChime=true&label=Info+Upacara`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${wakaToken}` },
        body: form
      }
    );
    assert.equal(vnRes.status, 200);
    const vnCmd = await vnCmdPromise;
    assert.equal(vnCmd.type, 'play_announcement');
    assert.equal(vnCmd.withChime, true);
    assert.equal(vnCmd.label, 'Info Upacara');

    const dlRes = await app.inject({
      method: 'GET',
      url: `/api/device/announcements/${encodeURIComponent(vnCmd.fileName)}`,
      headers: { 'x-device-token': 'test-device-token' }
    });
    assert.equal(dlRes.statusCode, 200);
    assert.equal(dlRes.body, 'fake-m4a-voice-note');

    // 3. Live Mic Socket.IO relay
    const userSocket = ioClient(address, {
      auth: { kind: 'user', token: wakaToken },
      transports: ['websocket']
    });
    await new Promise<void>((resolve, reject) => {
      userSocket.on('connect', () => resolve());
      userSocket.on('connect_error', reject);
    });

    const liveStartPromise = new Promise<{ sessionId: string; withChime: boolean }>((resolve) => {
      deviceSocket.once('device:live_mic_start', resolve);
    });
    const liveChunkPromise = new Promise<{ sessionId: string; pcmBase64: string }>((resolve) => {
      deviceSocket.once('device:live_mic_chunk', resolve);
    });
    const liveStopPromise = new Promise<{ sessionId: string }>((resolve) => {
      deviceSocket.once('device:live_mic_stop', resolve);
    });

    const ack = await new Promise<{ ok: boolean; sessionId?: string }>((resolve) => {
      userSocket.emit('announce:live_start', { withChime: true, sampleRate: 16000 }, resolve);
    });
    assert.equal(ack.ok, true);
    assert.ok(ack.sessionId);

    const started = await liveStartPromise;
    assert.equal(started.sessionId, ack.sessionId);
    assert.equal(started.withChime, true);

    userSocket.emit('announce:live_chunk', {
      sessionId: ack.sessionId,
      pcmBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      sampleRate: 16000
    });
    const chunk = await liveChunkPromise;
    assert.equal(chunk.sessionId, ack.sessionId);

    userSocket.emit('announce:live_stop', { sessionId: ack.sessionId });
    const stopped = await liveStopPromise;
    assert.equal(stopped.sessionId, ack.sessionId);

    userSocket.disconnect();
    deviceSocket.disconnect();
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('security hardening: login rate limit, default-password enforcement, role guard, cooldown, and live-mic lock', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadwal-adb-test-'));
  const { app } = await buildServerApp(testConfig(tmpDir));
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    // 1. Brute-force login rate limit (5 failed attempts -> 6th returns 429)
    for (let i = 0; i < 5; i++) {
      const bad = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: `wrong-${i}` }
      });
      assert.equal(bad.statusCode, 401);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong-again' }
    });
    assert.equal(blocked.statusCode, 429);

    // Verify security headers are present
    assert.equal(blocked.headers['x-content-type-options'], 'nosniff');
    assert.equal(blocked.headers['x-frame-options'], 'DENY');

    // Connect device socket
    const deviceSocket = ioClient(address, {
      auth: { kind: 'device', deviceToken: 'test-device-token' },
      transports: ['websocket']
    });
    await new Promise<void>((resolve, reject) => {
      deviceSocket.on('connect', () => resolve());
      deviceSocket.on('connect_error', reject);
    });

    // 2. User with default password cannot trigger remote audio or Live Mic until password is changed
    const wakaLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'waka', password: 'waka123' }
    });
    const wakaToken = wakaLogin.json().token as string;

    const blockedChime = await app.inject({
      method: 'POST',
      url: '/api/remote/play-chime',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(blockedChime.statusCode, 403);

    const wakaSocket = ioClient(address, {
      auth: { kind: 'user', token: wakaToken },
      transports: ['websocket']
    });
    await new Promise<void>((resolve) => wakaSocket.on('connect', () => resolve()));

    const blockedLive = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      wakaSocket.emit('announce:live_start', { withChime: true }, resolve);
    });
    assert.equal(blockedLive.ok, false);

    // 3. After changing password, Waka can trigger chime, and rapid repeat triggers 429 cooldown
    const pwRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${wakaToken}` },
      payload: { currentPassword: 'waka123', newPassword: 'waka-strong-password' }
    });
    assert.equal(pwRes.statusCode, 200);

    const chime1 = await app.inject({
      method: 'POST',
      url: '/api/remote/play-chime',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(chime1.statusCode, 200);

    const chimeSpam = await app.inject({
      method: 'POST',
      url: '/api/remote/play-chime',
      headers: { authorization: `Bearer ${wakaToken}` }
    });
    assert.equal(chimeSpam.statusCode, 429);

    // 4. Piket cannot shutdown PC or play announcements even after changing password
    const piketLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'piket', password: 'piket123' }
    });
    const piketToken = piketLogin.json().token as string;
    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${piketToken}` },
      payload: { currentPassword: 'piket123', newPassword: 'piket-strong-password' }
    });

    const piketShutdown = await app.inject({
      method: 'POST',
      url: '/api/remote/shutdown',
      headers: { authorization: `Bearer ${piketToken}` },
      payload: { action: 'shutdown', graceSeconds: 20, reason: 'Unauthorized' }
    });
    assert.equal(piketShutdown.statusCode, 403);

    const piketChime = await app.inject({
      method: 'POST',
      url: '/api/remote/play-chime',
      headers: { authorization: `Bearer ${piketToken}` }
    });
    assert.equal(piketChime.statusCode, 403);

    wakaSocket.disconnect();
    deviceSocket.disconnect();
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
