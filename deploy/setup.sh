#!/usr/bin/env bash
# First-time setup on a fresh Ubuntu 22.04/24.04 VPS. Run as a sudo user:
#   git clone https://github.com/ibrahimorkans-max/montera.git /var/www/monetra
#   cd /var/www/monetra && bash deploy/setup.sh api.yourdomain.com
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$APP_DIR/apps/api"
DATA_DIR="$APP_DIR/data"

echo "==> Installing Node.js 22, Nginx and PM2"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y nginx
command -v pm2 >/dev/null || sudo npm install -g pm2

echo "==> Installing API packages"
cd "$API_DIR"
npm ci --omit=dev

mkdir -p "$DATA_DIR" "$APP_DIR/backups"

if [ ! -f "$API_DIR/.env" ]; then
  echo "==> Creating apps/api/.env with a new secret"
  sed -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" \
      -e "s|^DB_PATH=.*|DB_PATH=$DATA_DIR/monetra.db|" \
      .env.example > .env
  chmod 600 .env
fi

echo "==> Starting the API with PM2"
pm2 startOrReload ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

sleep 2
curl -fsS http://127.0.0.1:4000/health && echo

if [ -n "$DOMAIN" ]; then
  echo "==> Configuring Nginx for $DOMAIN"
  sed "s/api.example.com/$DOMAIN/g" "$APP_DIR/deploy/nginx-monetra.conf" | sudo tee /etc/nginx/sites-available/monetra >/dev/null
  sudo ln -sf /etc/nginx/sites-available/monetra /etc/nginx/sites-enabled/monetra
  sudo nginx -t && sudo systemctl reload nginx
  echo "==> Next: point $DOMAIN's DNS A record at this server, then run:"
  echo "    sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
fi

echo "==> Daily database backup at 02:30 (kept 14 days)"
( crontab -l 2>/dev/null | grep -v 'deploy/backup.mjs' ; echo "30 2 * * * cd $API_DIR && node $APP_DIR/deploy/backup.mjs >> $APP_DIR/backups/backup.log 2>&1" ) | crontab -

echo "Done. Logs: pm2 logs monetra-api"
