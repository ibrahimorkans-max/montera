#!/usr/bin/env bash
# Pull the latest code and restart the API. Run on the server:
#   cd /var/www/monetra && bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

node deploy/backup.mjs        # safety copy before changing anything
git pull --ff-only
cd apps/api
npm ci --omit=dev
pm2 reload ecosystem.config.cjs
sleep 2
curl -fsS http://127.0.0.1:4000/health && echo && echo "Updated."
