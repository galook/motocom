export type RecentRoom = {
  code: string;
  name: string;
  visitedAt: number;
};

const STORAGE_KEY = "motocom.recent-rooms.v1";
const MAX_RECENT_ROOMS = 6;

function normalizeRoom(room: RecentRoom): RecentRoom | null {
  const code = room.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = room.name.trim();
  if (!code || !Number.isFinite(room.visitedAt)) {
    return null;
  }
  return {
    code,
    name: name || `Room ${code}`,
    visitedAt: room.visitedAt,
  };
}

export function getRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((room) => normalizeRoom(room as RecentRoom))
      .filter((room): room is RecentRoom => Boolean(room))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, MAX_RECENT_ROOMS);
  } catch {
    return [];
  }
}

export function rememberRecentRoom(code: string, name: string): RecentRoom[] {
  if (typeof window === "undefined") {
    return [];
  }

  const normalized = normalizeRoom({ code, name, visitedAt: Date.now() });
  if (!normalized) {
    return getRecentRooms();
  }

  const next = [
    normalized,
    ...getRecentRooms().filter((room) => room.code !== normalized.code),
  ].slice(0, MAX_RECENT_ROOMS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function forgetRecentRoom(code: string): RecentRoom[] {
  if (typeof window === "undefined") {
    return [];
  }
  const normalizedCode = code.trim().toUpperCase();
  const next = getRecentRooms().filter((room) => room.code !== normalizedCode);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
