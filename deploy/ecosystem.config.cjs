/**
 * PM2 process manager configuration for Kwalify (self-hosted).
 *
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup      # persist + start-on-reboot
 *   pm2 logs kwalify
 *
 * Secrets: prefer loading a production env file into the shell before
 * `pm2 start` (e.g. `set -a; . /etc/kwalify/kwalify.env; set +a`) rather than
 * hard-coding secrets here. The non-secret defaults below are safe to commit.
 */
module.exports = {
  apps: [
    {
      name: "kwalify",
      script: "backend/dist/server.js",
      cwd: __dirname + "/..",
      instances: 1, // single instance; the app parallelises internally via worker threads
      exec_mode: "fork",

      // Graceful shutdown: PM2 sends SIGINT, waits kill_timeout, then SIGKILL.
      // Must stay above the app's 100s shutdown grace (docs/OPERATIONS.md §4).
      kill_timeout: 110000,
      wait_ready: false,
      listen_timeout: 20000,

      // Restart policy — avoid tight crash loops.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      exp_backoff_restart_delay: 200,

      // Restart if memory blows past a ceiling (tune to host RAM).
      max_memory_restart: "3G",

      env: {
        NODE_ENV: "production",
        // Recommended beta worker/concurrency defaults (override via real env file):
        V3_PARALLEL_CANDIDATES: "true",
        V3_PARALLEL_WORKERS: "4",
        GENERATE_CONCURRENCY_LIMIT: "2",
        EVAL_ADMIN_ENABLED: "false",
      },

      // Log management.
      time: true,
      merge_logs: true,
      out_file: "/var/log/kwalify/out.log",
      error_file: "/var/log/kwalify/error.log",
    },
  ],
};
