import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildConnectivityHint,
  isLoopbackHost,
  rewriteLoopbackUrlForClient,
  runMutation,
  toErrorMessage,
} from "../utils/mutation";

afterEach(() => {
  vi.useRealTimers();
});

describe("runMutation", () => {
  it("returns plain mutation result", async () => {
    const mutate = async (args: { value: number }) => ({ ok: args.value + 1 });

    const result = await runMutation<{ value: number }, { ok: number }>(mutate, {
      value: 1,
    });

    expect(result).toEqual({ ok: 2 });
  });

  it("unwraps wrapped result payload", async () => {
    const mutate = async () => ({ result: { ok: true } });

    const result = await runMutation<Record<string, never>, { ok: boolean }>(mutate, {});

    expect(result).toEqual({ ok: true });
  });

  it("throws wrapped error payload", async () => {
    const mutate = async () => ({ error: new Error("mutation failed") });

    await expect(
      runMutation<Record<string, never>, Record<string, never>>(mutate, {}),
    ).rejects.toThrow("mutation failed");
  });

  it("fails fast with timeout", async () => {
    vi.useFakeTimers();
    const mutate = () => new Promise(() => {});

    const pending = runMutation<Record<string, never>, Record<string, never>>(mutate, {}, {
      timeoutMs: 50,
      operationName: "Create room",
    });
    const assertion = expect(pending).rejects.toThrow("Create room timed out");

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it("includes loopback hint on timeout when phone cannot reach local Convex", async () => {
    vi.useFakeTimers();
    const mutate = () => new Promise(() => {});

    const pending = runMutation<Record<string, never>, Record<string, never>>(mutate, {}, {
      timeoutMs: 25,
      operationName: "Join room",
      convexUrl: "http://127.0.0.1:3210",
      clientHost: "192.168.1.50",
    });
    const assertion = expect(pending).rejects.toThrow("Set CONVEX_URL");

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});

describe("connectivity helpers", () => {
  it("detects loopback hostnames", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.12.1.2")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("192.168.1.5")).toBe(false);
  });

  it("builds mismatch hint only for remote clients with loopback Convex URL", () => {
    expect(
      buildConnectivityHint("http://127.0.0.1:3210", "192.168.1.9"),
    ).toContain("Set CONVEX_URL");

    expect(buildConnectivityHint("http://127.0.0.1:3210", "localhost")).toBeNull();
    expect(buildConnectivityHint("http://192.168.1.8:3210", "192.168.1.9")).toBeNull();
  });

  it("rewrites loopback URLs for remote clients", () => {
    expect(
      rewriteLoopbackUrlForClient("http://127.0.0.1:3210/api/storage/upload", "172.20.10.5"),
    ).toBe("http://172.20.10.5:3210/api/storage/upload");

    expect(
      rewriteLoopbackUrlForClient("http://localhost:3211/storage/a", "172.20.10.5"),
    ).toBe("http://172.20.10.5:3211/storage/a");
  });

  it("does not rewrite non-loopback or local-client URLs", () => {
    expect(
      rewriteLoopbackUrlForClient("http://192.168.1.9:3210/api/storage/upload", "172.20.10.5"),
    ).toBe("http://192.168.1.9:3210/api/storage/upload");
    expect(
      rewriteLoopbackUrlForClient("http://127.0.0.1:3210/api/storage/upload", "localhost"),
    ).toBe("http://127.0.0.1:3210/api/storage/upload");
    expect(rewriteLoopbackUrlForClient("/relative/path", "172.20.10.5")).toBe("/relative/path");
  });
});

describe("toErrorMessage", () => {
  it("formats Error values", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("formats string values", () => {
    expect(toErrorMessage("bad")).toBe("bad");
  });

  it("formats object messages", () => {
    expect(toErrorMessage({ message: "bad request" })).toBe("bad request");
  });

  it("falls back for unknown values", () => {
    expect(toErrorMessage({ code: 500 })).toBe("Unexpected error");
    expect(toErrorMessage(null)).toBe("Unexpected error");
  });
});
