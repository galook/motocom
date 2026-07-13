import { test, expect } from "./fixtures";
import { createRoom, gotoHome } from "./helpers";

test.describe("PWA assets, metadata, and client privacy", () => {
  test("serves a valid installable web app manifest", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toBe("MotoCom Synchronized Soundboard");
    expect(manifest.short_name).toBe("MotoCom");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#f7f9fc");
    expect(manifest.background_color).toBe("#f7f9fc");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      expect.objectContaining({ purpose: "maskable" }),
    ]));
  });

  test("serves the generated service worker and Workbox runtime", async ({ request }) => {
    const worker = await request.get("/sw.js");
    expect(worker.ok()).toBe(true);
    const text = await worker.text();
    expect(text).toContain("workbox");
    expect(text.length).toBeGreaterThan(100);
  });

  test("serves all declared PWA icons", async ({ request }) => {
    for (const icon of ["/pwa-192x192.png", "/pwa-512x512.png", "/pwa-maskable-512x512.png", "/apple-touch-icon.png"]) {
      const response = await request.get(icon);
      expect(response.ok(), icon).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/png");
      expect((await response.body()).byteLength).toBeGreaterThan(500);
    }
  });

  test("publishes consistent mobile and theme metadata", async ({ page }) => {
    await gotoHome(page);
    const metadata = await page.evaluate(() => ({
      theme: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      mobile: document.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute("content"),
      apple: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content"),
      statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content"),
      icon: document.querySelector('link[rel="icon"]')?.getAttribute("href"),
      appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
    }));
    expect(metadata).toEqual({
      theme: "#f7f9fc",
      mobile: "yes",
      apple: "yes",
      statusBar: "default",
      icon: "/favicon.svg",
      appleIcon: "/apple-touch-icon.png",
    });
  });

  test("keeps participant secrets in scoped local storage and out of URLs", async ({ page }) => {
    const room = await createRoom(page);
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/room/${room.code}`);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");

    const storage = await page.evaluate((code) => {
      const entries = Object.entries(localStorage);
      return {
        roomToken: localStorage.getItem(`motocom.room-participant-token.v2.${code}`),
        entries,
        body: document.body.innerText,
        html: document.documentElement.outerHTML,
      };
    }, room.code);
    expect(storage.roomToken).toMatch(/^[a-f0-9]{64}$/i);
    expect(storage.body).not.toContain(storage.roomToken as string);
    expect(storage.html).not.toContain(storage.roomToken as string);
    expect(page.url()).not.toContain(storage.roomToken as string);
  });

  test("scopes room tokens independently by room code", async ({ page }) => {
    const first = await createRoom(page, { name: "First private room" });
    const firstToken = await page.evaluate((code) => localStorage.getItem(`motocom.room-participant-token.v2.${code}`), first.code);
    await page.goto("/");
    const second = await createRoom(page, { name: "Second private room" });
    const tokens = await page.evaluate(([firstCode, secondCode]) => ({
      first: localStorage.getItem(`motocom.room-participant-token.v2.${firstCode}`),
      second: localStorage.getItem(`motocom.room-participant-token.v2.${secondCode}`),
    }), [first.code, second.code]);
    expect(tokens.first).toBe(firstToken);
    expect(tokens.second).toMatch(/^[a-f0-9]{64}$/i);
    expect(tokens.second).not.toBe(tokens.first);
  });
});
