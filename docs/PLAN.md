# Nuxt + Convex Synchronized Soundboard

## Summary
A Nuxt web app backed by Convex that synchronizes ride-room sound requests across active participants. Riders trigger sounds through a two-column grid. Main drivers accept or reject the active request, which emits outcome sounds to other active phones.

## Architecture
- Frontend: Nuxt 3 + Vue 3 (`pages`, `components`, `composables`).
- Backend: Convex schema, queries, mutations, scheduled cleanup, and file storage.
- Authorization: server-issued per-room participant tokens are stored only as SHA-256 hashes. Public room DTOs expose participant document IDs, never credentials.
- Main-driver PINs: PBKDF2-SHA256 with per-room salts, constant-time comparison, failed-attempt tracking, and temporary lockout.
- Real-time sync: separate room-state and presence subscriptions plus ordered event-sequence playback.
- Reliability: mutation operation IDs make room creation, request enqueue, and button creation safe to retry after an uncertain timeout.

## Core Flows
1. Room lifecycle:
   - Create a room with an generated invitation code, name, PIN, and display name.
   - The client creates a high-entropy participant token before the mutation so retries are idempotent.
   - Join a room by entering its code and display name.
   - Claim main-driver privileges with the room PIN.
2. Request lifecycle:
   - Any authorized room participant can enqueue an enabled button request.
   - If no request is active, it becomes active and emits `request_started`.
   - Otherwise it enters the FIFO queue, capped at 20.
   - A main driver resolves the active request as `accepted` or `rejected`.
   - The next valid queued request is promoted automatically.
3. Presence:
   - Clients send a heartbeat every 20 seconds.
   - A participant is active while `lastSeenAt <= 120s`.
   - Presence is queried separately so heartbeats do not rebuild media URLs and event state.
4. Media:
   - Main drivers may upload supported audio or video files up to 8 MB and 20 seconds.
   - Playback is capped at 8 seconds and stale queued events expire after 5 seconds.
   - Replaced, deleted, or abandoned media is deleted only when no room, button, or template references it.
5. Retention:
   - A daily bounded cleanup removes rooms inactive for more than seven days.
   - Shared template media is preserved through reference checks.

## Convex Function Contracts
| Function | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `rooms.createRoom` | mutation | `{ roomCode, roomName, displayName, mainDriverPin, participantToken, operationId }` | `{ roomId, participantId, participantToken, replayed }` | Idempotent creator/main-driver flow |
| `rooms.joinRoom` | mutation | `{ roomCode, displayName, participantToken? }` | `{ roomId, participantId, participantToken, isMainDriver }` | Reuses a supplied token or creates one |
| `rooms.claimMainDriver` | mutation | `{ roomId, pin, participantToken }` | `{ granted }` | Rate-limited PIN elevation |
| `rooms.heartbeat` | mutation | `{ roomId, participantToken, audioUnlocked }` | `{ ok }` | Authorized presence update |
| `rooms.getRoomState` | query | `{ roomCode, participantToken? }` | `RoomState | null` | Static state, queue, events, and caller role |
| `rooms.getRoomPresence` | query | `{ roomCode }` | `Participant[]` | Public participant IDs and presence only |
| `requests.enqueueRequest` | mutation | `{ roomId, buttonId, participantToken, operationId }` | `{ requestId, status, replayed }` | Idempotent active-or-queue operation |
| `requests.resolveActiveRequest` | mutation | `{ roomId, decision, participantToken }` | `{ resolvedRequestId, nextActiveRequestId? }` | Main-driver only; first decision wins |
| `buttons.createButton` | mutation | `{ roomId, label, fileStorageId, sortOrder?, participantToken, operationId }` | `{ buttonId, replayed }` | Main-driver only; validates stored media |
| `buttons.updateButton` | mutation | `{ roomId, buttonId, label?, fileStorageId?, sortOrder?, isEnabled?, participantToken }` | `{ ok }` | Cleans unreferenced replaced media |
| `buttons.deleteButton` | mutation | `{ roomId, buttonId, participantToken }` | `{ ok }` | Refuses active or queued references |
| `buttons.setOutcomeSounds` | mutation | `{ roomId, acceptStorageId, rejectStorageId, participantToken }` | `{ ok }` | Supports replace or clear semantics |
| `buttons.listTemplates` | query | `{ ownerToken }` | `RoomTemplateSummary[]` | Owner token is hashed before lookup |
| `buttons.saveRoomAsTemplate` | mutation | `{ roomId, participantToken, ownerToken, templateName }` | template result | Main-driver authorization plus private ownership |
| `buttons.applyTemplateToRoom` | mutation | `{ roomId, templateId, participantToken, ownerToken }` | `{ appliedButtonCount }` | Full button and outcome-sound replacement |
| `buttons.deleteTemplate` | mutation | `{ templateId, ownerToken }` | `{ ok }` | Deletes unreferenced template media |
| `uploads.generateUploadUrl` | mutation | `{ roomId, participantToken }` | `{ uploadUrl }` | Main-driver only |
| `uploads.discardUnattachedUpload` | mutation | `{ roomId, participantToken, storageId }` | `{ deleted }` | Deletes only unreferenced storage |

## Data Model
- `rooms`: code/name, idempotency key, salted PIN hash metadata, lockout state, outcome sounds, timestamps.
- `participants`: room ID, hashed authorization token, display name, role, and presence state. A legacy optional session field remains only for migration compatibility.
- `buttons`: room ID, sound storage ID, ordering, enabled state, and optional idempotency key.
- `templates` / `template_buttons`: hashed owner token and reusable soundboard configuration.
- `requests`: public participant ID, optional operation ID, status, activation, and resolution timestamps.
- `events`: ordered room sequence and public actor participant ID.
- `room_state`: active request pointer and next event sequence.

## UI Structure
- `pages/index.vue`: private room creation and manual code join.
- `pages/room/[code].vue`: room dashboard with separate room-state and presence subscriptions.
- `components/SoundGrid.vue`: two-column large-button grid and result feedback.
- `components/ActiveRequestPanel.vue`: active request and main-driver decision controls.
- `components/MainDriverPanel.vue`: bounded uploads, button management, outcome sounds, and templates.
- `components/PresenceList.vue`: active and inactive participants using public IDs.
- `composables/useSessionId.ts`: rotated private owner token for templates.
- `composables/usePresence.ts`: authorized heartbeat.
- `composables/useAudioUnlock.ts`: browser audio unlock, bounded cache, expiry, and playback cap.
- `composables/useEventPlayback.ts`: ordered remote-event playback and local-actor exclusion.

## Acceptance Criteria
1. No public response contains a participant authorization token, token hash, PIN hash, or owner token.
2. Request-start audio plays only on other active phones.
3. Outcome audio plays only on other active phones, not the resolver.
4. Queue ordering is FIFO with a hard cap of 20.
5. A button cannot be deleted while an active or queued request references it.
6. Retrying room creation, button creation, or enqueue with the same operation ID does not duplicate data.
7. Presence becomes inactive after 120 seconds without a heartbeat.
8. Event history is capped at 50.
9. Stale locked-audio events are discarded rather than replayed later.
10. Expired room cleanup never deletes media still referenced by a room, button, or template.
