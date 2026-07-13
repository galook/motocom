import { test, expect } from "./fixtures";
import {
  assertMinimumTouchTargets,
  assertNoHorizontalOverflow,
  attachScreenshot,
  copiedText,
  createRoom,
  newPreparedContext,
  openControls,
  selectControlTab,
  unlockAudio,
  waitForRoom,
} from "./helpers";

test.describe("room shell and local controls", () => {
  test("creates a room and renders the main-driver room shell", async ({ page }, testInfo) => {
    const room = await createRoom(page, { name: "Alpine test ride", driverName: "Lead Rider" });

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(room.name);
    await expect(page.getByText("Main driver", { exact: true })).toBeVisible();
    await expect(page.getByTestId("room-code")).toContainText(room.code);
    await expect(page.getByTestId("online-status")).toContainText(/online/);
    await expect(page.getByTestId("queue-status")).toContainText("0 queued");
    await expect(page.getByTestId("soundboard")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertMinimumTouchTargets(page);
    await attachScreenshot(page, testInfo, "room-created-locked");
  });

  test("copies the room code with consistent toast feedback", async ({ page }) => {
    const room = await createRoom(page);
    await page.getByTestId("room-code").click();

    await expect(page.getByTestId("page-toast")).toContainText("Room code copied");
    expect(await copiedText(page)).toBe(room.code);
  });

  test("copies an invitation when native sharing is unavailable", async ({ page }) => {
    const room = await createRoom(page, { name: "Shareable ride" });
    await page.getByTestId("share-room").click();

    await expect(page.getByTestId("page-toast")).toContainText("Invite link copied");
    const invitation = await copiedText(page);
    expect(invitation).toContain(room.code);
    expect(invitation).toContain(`/?code=${room.code}`);
    expect(invitation).toContain("Shareable ride");
  });

  test("unlocks synchronized audio and dismisses both lock prompts", async ({ page }) => {
    await createRoom(page);
    await expect(page.getByTestId("audio-prompt")).toBeVisible();
    await expect(page.getByTestId("soundboard")).toContainText("Audio must be enabled first");

    await unlockAudio(page);

    await expect(page.getByTestId("audio-status")).toContainText("Audio ready");
    await expect(page.getByTestId("audio-prompt")).toBeHidden();
    await expect(page.getByTestId("soundboard")).not.toContainText("Audio must be enabled first");
  });

  test("opens and closes the tabbed control center", async ({ page }) => {
    await createRoom(page);
    await openControls(page);

    await expect(page.getByTestId("pane-room")).toBeVisible();
    await selectControlTab(page, "people");
    await selectControlTab(page, "activity");
    await selectControlTab(page, "manage");
    await page.getByTestId("controls-close").click();
    await expect(page.getByTestId("control-center")).toBeHidden();
  });

  test("persists compact soundboard density across reloads", async ({ page }) => {
    await createRoom(page);
    await page.getByTestId("density-compact").click();
    await expect(page.getByTestId("density-compact")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("motocom.grid-density"))).toBe("compact");

    await page.reload();
    await waitForRoom(page);
    await expect(page.getByTestId("density-compact")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("density-comfortable").click();
    await expect(page.getByTestId("density-comfortable")).toHaveAttribute("aria-pressed", "true");
  });

  test("persists playback volume locally", async ({ page }) => {
    await createRoom(page);
    await selectControlTab(page, "room");
    const volume = page.getByTestId("playback-volume");
    await volume.fill("80");
    await expect(volume).toHaveValue("80");
    expect(await page.evaluate(() => localStorage.getItem("motocom.playback-volume"))).toBe("0.8");

    await page.reload();
    await waitForRoom(page);
    await selectControlTab(page, "room");
    await expect(page.getByTestId("playback-volume")).toHaveValue("80");
  });

  test("shows a useful empty state for an invalid direct room URL", async ({ page }) => {
    await page.goto("/room/NOEXST");
    await expect(page.getByTestId("room-loading")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("room-not-found")).toBeVisible();
    await expect(page.getByTestId("room-not-found")).toContainText("Room not found");
    await page.getByRole("link", { name: "Return home" }).click();
    await expect(page.getByTestId("home-page")).toBeVisible();
  });

  test("adds a created room to recent rooms and reopens it", async ({ page }) => {
    const room = await createRoom(page, { name: "Recent E2E ride" });
    await page.getByTestId("room-back").click();
    await expect(page.getByTestId("home-page")).toBeVisible();

    const recent = page.getByTestId("recent-room").filter({ hasText: room.code });
    await expect(recent).toBeVisible();
    await expect(recent).toContainText("Recent E2E ride");
    await recent.locator(".recent-room__main").click();
    await expect(page.getByTestId("join-room-code")).toHaveValue(room.code);
  });

  test("requires audio before a new rider can join from a direct link", async ({ page, browser }) => {
    const room = await createRoom(page);
    const riderContext = await newPreparedContext(browser);
    const rider = await riderContext.newPage();
    try {
      await rider.goto(`/room/${room.code}`);
      await waitForRoom(rider);
      await expect(rider.getByTestId("join-gate")).toBeVisible();
      await rider.getByTestId("room-join-name").fill("Direct Rider");
      await expect(rider.getByTestId("room-join-submit")).toBeDisabled();
      await unlockAudio(rider);
      await expect(rider.getByTestId("room-join-submit")).toBeEnabled();
      await rider.getByTestId("room-join-submit").click();
      await expect(rider.getByTestId("join-gate")).toBeHidden({ timeout: 12_000 });
    } finally {
      await riderContext.close();
    }
  });
});
