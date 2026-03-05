# Nuxt + Convex Synchronized Soundboard

## Summary
A Nuxt web app backed by Convex that synchronizes ride-room sound requests across active participants. Riders trigger sounds through a 2-column grid. Main drivers accept/reject the active request, which emits outcome sounds to other active phones.

## Architecture
- Frontend: Nuxt 3 + Vue 3 (`pages`, `components`, `composables`).
- Backend: Convex schema + public mutations/queries.
- Storage: Convex file storage for button sounds and global accept/reject outcome sounds.
- Real-time sync: `useConvexQuery` state subscription + event sequence playback on clients.

## Core Flows
1. Room lifecycle:
   - Create room with code, name, PIN, display name.
   - Join room anonymously with display name.
   - Claim main driver role by PIN.
2. Request lifecycle:
   - Any room participant enqueues button request.
   - If no active request, it becomes active and emits `request_started` event.
   - Else request enters FIFO queue (max 20).
   - Main driver resolves active request (`accepted`/`rejected`) and emits `request_resolved`.
   - Next queued request auto-promotes and emits another `request_started`.
3. Presence:
   - Client heartbeat every 20 seconds.
   - Participant active state is `lastSeenAt <= 120s`.

## Convex Function Contracts
| Function | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `rooms.createRoom` | mutation | `{ roomCode, roomName, displayName, mainDriverPin, sessionId }` | `{ roomId, participantId }` | Creator becomes main driver |
| `rooms.joinRoom` | mutation | `{ roomCode, displayName, sessionId }` | `{ roomId, participantId, isMainDriver }` | Anonymous join |
| `rooms.claimMainDriver` | mutation | `{ roomId, pin, sessionId }` | `{ granted: boolean }` | Role elevation by room PIN |
| `rooms.heartbeat` | mutation | `{ roomId, sessionId, audioUnlocked }` | `{ ok: true }` | Presence update |
| `rooms.getRoomState` | query | `{ roomCode, sessionId? }` | `RoomState \| null` | Includes buttons, active/queue, participants, events |
| `rooms.listRecentEvents` | query | `{ roomId }` | `RoomEvent[]` | Last 50 events |
| `requests.enqueueRequest` | mutation | `{ roomId, buttonId, sessionId }` | `{ requestId, status }` | Active-or-queue with cap 20 |
| `requests.resolveActiveRequest` | mutation | `{ roomId, decision, sessionId }` | `{ resolvedRequestId, nextActiveRequestId? }` | Main-driver only, first decision wins |
| `buttons.createButton` | mutation | `{ roomId, label, fileStorageId, sortOrder?, sessionId }` | `{ buttonId }` | Main-driver only |
| `buttons.updateButton` | mutation | `{ roomId, buttonId, label?, fileStorageId?, sortOrder?, isEnabled?, sessionId }` | `{ ok: true }` | Main-driver only |
| `buttons.deleteButton` | mutation | `{ roomId, buttonId, sessionId }` | `{ ok: true }` | Main-driver only |
| `buttons.setOutcomeSounds` | mutation | `{ roomId, acceptStorageId, rejectStorageId, sessionId }` | `{ ok: true }` | Global outcome sounds |
| `uploads.generateUploadUrl` | mutation | `{ roomId, sessionId }` | `{ uploadUrl }` | Main-driver only |

## Data Model
- `rooms`: `code`, `name`, `mainDriverPinHash`, `acceptSoundStorageId`, `rejectSoundStorageId`, `createdAt`
- `participants`: `roomId`, `sessionId`, `displayName`, `isMainDriver`, `lastSeenAt`, `audioUnlocked`, `joinedAt`
- `buttons`: `roomId`, `label`, `soundStorageId`, `sortOrder`, `isEnabled`, `createdAt`, `updatedAt`
- `requests`: `roomId`, `buttonId`, `requestedBySessionId`, `status`, `createdAt`, `activatedAt`, `resolvedAt`, `resolvedBySessionId`
- `events`: `roomId`, `seq`, `type`, `requestId`, `buttonId`, `decision`, `actorSessionId`, `createdAt`
- `room_state`: `roomId`, `activeRequestId`, `nextSeq`

## UI Structure
- `pages/index.vue`: create/join room.
- `pages/room/[code].vue`: room dashboard.
- `components/SoundGrid.vue`: 2-column multi-row large buttons + blink active.
- `components/ActiveRequestPanel.vue`: active request and resolve actions.
- `components/MainDriverPanel.vue`: button and sound management.
- `components/PresenceList.vue`: active/inactive participants.
- `composables/useSessionId.ts`: anonymous persistent session.
- `composables/usePresence.ts`: heartbeat.
- `composables/useAudioUnlock.ts`: browser audio unlock.
- `composables/useEventPlayback.ts`: ordered event playback and local-event exclusion.

## Acceptance Criteria
1. Request start plays only on other active phones (not sender).
2. Resolve outcome sound plays only on other active phones (not resolver).
3. Queue is FIFO with hard cap 20.
4. First main-driver decision resolves request.
5. Next queued request auto-activates.
6. Presence flips inactive after 120 seconds without heartbeat.
7. Event history shows max 50.
