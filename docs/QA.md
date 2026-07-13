# Quality Assurance

## Automated end-to-end suite

The Playwright suite runs the real Nuxt application against a disposable self-hosted Convex database. It never reads or mutates production records: only the Convex instance credentials and backend binary are reused, while SQLite data, file storage, ports, and the deployed functions are isolated under `.e2e/runtime`.

### Commands

```bash
# Install the matching browser once
npx playwright install chromium

# Full desktop + Pixel 7 matrix
npm run test:e2e

# Individual projects
npm run test:e2e:desktop
npm run test:e2e:mobile

# Interactive Playwright UI
npm run test:e2e:ui

# Unit, type, and full browser suite
npm run test:all
```

Playwright writes failure screenshots, videos, and traces to `test-results/e2e-artifacts`, an HTML report to `playwright-report`, and JUnit XML to `test-results/e2e-junit.xml`. All generated output and disposable Convex state are ignored by Git.

### Automated coverage

The suite currently contains 62 scenarios, executed on desktop Chromium and a Pixel 7 profile for 124 browser tests. It covers:

- landing-page modes, validation, query-code invitations, persistence, recent rooms, keyboard use, and PWA installation;
- room creation, joining, audio unlock, copying/sharing, invalid rooms, volume and density persistence;
- real multi-context rider presence, active requests, FIFO queues, accept/reject decisions, and exclusive main-driver handover;
- valid audio upload, invalid and oversized media, signal create/edit/disable/delete, decision sounds, search, and templates;
- custom confirmation-dialog cancel/confirm flows, focus trapping, focus restoration, and Escape handling;
- WCAG 2 A/AA, WCAG 2.1 A/AA, and Axe best-practice checks across all main states and control-center tabs;
- minimum touch targets, horizontal-overflow detection, responsive layout, status text that does not rely on color;
- manifest, service worker, icons, mobile metadata, scoped participant tokens, and prevention of secret leakage into the DOM or URL;
- uncaught browser errors, with traces/video/screenshots retained automatically on failures.

## Manual multi-client checklist

### Preconditions
- At least 3 phones/devices on same room code.
- One device has main-driver role.
- Outcome sounds and at least 2 request buttons configured.

## Functional Scenarios
1. Room create/join:
   - Create a room and join from two additional devices.
   - Confirm participant list shows all devices.
2. Role control:
   - Enter wrong main-driver PIN and verify rejection.
   - Enter correct PIN and verify role upgrades.
3. Request synchronization:
   - Device A presses sound button.
   - Devices B/C hear sound and see blinking active button.
   - Device A should not auto-play its own request event.
4. Queue behavior:
   - While one request is active, enqueue additional requests.
   - Confirm FIFO ordering and queue length display.
   - Enqueue beyond 20 and verify explicit error.
5. Resolve behavior:
   - Main driver accepts/rejects active request.
   - Other devices hear outcome sound; resolver does not.
   - Next queued request auto-starts.
6. Presence:
   - Stop interaction on one device for >120 seconds.
   - Confirm it appears inactive in participant list.
7. History retention:
   - Trigger >50 events.
   - Confirm history view only keeps latest 50.

## Regression Notes
- Refresh a client and verify old historical events are not replayed as new sounds.
- Disable a button in main-driver panel and verify riders cannot enqueue it.
