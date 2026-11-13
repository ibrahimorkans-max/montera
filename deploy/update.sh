#!/usr/bin/env bash
# Pull the latest code and restart the API. Run on the server:
#   cd /var/www/monetra && bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

node deploy/backup.mjs || echo "(no database to back up yet)"   # safety copy before changing anything
git pull --ff-only
cd apps/api
npm ci --omit=dev
pm2 reload ecosystem.config.cjs
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health; then echo; echo "Updated."; exit 0; fi
  sleep 1
done
echo "The API did not come back. Check: pm2 logs monetra-api --lines 40"
exit 1
