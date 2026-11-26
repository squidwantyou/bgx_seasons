#!/usr/bin/env bash
# 四季物语快速部署：protocol/server/web 构建（限内存）→ /opt/bgx/app + /var/www/bgx → 重启 bgx
# 可重复执行。用户已授权「有改动就直接部署」。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/bgx/app
WEB_DIR=/var/www/bgx

cd "$ROOT"

avail_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
if [ "${avail_kb:-0}" -lt 250000 ]; then
  echo "MemAvailable 只有 $((avail_kb / 1024))MB，低于 250MB，先停其他占用再部署" >&2
  exit 1
fi
echo "==> MemAvailable: $((avail_kb / 1024))MB"

echo "==> 构建 protocol"
NODE_OPTIONS=--max-old-space-size=320 pnpm --filter @bgx/protocol build

echo "==> 构建 server"
NODE_OPTIONS=--max-old-space-size=384 pnpm --filter @bgx/server build

echo "==> 构建 web"
NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @bgx/web build

echo "==> 部署前端 → $WEB_DIR"
sudo rsync -a --delete --chmod=D755,F644 apps/web/dist/ "$WEB_DIR/"

echo "==> 部署服务端 → $APP_DIR"
sudo rsync -a --delete --chmod=D755,F644 \
  --exclude '.git' \
  --exclude 'data' \
  --exclude 'apps/web/src' \
  --exclude 'apps/web/dist' \
  "$ROOT"/ "$APP_DIR"/

echo "==> 重启 bgx"
sudo systemctl restart bgx
sleep 2

echo "==> 健康检查"
curl -fsS "http://127.0.0.1:8787/healthz"
echo
curl -fsS "http://127.0.0.1:8787/api/games" | head -c 120
echo
echo "==> 完成：$(date '+%Y-%m-%d %H:%M:%S')"
