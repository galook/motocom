import { describe, expect, it } from "vitest";
import { generateSessionId, resolveSessionId } from "../utils/session";

describe("session utilities", () => {
  it("uses crypto random uuid when provided", () => {
    const id = generateSessionId(() => "uuid-value");
    expect(id).toBe("uuid-value");
  });

  it("falls back to generated prefix when random uuid is unavailable", () => {
    const id = generateSessionId();
    expect(id.startsWith("s_")).toBe(true);
  });

  it("uses stored session id when available", () => {
    expect(resolveSessionId("stored", () => "new")).toBe("stored");
  });

  it("creates new session id when no stored value exists", () => {
    expect(resolveSessionId(null, () => "new-id")).toBe("new-id");
  });
});
