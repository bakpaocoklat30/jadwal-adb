import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

export interface ServerConfig {
  port: number;
  host: string;
  timeZone: string;
  schoolName: string;
  dbPath: string;
  jwtSecret: string | null;
  corsOrigin: string | string[] | boolean;
  initialDeviceToken: string | null;
  webDistDir: string;
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT || 4000);
  const host = process.env.HOST || '0.0.0.0';
  const timeZone = process.env.APP_TIMEZONE || 'Asia/Jakarta';
  const schoolName = process.env.SCHOOL_NAME || 'SMK Negeri 1 Adiwerna';
  const dbPathRaw = process.env.DB_PATH || path.join(rootDir, 'data', 'jadwal-adb.db');
  const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.resolve(rootDir, dbPathRaw);
  const corsRaw = process.env.CORS_ORIGIN || '*';
  const corsOrigin = corsRaw === '*' ? true : corsRaw.split(',').map((s) => s.trim());

  return {
    port,
    host,
    timeZone,
    schoolName,
    dbPath,
    jwtSecret: process.env.JWT_SECRET?.trim() || null,
    corsOrigin,
    initialDeviceToken: process.env.INITIAL_DEVICE_TOKEN?.trim() || null,
    webDistDir: path.join(rootDir, 'apps', 'web', 'dist')
  };
}
