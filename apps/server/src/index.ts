import { buildServerApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.jwtSecret) {
    console.warn(
      '[Bel Sekolah ADB] JWT_SECRET belum di-set di environment; menggunakan secret otomatis yang tersimpan di database.'
    );
  }

  const { app, db } = await buildServerApp(config);

  await app.listen({ port: config.port, host: config.host });
  console.log(`[Bel Sekolah ADB] Server berjalan di http://${config.host}:${config.port}`);
  console.log(`[Bel Sekolah ADB] Database SQLite: ${config.dbPath}`);
  console.log(`[Bel Sekolah ADB] Device Token saat ini: ${db.getDeviceToken()}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
