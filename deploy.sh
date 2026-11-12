#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

read_app_port() {
  local port="7029"
  if [ -f ".env" ]; then
    local val
    val="$(grep -E '^APP_PORT=' .env | tail -n 1 | cut -d '=' -f 2- | tr -d '[:space:]"'\''' || true)"
    if [ -n "$val" ]; then
      port="$val"
    fi
  fi
  printf '%s' "$port"
}

check_health() {
  local port="$1"
  local url="http://127.0.0.1:${port}/api/health"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$url" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.request; urllib.request.urlopen('$url', timeout=2)" >/dev/null 2>&1
  else
    docker exec jadwal-adb-server node -e "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
  fi
}

main() {
  cd "$SCRIPT_DIR"

  if ! command -v git >/dev/null 2>&1; then
    echo "Error: git tidak ditemukan." >&2
    exit 1
  fi

  local compose_cmd=()
  if docker compose version >/dev/null 2>&1; then
    compose_cmd=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    compose_cmd=(docker-compose)
  else
    echo "Error: Docker Compose tidak ditemukan." >&2
    exit 1
  fi

  if [ ! -f ".env" ]; then
    echo "==> Membuat file .env dari .env.example..."
    cp .env.example .env
    local secret
    secret="$(generate_secret)"
    sed -i.bak "s|ganti-rahasia-jwt-yang-panjang-dan-acak-minimal-32-karakter|${secret}|" .env
    rm -f .env.bak
  fi

  local branch
  branch="$(git -c safe.directory="$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)"
  echo "==> Menarik pembaruan terbaru dari GitHub (branch: ${branch})..."
  git -c safe.directory="$SCRIPT_DIR" pull --ff-only origin "$branch"

  echo "==> Membangun ulang dan menjalankan container Docker..."
  "${compose_cmd[@]}" up -d --build --remove-orphans

  echo "==> Membersihkan image Docker lama yang tidak terpakai..."
  docker image prune -f >/dev/null 2>&1 || true

  local app_port
  app_port="$(read_app_port)"
  echo "==> Menunggu server siap di port ${app_port}..."

  local ok=0
  for _ in $(seq 1 30); do
    if check_health "$app_port"; then
      ok=1
      break
    fi
    sleep 1
  done

  echo ""
  "${compose_cmd[@]}" ps

  if [ "$ok" -eq 1 ]; then
    echo ""
    echo "SUKSES: Bel Sekolah ADB berjalan di port ${app_port}."
    echo "Health check: http://127.0.0.1:${app_port}/api/health"
  else
    echo ""
    echo "PERINGATAN: Health check belum merespons dalam 30 detik." >&2
    echo "Cek log dengan perintah: ${compose_cmd[*]} logs --tail=50" >&2
    exit 1
  fi
}

main "$@"
