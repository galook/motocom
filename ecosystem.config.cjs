const path = require("node:path");

const appRoot = process.env.APP_ROOT || __dirname;
const deployRoot = process.env.DEPLOY_ROOT || "/home/ubuntu/.deploy/motocom";
const deployEnvFile = process.env.DEPLOY_ENV_FILE || path.join(deployRoot, ".env.production");

module.exports = {
  apps: [
    {
      name: "motocom-backend",
      script: path.join(appRoot, "scripts/run-convex-local.sh"),
      cwd: appRoot,
      interpreter: "bash",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "600M",
      kill_timeout: 15000,
      min_uptime: "10s",
      max_restarts: 10,
      env: {
        APP_ROOT: appRoot,
        DEPLOY_ROOT: deployRoot,
        DEPLOY_ENV_FILE: deployEnvFile,
        NODE_ENV: "production",
      },
    },
    {
      name: "motocom-app",
      script: path.join(appRoot, "scripts/run-production.sh"),
      cwd: appRoot,
      interpreter: "bash",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "350M",
      kill_timeout: 10000,
      min_uptime: "10s",
      max_restarts: 10,
      env: {
        APP_ROOT: appRoot,
        DEPLOY_ROOT: deployRoot,
        DEPLOY_ENV_FILE: deployEnvFile,
        NODE_ENV: "production",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: "31899",
        PORT: "31899",
      },
    },
  ],
};
