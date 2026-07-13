import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

export async function installBrowserStubs(target: BrowserContext | Page): Promise<void> {
  await target.addInitScript(() => {
    const state = window as typeof window & {
      __motocomClipboard?: string;
      __motocomVibration?: number | number[];
      __motocomSharePayload?: ShareData;
    };

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          state.__motocomClipboard = String(value);
        },
        readText: async () => state.__motocomClipboard ?? "",
      },
    });

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        state.__motocomVibration = pattern;
        return true;
      },
    });

    class FakeAudioContext {
      state = "running";
      destination = {};
      currentTime = 0;
      async resume() { this.state = "running"; }
      createBuffer() { return {}; }
      createGain() { return { gain: { value: 1, setValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createBufferSource() {
        const source: Record<string, unknown> = {
          onended: null,
          connect() {},
          disconnect() {},
          stop() {},
          start() {
            window.setTimeout(() => {
              if (typeof source.onended === "function") {
                source.onended(new Event("ended"));
              }
            }, 5);
          },
        };
        return source;
      }
      async decodeAudioData() { return { duration: 0.05, length: 400, numberOfChannels: 1, sampleRate: 8000 }; }
    }

    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        async request() {
          return { released: false, addEventListener() {}, async release() { this.released = true; } };
        },
      },
    });
  });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
    await installBrowserStubs(page);
    await use(page);
    expect(pageErrors, "The page must not emit uncaught JavaScript errors").toEqual([]);
  },
});

export { expect };
