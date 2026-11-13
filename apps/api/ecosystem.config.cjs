// PM2 process file. Settings and secrets live in apps/api/.env (copy .env.example), not here.
// Start:   pm2 start ecosystem.config.cjs && pm2 save
// Restart: pm2 restart monetra-api
module.exports = {
  apps: [
    {
      name: 'monetra-api',
      cwd: __dirname,
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/server.ts',
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      // One process only: SQLite is a single file and the recurring-invoice timer must not run twice.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 6000,
      time: true,
    },
  ],
};
