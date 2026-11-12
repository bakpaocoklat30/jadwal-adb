module.exports = {
  apps: [
    {
      name: 'jadwal-adb-server',
      script: 'apps/server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        HOST: '0.0.0.0',
        APP_TIMEZONE: 'Asia/Jakarta',
        SCHOOL_NAME: 'SMK Negeri 1 Adiwerna',
        DB_PATH: './data/jadwal-adb.db'
      }
    }
  ]
};
