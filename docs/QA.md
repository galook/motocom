# Multi-Client QA Checklist

## Preconditions
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
