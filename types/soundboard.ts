export type Decision = "accepted" | "rejected";
export type ButtonVisualState = "idle" | "pending" | Decision;

export interface RoomButton {
  id: string;
  label: string;
  sortOrder: number;
  isEnabled: boolean;
  soundUrl: string | null;
}

export interface RoomTemplateSummary {
  id: string;
  name: string;
  buttonCount: number;
  hasOutcomeSounds: boolean;
  updatedAt: number;
}

export interface ActiveRequest {
  id: string;
  buttonId: string;
  buttonLabel: string;
  requestedByParticipantId: string | null;
  createdAt: number;
  activatedAt: number | null;
}

export interface QueueRequest {
  id: string;
  buttonId: string;
  buttonLabel: string;
  requestedByParticipantId: string | null;
  createdAt: number;
}

export interface Participant {
  id: string;
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
  actorParticipantId: string | null;
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
  currentParticipantId: string | null;
  isMainDriver: boolean;
  events: RoomEvent[];
}
