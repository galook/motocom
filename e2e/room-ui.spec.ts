import { expect, test } from "@playwright/test";
import {
  createRoom,
  createSignal,
  expectNoHorizontalOverflow,
  installBrowserStubs,
  unlockAudio,
} from "./helpers";

test.describe("room controls and persistence", () => {
  test.beforeEach(async ({ context }) => {
    await installBrowserStubs(context);
  });

  test("room header, status strip, and audio gate are coherent", async ({ page }) => {
    const room = await createRoom(page, { name: "Status Ride" });
    await expect(page.getByTestId("room-header")).toContainText(room.roomCode);
    await expect(page.getByTestId("audio-status")).toContainText("Enable audio");
    await expect(page.getByTestId("audio-prompt")).toBeVisible();
    await unlockAudio(page);
    await expect(page.getByTestId("audio-prompt")).toBeHidden();
    await expect(page.getByText(/Screen (awake|normal)/)).toBeVisible();
  });

  test("control center exposes consistent tabs and close behavior", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await page.getByTestId("toggle-controls").click();
    await expect(page.getByTestId("control-center")).toBeVisible();
    for (const name of ["room", "people", "activity", "manage"] as const) {
      await page.getByTestId(`tab-${name}`).click();
      await expect(page.getByTestId(`pane-${name}`)).toBeVisible();
    }
    await page.getByTestId("controls-close").click();
    await expect(page.getByTestId("control-center")).toBeHidden();
  });

  test("soundboard density persists after reload", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await page.getByTestId("density-compact").click();
    await expect(page.getByTestId("density-compact")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByTestId("density-compact")).toHaveAttribute("aria-pressed", "true");
  });

  test("playback volume persists locally", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await page.getByTestId("toggle-controls").click();
    const slider = page.getByTestId("playback-volume");
    await slider.fill("85");
    await expect(page.getByText("85%", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByTestId("toggle-controls").click();
    await expect(page.getByTestId("playback-volume")).toHaveValue("85");
  });

  test("main driver can upload a valid sound and create a signal", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await createSignal(page, "Road hazard");
    await expect(page.getByTestId("sound-button").filter({ hasText: "Road hazard" })).toContainText("Ready");
  });

  test("signal creation validates missing source files", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await page.getByTestId("toggle-controls").click();
    await page.getByTestId("tab-manage").click();
    await page.getByTestId("driver-create-label").fill("No file");
    await page.getByTestId("driver-create-submit").click();
    await expect(page.getByTestId("driver-error")).toContainText("both label and a source file");
  });

  test("main driver can rename and disable a signal", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await createSignal(page, "Original signal");
    await page.getByTestId("tab-manage").click();
    const row = page.getByTestId("driver-signal-row").filter({ hasText: "Original signal" });
    await row.getByTestId("signal-edit-label").fill("Renamed signal");
    await row.getByTestId("signal-enabled").uncheck();
    await row.getByTestId("signal-save").click();
    await expect(page.getByTestId("driver-success")).toContainText("Signal updated");
    await page.getByTestId("controls-close").click();
    const signal = page.getByRole("button", { name: /Renamed signal/i });
    await expect(signal).toBeDisabled();
    await expect(signal).toContainText("Disabled");
  });

  test("custom confirmation dialog can cancel signal deletion", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await createSignal(page, "Keep me");
    await page.getByTestId("tab-manage").click();
    const row = page.getByTestId("driver-signal-row").filter({ hasText: "Keep me" });
    await row.getByTestId("signal-delete").click();
    const dialog = page.getByRole("dialog", { name: "Delete signal?" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("confirm-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
  });

  test("custom confirmation dialog deletes a signal", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await createSignal(page, "Delete me");
    await page.getByTestId("tab-manage").click();
    const row = page.getByTestId("driver-signal-row").filter({ hasText: "Delete me" });
    await row.getByTestId("signal-delete").click();
    const dialog = page.getByRole("dialog", { name: "Delete signal?" });
    await dialog.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("driver-success")).toContainText("Signal deleted");
    await expect(row).toBeHidden();
  });

  test("unknown room has a clear recovery state", async ({ page }) => {
    await page.goto("/room/NOPE99");
    await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
  });

  test("room does not overflow horizontally", async ({ page }) => {
    await createRoom(page);
    await unlockAudio(page);
    await page.getByTestId("toggle-controls").click();
    await expectNoHorizontalOverflow(page);
  });
});
