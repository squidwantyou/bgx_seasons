#!/usr/bin/env bash
# BGX 一键部署：构建 → /opt/bgx/app（systemd）→ /var/www/bgx（Apache）
# 需要 sudo 权限；可重复执行。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/bgx/app
WEB_DIR=/var/www/bgx
DATA_DIR=/var/lib/bgx

cd "$ROOT"

echo "==> 安装依赖"
pnpm install

echo "==> 构建 protocol / server / web"
pnpm build

echo "==> 部署前端 → $WEB_DIR"
sudo mkdir -p "$WEB_DIR"
sudo rsync -a --delete --chmod=D755,F644 apps/web/dist/ "$WEB_DIR/"

echo "==> 部署服务端 → $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --chmod=D755,F644 \
  --exclude '.git' \
  --exclude 'data' \
  --exclude 'apps/web/src' \
  --exclude 'apps/web/dist' \
  "$ROOT"/ "$APP_DIR"/

echo "==> 准备 Node 运行时"
if ! /usr/local/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  sudo install -m 0755 "$(command -v node)" /usr/local/bin/node
fi

echo "==> 准备系统用户与数据目录"
if ! id bgx >/dev/null 2>&1; then
  sudo useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin bgx
fi
sudo mkdir -p "$DATA_DIR"
sudo chown -R bgx:bgx "$DATA_DIR"
sudo chmod 750 "$DATA_DIR"

echo "==> 安装 systemd 服务"
sudo install -m 0644 deploy/bgx.service /etc/systemd/system/bgx.service
sudo systemctl daemon-reload
sudo systemctl enable bgx >/dev/null
sudo systemctl restart bgx

echo "==> 配置 Apache"
sudo install -m 0644 deploy/apache-bgx.conf /etc/apache2/conf-available/bgx.conf
sudo a2enmod proxy proxy_http proxy_wstunnel headers rewrite >/dev/null
sudo a2enconf bgx >/dev/null
sudo apache2ctl configtest
sudo systemctl reload apache2

echo "==> 健康检查"
sleep 1
curl -fsS "http://127.0.0.1:8787/healthz"
echo
curl -fsSk "https://thinktwice.top/bgx/api/me" >/dev/null
echo "部署完成：https://thinktwice.top/bgx/"
