# Deployment Notes

## Runtime Requirements
- Node `20.x` (see `.nvmrc`).
- npm as package manager.
- PM2 managed by the existing `pm2-ubuntu.service`.
- Apache with TLS and reverse-proxy modules enabled.

## Environment Variables
For local development, create `.env.local` from `.env.example` and set:
- `CONVEX_URL`: Convex deployment URL used by Nuxt.
- `CONVEX_DEPLOYMENT`: Convex deployment name for CLI operations.
- `CONVEX_SITE_URL`: Convex HTTP actions URL when using the local backend.
- `CONVEX_PUBLIC_URL` (optional): public Convex base URL override.

Production secrets and deployment selection are stored outside Git at:

```text
/home/ubuntu/.deploy/motocom/.env.production
```

Permissions must remain `0600`.

## Local Setup
1. `npm install`
2. `npm run convex:dev` in one terminal.
3. `npm run dev` in another terminal.

## Local Multi-Phone Setup
- Do not use loopback Convex URLs (`http://127.0.0.1:*` or `http://localhost:*`) when testing from phones.
- Set `CONVEX_URL` to a LAN-reachable host, for example `http://192.168.1.42:3210`.
- Restart both Nuxt and Convex after changing environment variables.

## Production Topology
- Public app: `https://moto.aoo.cz`
- Nuxt listener: `127.0.0.1:31899`
- Convex API/WebSocket listener: `127.0.0.1:3210`
- Convex HTTP actions listener: `127.0.0.1:3211`
- Apache proxies `/convex/` to Convex and all other requests to Nuxt.
- Persistent local Convex data is stored outside releases at:

```text
/home/ubuntu/.deploy/motocom/convex-state
```

## PM2 Processes
- `motocom-app`: production Nuxt/Nitro server.
- `motocom-backend`: persistent local Convex backend and function synchronizer.
- `motocom-deploy-watcher`: polls `origin/main` every 60 seconds and deploys new commits.

PM2 state is saved with `pm2 save`, and the server-wide `pm2-ubuntu.service` restores it after reboot.

## Immutable Autodeploy
`scripts/auto-deploy.sh` performs the following:

1. Fetches `origin/main`.
2. Creates an immutable release under `/home/ubuntu/.deploy/motocom/releases/<commit>`.
3. Links the persistent Convex state and production environment into the release.
4. Runs `npm ci`, tests, typecheck, audit, and the production build under Node 20.
5. Creates a consistent SQLite backup of Convex state.
6. Deploys Convex functions.
7. Atomically switches the `current` symlink.
8. Restarts the two PM2 production processes.
9. Verifies both the Nuxt and Convex health endpoints.
10. Rolls back to the prior release when startup or health verification fails.

The latest five releases and five Convex backups are retained.

## Manual Deployment

```bash
cd /home/ubuntu/motocom
npm run deploy:now
```

## Autodeploy Operations

```bash
pm2 status motocom-app motocom-backend motocom-deploy-watcher
pm2 logs motocom-deploy-watcher --lines 100
pm2 logs motocom-app --lines 100
pm2 logs motocom-backend --lines 100
```

To pause autodeploy:

```bash
pm2 stop motocom-deploy-watcher
```

To resume it:

```bash
pm2 restart motocom-deploy-watcher
pm2 save --force
```

## Operational Notes
- Keep room PINs secret and share them only with trusted main drivers.
- Upload compressed, mobile-friendly audio to reduce playback latency.
- Real-device mobile testing remains necessary because browser autoplay behavior differs by device.
- Back up `/home/ubuntu/.deploy/motocom/convex-state` before server migrations.
