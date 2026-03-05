# Implementation Checklist

## Status Key
- `[ ] [TODO]` not started
- `[ ] [IN_PROGRESS]` currently being worked
- `[x] [DONE]` completed in repository
- `[ ] [BLOCKED]` blocked by missing dependency/tooling/external requirement

## Checklist
- [x] [DONE] Scaffold Nuxt app and Convex project wiring.
- [x] [DONE] Configure Convex Nuxt module and runtime env.
- [x] [DONE] Define schema, indexes, and validators.
- [x] [DONE] Implement room create/join/main-driver claim flows.
- [x] [DONE] Implement heartbeat/presence timeout logic (120s).
- [x] [DONE] Implement button upload/manage mutations (main-driver only).
- [x] [DONE] Implement request enqueue + queue cap (20) logic.
- [x] [DONE] Implement resolve flow with first-main-driver-wins semantics.
- [x] [DONE] Implement auto-start next queued request.
- [x] [DONE] Implement event stream (seq) + event retention (50).
- [x] [DONE] Build 2-column multi-row large-button UI.
- [x] [DONE] Add blink state sync for active request.
- [x] [DONE] Add audio unlock UX and playback queue.
- [x] [DONE] Exclude sender from request playback and resolver from outcome playback.
- [x] [DONE] Add history panel and participant status UI.
- [x] [DONE] Add authz/error states and user-facing feedback.
- [x] [DONE] Add unit/integration tests for core mutation support logic.
- [x] [DONE] Add multi-client manual test script and QA checklist.
- [x] [DONE] Add deployment docs and environment setup notes.
- [x] [DONE] Add mobile connectivity timeout + actionable loopback Convex diagnostics.

## Progressive Log
- [x] [DONE] Created Nuxt + Convex app scaffold files and runtime config.
- [x] [DONE] Added Convex schema, helper utilities, and public functions.
- [x] [DONE] Added room dashboard UI and synchronization composables.
- [x] [DONE] Added main-driver sound management UI and uploads.
- [x] [DONE] Added docs, tests, and manual QA/deployment guides.
- [x] [DONE] Expanded tests to composables, Convex helper workflows, and interactive Vue components (58 passing tests).
- [x] [DONE] Added mutation timeout protection and loopback/LAN connectivity hints to avoid infinite loading on phones.
- [x] [DONE] Hardened iOS audio reliability by reusing one unlocked player with sequential playback, timeouts, and retry handling.
- [x] [DONE] Made accept/reject button glow feedback transient (auto-resets to idle after a few seconds).
- [x] [DONE] Configured Nuxt PWA support with manifest, service worker, and installable icons.
- [x] [DONE] Added one-command production script to build and run Nitro on port 31899.
- [x] [DONE] Updated one-command production script to deploy Convex, then build and run Nitro on port 31899.
