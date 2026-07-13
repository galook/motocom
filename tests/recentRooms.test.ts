// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetRecentRoom,
  getRecentRooms,
  rememberRecentRoom,
} from "../utils/recentRooms";

describe("recent room utilities", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores normalized rooms with most recent first", () => {
    rememberRecentRoom(" abc123 ", " Morning ride ");
    rememberRecentRoom("xyz789", "Evening ride");

    expect(getRecentRooms().map((room) => room.code)).toEqual(["XYZ789", "ABC123"]);
    expect(getRecentRooms()[1]?.name).toBe("Morning ride");
  });

  it("updates an existing room without duplicating it", () => {
    rememberRecentRoom("ABC123", "Old name");
    rememberRecentRoom("ABC123", "New name");

    expect(getRecentRooms()).toHaveLength(1);
    expect(getRecentRooms()[0]?.name).toBe("New name");
  });

  it("forgets a selected room", () => {
    rememberRecentRoom("ABC123", "Morning ride");
    rememberRecentRoom("XYZ789", "Evening ride");

    const remaining = forgetRecentRoom("abc123");

    expect(remaining.map((room) => room.code)).toEqual(["XYZ789"]);
  });
});
