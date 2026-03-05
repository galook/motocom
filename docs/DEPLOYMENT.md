# Deployment Notes

## Runtime Requirements
- Node `20.x` (see `.nvmrc`).
- npm as package manager.

## Environment Variables
Create `.env.local` from `.env.example` and set:
- `CONVEX_URL`: Convex deployment URL used by Nuxt client.
- `CONVEX_DEPLOYMENT`: Convex deployment name for CLI operations.

## Local Setup
1. `npm install`
2. `npm run convex:dev` (in one terminal) to run Convex backend and codegen.
3. `npm run dev` (in another terminal) to run Nuxt.

## Local Multi-Phone Setup
- Do not use loopback Convex URLs (`http://127.0.0.1:*` or `http://localhost:*`) when testing from phones.
- Set `CONVEX_URL` in `.env.local` to a LAN-reachable host, usually your laptop IP, for example:
  - `CONVEX_URL=http://192.168.1.42:3210`
- Restart both Nuxt and Convex after changing environment variables.
- Symptom of wrong URL: page opens on phone but create/join appears to load forever (now surfaced as timeout with actionable message).

## Production Build
1. `npm run build`
2. `npm run convex:deploy`
3. Deploy Nuxt output according to hosting target (`npm run preview` for smoke test).

## Operational Notes
- Keep room PIN secret and share only with trusted main drivers.
- Upload compressed/mobile-friendly audio files to reduce playback latency.
- Real-device mobile testing is required because autoplay behavior differs by browser.
