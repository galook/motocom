import { test, expect } from "./fixtures";
import {
  addSignal,
  createRoom,
  joinRoomDirect,
  newPreparedContext,
  selectControlTab,
  uniqueValue,
} from "./helpers";

test.describe("multi-rider collaboration", () => {
  test("shows live rider presence and blocks non-driver management", async ({ page, browser }) => {
    const room = await createRoom(page, { driverName: "Lead Rider" });
    await addSignal(page, "Presence horn");

    const riderContext = await newPreparedContext(browser);
    const rider = await riderContext.newPage();
    try {
      await joinRoomDirect(rider, room.code, "Second Rider");

      await selectControlTab(page, "people");
      await expect(page.getByTestId("presence-row").filter({ hasText: "Lead Rider" })).toBeVisible();
      await expect(page.getByTestId("presence-row").filter({ hasText: "Second Rider" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("online-status")).toContainText("2 online", { timeout: 15_000 });

      await selectControlTab(rider, "manage");
      await expect(rider.getByTestId("pane-manage")).toContainText("Main driver access");
      await expect(rider.getByTestId("driver-panel")).toHaveCount(0);
    } finally {
      await riderContext.close();
    }
  });

  test("synchronizes active, accepted, rejected, and queued requests", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const room = await createRoom(page, { driverName: "Queue Driver" });
    const first = await addSignal(page, uniqueValue("First signal"));
    const second = await addSignal(page, uniqueValue("Second signal"));

    const riderContext = await newPreparedContext(browser);
    const rider = await riderContext.newPage();
    try {
      await joinRoomDirect(rider, room.code, "Queue Rider");

      await rider.getByTestId("sound-button").filter({ hasText: first }).click();
      await expect(page.getByTestId("live-request-dock")).toContainText(first, { timeout: 15_000 });
      await expect(page.getByTestId("active-request-panel")).toContainText("Queue Rider");
      await expect(rider.getByTestId("sound-button").filter({ hasText: first })).toContainText("Pending");
      await page.getByTestId("request-accept").click();
      await expect(rider.getByTestId("sound-button").filter({ hasText: first })).toContainText("Accepted", {
        timeout: 12_000,
      });
      await expect(page.getByTestId("live-request-dock")).toBeHidden({ timeout: 12_000 });

      await rider.getByTestId("sound-button").filter({ hasText: second }).click();
      await expect(page.getByTestId("live-request-dock")).toContainText(second);
      await page.getByTestId("request-reject").click();
      await expect(rider.getByTestId("sound-button").filter({ hasText: second })).toContainText("Rejected", {
        timeout: 12_000,
      });
      await expect(page.getByTestId("live-request-dock")).toBeHidden({ timeout: 12_000 });

      await rider.getByTestId("sound-button").filter({ hasText: first }).click();
      await expect(page.getByTestId("live-request-dock")).toContainText(first);
      await rider.getByTestId("sound-button").filter({ hasText: second }).click();
      await expect(page.getByTestId("queue-preview")).toContainText(second, { timeout: 12_000 });
      await expect(page.getByTestId("queue-status")).toContainText("1 queued");

      await page.getByTestId("request-accept").click();
      await expect(page.getByTestId("active-request-panel")).toContainText(second, { timeout: 12_000 });
      await expect(page.getByTestId("queue-status")).toContainText("0 queued");
      await page.getByTestId("request-reject").click();
      await expect(page.getByTestId("live-request-dock")).toBeHidden({ timeout: 12_000 });

      await selectControlTab(page, "activity");
      await expect(page.getByTestId("pane-activity")).toContainText("Accepted active request");
      await expect(page.getByTestId("pane-activity")).toContainText("Rejected active request");
    } finally {
      await riderContext.close();
    }
  });

  test("rejects an incorrect driver PIN and permits a valid handover", async ({ page, browser }) => {
    const pin = "handover-456";
    const room = await createRoom(page, { pin, driverName: "Original Driver" });
    await addSignal(page, "Handover signal");

    const riderContext = await newPreparedContext(browser);
    const rider = await riderContext.newPage();
    try {
      await joinRoomDirect(rider, room.code, "Replacement Driver");
      await selectControlTab(rider, "room");

      await rider.getByTestId("claim-driver-pin").fill("wrong-pin");
      await rider.getByTestId("claim-driver-form").getByRole("button", { name: "Claim" }).click();
      await expect(rider.getByTestId("page-toast")).toContainText("PIN is incorrect", { timeout: 12_000 });

      await rider.getByTestId("claim-driver-pin").fill(pin);
      await rider.getByTestId("claim-driver-form").getByRole("button", { name: "Claim" }).click();
      await expect(rider.getByTestId("page-toast")).toContainText("Main driver role granted", {
        timeout: 12_000,
      });
      await expect(
        rider.getByTestId("room-header").getByText("Main driver", { exact: true }),
      ).toBeVisible();
      await selectControlTab(rider, "manage");
      await expect(rider.getByTestId("driver-panel")).toBeVisible();

      await expect(
        page.getByTestId("room-header").getByText("Main driver", { exact: true }),
      ).toBeHidden({ timeout: 12_000 });
      await selectControlTab(page, "manage");
      await expect(page.getByTestId("pane-manage")).toContainText("Main driver access");
    } finally {
      await riderContext.close();
    }
  });
});
