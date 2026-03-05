# Motocom Synchronized Soundboard

Nuxt + Convex app for synchronized motorcycle group sound requests.

## Features
- Room create/join with anonymous session IDs.
- Main-driver role claim via room PIN.
- 2-column sound button grid with multiple rows.
- FIFO request queue (max 20) with auto-promotion.
- Main-driver accept/reject flow and outcome sounds.
- Presence heartbeat and active/inactive participant state.
- Event playback sync excluding local sender/resolver audio.
- Upload sources can be audio (`.m4a` included) or video (`.mov/.mp4`), using the media audio track for playback.
- PWA enabled (service worker, installable manifest, iOS/Android home screen icons).

## Quick Start
1. Use Node 20 (`nvm use`).
2. Copy `.env.example` to `.env.local` and set Convex values.
3. Install deps: `npm install`.
4. Start Convex: `npm run convex:dev` (this regenerates `convex/_generated/*` with environment-specific types).
5. Start Nuxt: `npm run dev`.
6. Run tests: `npm run test` (coverage: `npm run test:coverage`).

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
