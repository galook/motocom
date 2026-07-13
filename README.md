# Motocom Synchronized Soundboard

Nuxt + Convex app for synchronized motorcycle group sound requests.

## Features
- Private room create/join with per-room authorization tokens stored only as hashes.
- Main-driver role claim via salted PBKDF2 PIN verification and attempt lockout.
- 2-column sound button grid with multiple rows.
- FIFO request queue (max 20) with auto-promotion.
- Main-driver accept/reject flow and outcome sounds.
- Presence heartbeat and active/inactive participant state.
- Event playback sync excluding local sender/resolver audio.
- Upload sources can be audio (`.m4a` included) or video (`.mov/.mp4`), using the media audio track for playback.
- Upload size/duration limits, bounded playback/cache behavior, idempotent retries, and reference-aware media cleanup.
- Daily cleanup of rooms inactive for more than seven days.
- PWA enabled (service worker, installable manifest, iOS/Android home screen icons).

## Quick Start
1. Use Node 20 (`nvm use`).
2. Copy `.env.example` to `.env.local` and set Convex values.
3. Install deps: `npm install`.
4. Start Convex: `npm run convex:dev` (this regenerates `convex/_generated/*` with environment-specific types).
5. Start Nuxt: `npm run dev`.
6. Server-mapped dev mode for Apache (`motocom.aoo.cz -> :31900`): `npm run dev:motocom`.
7. Run tests: `npm run test` (coverage: `npm run test:coverage`).
8. Run static type checking: `npm run typecheck`.
9. One-command production deploy + build + run on port `31899`: `npm run prod`.
10. Apache-targeted production start (`moto.aoo.cz -> :31899`): `npm run prod:moto`.
11. `npm run prod` runs `convex deploy` first, so ensure Convex auth/deploy credentials are configured in the environment.

## PWA Usage
- Open the app in browser and use `Add to Home Screen` / `Install app`.
- The app ships a generated service worker and web app manifest.

## Phone Testing (Local LAN)
- If your phone can open Nuxt but create/join times out, `CONVEX_URL` is likely using loopback (`127.0.0.1` or `localhost`).
- The app now auto-rewrites loopback `CONVEX_URL` to a detected LAN IPv4 at startup.
- Upload/playback URLs returned as loopback are also auto-rewritten on the client for phone compatibility.
- Set `CONVEX_URL` in `.env.local` to your laptop LAN IP and Convex port (example: `http://192.168.1.42:3210`), then restart both `npm run convex:dev` and `npm run dev`.
- The app now surfaces this misconfiguration directly in UI and fails fast instead of spinning forever.

## Docs
- [Plan](/Users/galook/Coding/galook/motocom/docs/PLAN.md)
- [Implementation Checklist](/Users/galook/Coding/galook/motocom/docs/IMPLEMENTATION.md)
- [Deployment](/Users/galook/Coding/galook/motocom/docs/DEPLOYMENT.md)
- [QA](/Users/galook/Coding/galook/motocom/docs/QA.md)
