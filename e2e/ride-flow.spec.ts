import { expect, test } from "@playwright/test";
import {
  createRoom,
  createSignal,
  installBrowserStubs,
  joinRoomFromHome,
  unlockAudio,
} from "./helpers";

test.describe("multi-rider ride lifecycle", () => {
  test("rider can join, request a signal, and driver can accept it", async ({ browser }) => {
    const driverContext = await browser.newContext();
    const riderContext = await browser.newContext();
    await installBrowserStubs(driverContext);
    await installBrowserStubs(riderContext);
    const driver = await driverContext.newPage();
    const rider = await riderContext.newPage();

    const room = await createRoom(driver, { name: "Acceptance Ride" });
    await unlockAudio(driver);
    await createSignal(driver, "Fuel stop");
    await joinRoomFromHome(rider, room.roomCode, "Rider Alice");

    await expect(driver.getByText("2 online")).toBeVisible();
    await rider.getByRole("button", { name: /Fuel stop/i }).click();
    await expect(driver.getByTestId("active-request-panel")).toContainText("Fuel stop");
    await expect(driver.getByTestId("active-request-panel")).toContainText("Rider Alice");
    await driver.getByTestId("request-accept").click();
    await expect(driver.getByTestId("active-request-panel")).toBeHidden();
    await expect(rider.getByRole("button", { name: /Fuel stop/i })).toContainText("Accepted");

    await riderContext.close();
    await driverContext.close();
  });

  test("driver can reject a rider request", async ({ browser }) => {
    const driverContext = await browser.newContext();
    const riderContext = await browser.newContext();
    await installBrowserStubs(driverContext);
    await installBrowserStubs(riderContext);
    const driver = await driverContext.newPage();
    const rider = await riderContext.newPage();

    const room = await createRoom(driver, { name: "Rejection Ride" });
    await unlockAudio(driver);
    await createSignal(driver, "Pull over");
    await joinRoomFromHome(rider, room.roomCode, "Rider Bob");
    await rider.getByRole("button", { name: /Pull over/i }).click();
    await expect(driver.getByTestId("active-request-panel")).toBeVisible();
    await driver.getByTestId("request-reject").click();
    await expect(rider.getByRole("button", { name: /Pull over/i })).toContainText("Rejected");

    await riderContext.close();
    await driverContext.close();
  });

  test("multiple requests create and advance a queue", async ({ browser }) => {
    const driverContext = await browser.newContext();
    const riderContext = await browser.newContext();
    await installBrowserStubs(driverContext);
    await installBrowserStubs(riderContext);
    const driver = await driverContext.newPage();
    const rider = await riderContext.newPage();

    const room = await createRoom(driver, { name: "Queue Ride" });
    await unlockAudio(driver);
    await createSignal(driver, "First signal");
    await createSignal(driver, "Second signal");
    await joinRoomFromHome(rider, room.roomCode, "Queue Rider");

    await rider.getByRole("button", { name: /First signal/i }).click();
    await expect(driver.getByTestId("active-request-panel")).toContainText("First signal");
    await rider.getByRole("button", { name: /Second signal/i }).click();
    await expect(driver.getByTestId("queue-preview")).toContainText("Second signal");
    await expect(driver.getByText("1 queued")).toBeVisible();

    await driver.getByTestId("request-accept").click();
    await expect(driver.getByTestId("active-request-panel")).toContainText("Second signal");
    await driver.getByTestId("request-reject").click();
    await expect(driver.getByTestId("active-request-panel")).toBeHidden();
    await expect(driver.getByText("0 queued")).toBeVisible();

    await riderContext.close();
    await driverContext.close();
  });

  test("people tab displays rider presence and role", async ({ browser }) => {
    const driverContext = await browser.newContext();
    const riderContext = await browser.newContext();
    await installBrowserStubs(driverContext);
    await installBrowserStubs(riderContext);
    const driver = await driverContext.newPage();
    const rider = await riderContext.newPage();

    const room = await createRoom(driver, { driver: "Lead Driver" });
    await unlockAudio(driver);
    await joinRoomFromHome(rider, room.roomCode, "Tail Rider");
    await driver.getByTestId("toggle-controls").click();
    await driver.getByTestId("tab-people").click();
    await expect(driver.getByTestId("presence-panel")).toContainText("Lead Driver");
    await expect(driver.getByTestId("presence-panel")).toContainText("Tail Rider");
    await expect(driver.getByTestId("presence-panel")).toContainText("Main driver");

    await riderContext.close();
    await driverContext.close();
  });

  test("rider can claim main driver with the correct PIN", async ({ browser }) => {
    const driverContext = await browser.newContext();
    const riderContext = await browser.newContext();
    await installBrowserStubs(driverContext);
    await installBrowserStubs(riderContext);
    const driver = await driverContext.newPage();
    const rider = await riderContext.newPage();

    const room = await createRoom(driver, { pin: "claim-789" });
    await unlockAudio(driver);
    await joinRoomFromHome(rider, room.roomCode, "Backup Driver");
    await rider.getByTestId("toggle-controls").click();
    await rider.getByTestId("claim-driver-pin").fill("wrong-pin");
    await rider.getByTestId("claim-driver-form").getByRole("button", { name: /claim/i }).click();
    await expect(rider.getByTestId("page-toast")).toContainText("PIN is incorrect");
    await rider.getByTestId("claim-driver-pin").fill(room.pin);
    await rider.getByTestId("claim-driver-form").getByRole("button", { name: /claim/i }).click();
    await expect(rider.getByText("Main driver", { exact: true }).first()).toBeVisible();
    await rider.getByTestId("tab-manage").click();
    await expect(rider.getByTestId("driver-panel")).toBeVisible();

    await riderContext.close();
    await driverContext.close();
  });

  test("an unjoined visitor cannot trigger signals until joining", async ({ browser }) => {
    const driverContext = await browser.newContext();
    const visitorContext = await browser.newContext();
    await installBrowserStubs(driverContext);
    await installBrowserStubs(visitorContext);
    const driver = await driverContext.newPage();
    const visitor = await visitorContext.newPage();

    const room = await createRoom(driver);
    await unlockAudio(driver);
    await createSignal(driver, "Visitor test");
    await visitor.goto(room.roomUrl);
    await unlockAudio(visitor);
    await expect(visitor.getByTestId("join-gate")).toBeVisible();
    await expect(visitor.getByRole("button", { name: /Visitor test/i })).toBeDisabled();
    await visitor.getByTestId("room-join-name").fill("Late Rider");
    await visitor.getByTestId("room-join-submit").click();
    await expect(visitor.getByTestId("join-gate")).toBeHidden();
    await expect(visitor.getByRole("button", { name: /Visitor test/i })).toBeEnabled();

    await visitorContext.close();
    await driverContext.close();
  });
});
