export type Decision = "accepted" | "rejected";
export type ButtonVisualState = "idle" | "pending" | Decision;

export interface RoomButton {
  id: string;
  label: string;
  sortOrder: number;
  isEnabled: boolean;
  soundUrl: string | null;
}

export interface ActiveRequest {
  id: string;
  buttonId: string;
  buttonLabel: string;
  requestedBySessionId: string;
  createdAt: number;
  activatedAt: number | null;
}

export interface QueueRequest {
  id: string;
  buttonId: string;
  buttonLabel: string;
  requestedBySessionId: string;
  createdAt: number;
}

export interface Participant {
  sessionId: string;
  displayName: string;
  isMainDriver: boolean;
  lastSeenAt: number;
  isActive: boolean;
}

export interface RoomEvent {
  seq: number;
  type: "request_started" | "request_resolved";
  requestId: string;
  buttonId: string | null;
  decision: Decision | null;
  actorSessionId: string;
  createdAt: number;
}

export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
  };
  buttons: RoomButton[];
  activeRequest: ActiveRequest | null;
  queue: QueueRequest[];
  participants: Participant[];
  outcomeSounds: {
    acceptUrl: string | null;
    rejectUrl: string | null;
  };
  isMainDriver: boolean;
  events: RoomEvent[];
}

export interface ActiveRoomSummary {
  id: string;
  code: string;
  name: string;
  activeParticipants: number;
  lastActivityAt: number;
}
