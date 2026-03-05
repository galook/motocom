import type { RoomEvent } from "../types/soundboard";

export function latestSeq(events: RoomEvent[]): number {
  return events[events.length - 1]?.seq ?? 0;
}

export function freshEvents(events: RoomEvent[], lastSeq: number): RoomEvent[] {
  return events.filter((event) => event.seq > lastSeq);
}
