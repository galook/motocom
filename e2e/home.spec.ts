import { test, expect } from "./fixtures";
import {
  assertMinimumTouchTargets,
  assertNoHorizontalOverflow,
  attachScreenshot,
  gotoHome,
} from "./helpers";

test.describe("home and entry flows", () => {
  test("renders the consistent light-theme landing page", async ({ page }, testInfo) => {
    await gotoHome(page);

    await expect(page).toHaveTitle(/Motocom/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("One tap. Every rider hears it.");
    await expect(page.getByTestId("mode-join")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("join-form")).toBeVisible();
    await expect(page.getByText("Private room codes")).toBeVisible();

    const theme = await page.evaluate(() => ({
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    }));
    expect(theme.colorScheme).toContain("light");
    expect(theme.themeColor).toBe("#f7f9fc");
    await assertNoHorizontalOverflow(page);
    await assertMinimumTouchTargets(page);
    await attachScreenshot(page, testInfo, "home-light-theme");
  });

  test("switches between join and create modes with correct tab semantics", async ({ page }) => {
    await gotoHome(page);

    await page.getByTestId("mode-create").click();
    await expect(page.getByTestId("mode-create")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("mode-join")).toHaveAttribute("aria-selected", "false");
    await expect(page.getByTestId("create-form")).toBeVisible();
    await expect(page.getByTestId("join-form")).toBeHidden();

    await page.getByTestId("mode-join").click();
    await expect(page.getByTestId("join-form")).toBeVisible();
    await expect(page.getByTestId("create-form")).toBeHidden();
  });

  test("enforces join form validation and normalizes room code input", async ({ page }) => {
    await gotoHome(page);

    const submit = page.getByTestId("join-submit");
    await expect(submit).toBeDisabled();
    await page.getByTestId("join-room-code").fill("ab c123");
    await expect(submit).toBeDisabled();
    await page.getByTestId("join-display-name").fill("Rider");
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId("join-room-code")).toHaveValue("ab c123");
  });

  test("enforces create form validation including minimum PIN length", async ({ page }) => {
    await gotoHome(page);
    await page.getByTestId("mode-create").click();

    const submit = page.getByTestId("create-submit");
    await expect(submit).toBeDisabled();
    await page.getByTestId("create-room-name").fill("Validation ride");
    await page.getByTestId("create-display-name").fill("Driver");
    await page.getByTestId("create-pin").fill("12345");
    await expect(submit).toBeDisabled();
    await page.getByTestId("create-pin").fill("123456");
    await expect(submit).toBeEnabled();
  });

  test("prefills an invitation code from the query string", async ({ page }) => {
    await page.goto("/?code=ab c123");
    await expect(page.getByTestId("home-page")).toBeVisible();
    await expect(page.getByTestId("mode-join")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("join-room-code")).toHaveValue("AB C123");
  });

  test("restores the saved display name in both entry modes", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("motocom.display-name", "Saved Rider"));
    await gotoHome(page);

    await expect(page.getByTestId("join-display-name")).toHaveValue("Saved Rider");
    await page.getByTestId("mode-create").click();
    await expect(page.getByTestId("create-display-name")).toHaveValue("Saved Rider");
  });

  test("shows, selects, and forgets recent rooms stored on the device", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("motocom.recent-rooms.v1", JSON.stringify([
        { code: "REC222", name: "Second ride", visitedAt: 200 },
        { code: "REC111", name: "First ride", visitedAt: 100 },
      ]));
    });
    await gotoHome(page);

    const recent = page.getByTestId("recent-room");
    await expect(recent).toHaveCount(2);
    await expect(recent.nth(0)).toHaveAttribute("data-room-code", "REC222");
    await recent.nth(1).locator(".recent-room__main").click();
    await expect(page.getByTestId("join-room-code")).toHaveValue("REC111");
    await expect(page.getByTestId("join-display-name")).toBeFocused();

    await recent.nth(0).locator(".recent-room__remove").click();
    await expect(page.getByTestId("recent-room")).toHaveCount(1);
    const stored = await page.evaluate(() => localStorage.getItem("motocom.recent-rooms.v1"));
    expect(stored).not.toContain("REC222");
  });

  test("handles the install prompt and removes the install action after acceptance", async ({ page }) => {
    await gotoHome(page);
    await page.evaluate(() => {
      const state = window as typeof window & { __installPrompted?: boolean };
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        prompt: {
          value: async () => {
            state.__installPrompted = true;
          },
        },
        userChoice: {
          value: Promise.resolve({ outcome: "accepted" }),
        },
      });
      window.dispatchEvent(event);
    });

    await expect(page.getByTestId("install-app")).toBeVisible();
    await page.getByTestId("install-app").click();
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__installPrompted))).toBe(true);
    await expect(page.getByTestId("install-app")).toBeHidden();
  });

  test("shows a user-facing error when joining an unknown room", async ({ page }) => {
    await gotoHome(page);
    await page.getByTestId("join-room-code").fill("ZZZZZZ");
    await page.getByTestId("join-display-name").fill("Lost Rider");
    await page.getByTestId("join-submit").click();
    await expect(page.getByTestId("entry-error")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId("entry-error")).toContainText(/not found|does not exist/i);
    await expect(page).toHaveURL(/\/$/);
  });

  test("supports keyboard activation for the entry tabs", async ({ page }) => {
    await gotoHome(page);
    await page.getByTestId("mode-create").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("create-form")).toBeVisible();
    await page.getByTestId("mode-join").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("join-form")).toBeVisible();
  });
});
