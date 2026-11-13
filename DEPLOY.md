# Deploying the Monetra API

The API is a Node.js app with its own SQLite database file. It needs a server that can run Node.js 22.5 or newer, such as a small Ubuntu VPS (DigitalOcean, Hetzner, Hostinger VPS, AWS Lightsail…). Ordinary cPanel/PHP shared hosting cannot run it.

The API imports `packages/shared`, so always deploy the **whole repository**, not only `apps/api`.

## Quick setup (Ubuntu VPS)

1. Point your domain at the server: add a DNS **A record**, e.g. `api` → your VPS IP.
2. On the server:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo mkdir -p /var/www && sudo chown $USER /var/www
git clone https://github.com/ibrahimorkans-max/montera.git /var/www/monetra
cd /var/www/monetra && bash deploy/setup.sh api.yourdomain.com
```

`deploy/setup.sh` installs Node 22, Nginx and PM2, installs the API packages, creates `apps/api/.env` with a random `JWT_SECRET`, starts the API under PM2 (restarts on crash and on reboot), configures Nginx for your domain and schedules a daily database backup.

3. Turn on HTTPS (free):

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

4. Check: `https://api.yourdomain.com/health` should show `{"ok":true,...}`.

## Settings — `apps/api/.env`

| Name | Meaning |
| --- | --- |
| `NODE_ENV` | `production`. The API refuses to start in production without `JWT_SECRET`. |
| `JWT_SECRET` | Long random string that signs logins. Keep it secret and never change it casually (everyone gets logged out). |
| `PORT` / `HOST` | Where the API listens. Defaults: `4000`, and `127.0.0.1` so it is only reachable through Nginx. |
| `DB_PATH` | The SQLite database file, e.g. `/var/www/monetra/data/monetra.db`. |

See `apps/api/.env.example`. After editing: `pm2 restart monetra-api`.

## Everyday commands

```bash
pm2 logs monetra-api            # live logs
pm2 status                      # is it running?
bash deploy/update.sh           # back up, pull latest code, reinstall, restart
node deploy/backup.mjs          # backup now (kept in /var/www/monetra/backups, newest 14)
```

To restore a backup: `pm2 stop monetra-api`, copy the backup file over `DB_PATH`, delete any `monetra.db-wal` / `-shm` next to it, `pm2 start monetra-api`.

Copy the `backups` folder off the server regularly (e.g. download with WinSCP or sync to cloud storage). A backup on the same disk does not survive the server being lost.

## First account

Do **not** run `npm run seed` on the live server: it creates a demo account with a published password. The first owner signs up from the app; that creates the business account.

## Connecting the app

Build the app with the live address:

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://api.yourdomain.com npx expo export --platform web   # web build in dist/
EXPO_PUBLIC_API_URL=https://api.yourdomain.com eas build -p android           # Android (needs an Expo account)
```

On Windows PowerShell, set the variable first: `$env:EXPO_PUBLIC_API_URL="https://api.yourdomain.com"`.

The app works offline and syncs with this server whenever it is online.

## Without the setup script (manual)

```bash
cd /var/www/monetra/apps/api
npm ci --omit=dev
cp .env.example .env && nano .env        # set JWT_SECRET and DB_PATH
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Then copy `deploy/nginx-monetra.conf` to `/etc/nginx/sites-available/monetra`, change the domain, enable it and reload Nginx.
