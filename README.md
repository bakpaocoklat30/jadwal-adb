# Bel Sekolah ADB — SMK Negeri 1 Adiwerna

Sistem bel sekolah berbasis **Offline-First Desktop Windows + Web Admin + Sinkronisasi Real-Time VPS**.

## Arsitektur Monorepo

- `packages/shared`: Tipe data, validasi Zod, generator jam pelajaran, dan resolver jadwal (`Senin Upacara`, `Reguler`, `Jumat`, `Kalender Pengecualian`, `Auto-Shutdown`).
- `apps/server`: Backend Fastify + Socket.IO + SQLite (`node:sqlite`) sekaligus melayani file statis Web Admin.
- `apps/web`: Web Admin responsif untuk **Admin Jadwal**, **Waka Kurikulum**, dan **Guru Piket**.
- `apps/desktop`: Aplikasi Windows Desktop (Electron) pemutar MP3 lokal, pemindai folder Explorer, cache offline, auto-start, anti-sleep, dan remote/auto shutdown PC.

---

## Akun Default (Pertama Kali Jalan)

Saat database dibuat pertama kali, sistem membuat 3 akun bawaan (segera ganti password melalui menu **Pengaturan**):

| Username | Password Awal | Peran |
| :--- | :--- | :--- |
| `admin` | `admin123` | Admin Jadwal (akses penuh + kelola akun & pairing token) |
| `waka` | `waka123` | Waka Kurikulum (kelola profil, kalender, auto-shutdown, bel manual) |
| `piket` | `piket123` | Guru Piket (override hari ini, matikan bel hari ini, bel manual, shutdown PC) |

---

## Pengembangan di Mac (macOS)

1. Install dependensi:
   ```bash
   npm install
   ```
2. Build shared package:
   ```bash
   npm run build:shared
   ```
3. Jalankan masing-masing di terminal terpisah:
   - **Server (port 4000):** `npm run dev:server`
   - **Web Admin (port 5173):** `npm run dev:web`
   - **Desktop Player (Electron di Mac):** `npm run dev:desktop`

> Saat dijalankan di macOS, fitur shutdown PC otomatis berjalan dalam **Mode Simulasi (Dry-Run)** agar Mac tidak ikut mati saat pengujian.

---

## Build Installer Windows (`.exe`) dari Mac

```bash
npm run build:win
```

Hasil installer NSIS & versi portable akan tersimpan di folder `apps/desktop/release/`.
Salin ke PC Windows bel sekolah, lalu:
1. Buka **Web Admin → Pengaturan**, salin **URL Server VPS** dan **Device Token**.
2. Tempel ke **Pengaturan & Pairing** di aplikasi Windows.
3. Pilih folder tempat file MP3 berada, dan nonaktifkan centang **Mode Simulasi Shutdown (Dry-Run)** jika ingin perintah shutdown benar-benar mematikan PC Windows.

---

## Deploy ke VPS

### Opsi A: Docker Compose (Direkomendasikan)

1. Salin `.env.example` menjadi `.env` dan isi `JWT_SECRET`.
2. Jalankan:
   ```bash
   docker compose up -d --build
   ```
3. Arahkan Nginx/Caddy (HTTPS + WebSocket proxy) ke `http://127.0.0.1:4000`.

### Opsi B: Node.js (>= 22.13) + PM2

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```
