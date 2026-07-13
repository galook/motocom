const ROOM_TOKEN_PREFIX = "motocom.room-participant-token.v2.";

function storageKey(roomCode: string): string {
  return `${ROOM_TOKEN_PREFIX}${roomCode.trim().toUpperCase()}`;
}

export function getRoomParticipantToken(roomCode: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(storageKey(roomCode))?.trim() ?? "";
}

export function setRoomParticipantToken(roomCode: string, token: string): void {
  if (typeof window === "undefined" || !roomCode.trim() || !token.trim()) {
    return;
  }
  window.localStorage.setItem(storageKey(roomCode), token.trim());
}

export function clearRoomParticipantToken(roomCode: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(storageKey(roomCode));
}

export function createOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `op_${Date.now().toString(36)}_${random}`;
}

export function createClientSecretToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${createOperationId()}_${createOperationId()}`.replace(/[^a-zA-Z0-9]/g, "");
}
