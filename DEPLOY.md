# Deploying the Monetra API

The API is a Node.js app with its own SQLite database file. It needs a server that can run Node.js 22.5 or newer, such as a small Ubuntu VPS (DigitalOcean, Hetzner, Hostinger VPS, AWS Lightsail…). Ordinary cPanel/PHP shared hosting cannot run it.

The API imports `packages/shared`, so always deploy the **whole repository**, not only `apps/api`.

## Option A: Ubuntu VPS (recommended)

1. Point the domain at the VPS: in your DNS, set the **A record** for `monetra` (monetra.zhtrader.com) to the VPS IP, and delete any **AAAA** record for it.
2. On the server:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo mkdir -p /var/www && sudo chown $USER /var/www
git clone https://github.com/ibrahimorkans-max/montera.git /var/www/monetra
cd /var/www/monetra && bash deploy/setup.sh monetra.zhtrader.com
```

`deploy/setup.sh` installs Node 22, Nginx and PM2, installs the API packages, creates `apps/api/.env` with a random `JWT_SECRET`, starts the API under PM2 (restarts on crash and on reboot), configures Nginx for your domain and schedules a daily database backup.

3. Turn on HTTPS (free):

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d monetra.zhtrader.com
```

4. Check: `https://monetra.zhtrader.com/health` should show `{"ok":true,...}`.


## Live address

The app's release builds talk to **https://monetra.zhtrader.com** (`PRODUCTION_API_URL` in `apps/mobile/src/lib/api.ts`). Development builds use `http://localhost:4000`. `EXPO_PUBLIC_API_URL` overrides both.

## Option B: Hostinger web hosting with Node.js apps (no VPS)

monetra.zhtrader.com currently points at Hostinger web hosting (LiteSpeed). That hosting cannot run `deploy/setup.sh`, but some Hostinger plans can run a Node.js app from hPanel. If your hPanel offers it:

- Source: this GitHub repository, branch `main`, **root folder** of the repo (the root `package.json` installs and starts the API).
- Node.js version: **22** or newer (24 is fine). Older versions cannot run the built-in SQLite.
- Install command: `npm install` · Start command: `npm start` (no build step).
- Environment variables: `NODE_ENV=production`, `JWT_SECRET=` (a long random string), `DB_PATH=` a path in your account that is **outside** the deployed code folder, so redeploys do not wipe the database. Do not set `HOST` or `PORT`; the platform provides them.
- Domain: attach monetra.zhtrader.com to the Node.js app and enable SSL in hPanel.

Then open https://monetra.zhtrader.com/health. If your plan has no Node.js option, use a VPS (Option A above).

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
EXPO_PUBLIC_API_URL=https://monetra.zhtrader.com npx expo export --platform web   # web build in dist/
EXPO_PUBLIC_API_URL=https://monetra.zhtrader.com eas build -p android           # Android (needs an Expo account)
```

On Windows PowerShell, set the variable first: `$env:EXPO_PUBLIC_API_URL="https://monetra.zhtrader.com"`.

The app works offline and syncs with this server whenever it is online.

## Without the setup script (manual)

```bash
cd /var/www/monetra/apps/api
npm ci --omit=dev
cp .env.example .env && nano .env        # set JWT_SECRET and DB_PATH
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Then copy `deploy/nginx-monetra.conf` to `/etc/nginx/sites-available/monetra`, change the domain, enable it and reload Nginx.
