import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { installBrowserStubs } from "./fixtures";

export const TONE_FILE = path.resolve("e2e/fixtures/tone.wav");
export const INVALID_MEDIA_FILE = path.resolve("e2e/fixtures/not-audio.txt");

export interface CreatedRoom {
  code: string;
  roomCode: string;
  url: string;
  roomUrl: string;
  name: string;
  driverName: string;
  pin: string;
}

export function uniqueValue(prefix: string, testInfo?: TestInfo): string {
  const project = testInfo?.project.name.replace(/[^a-z0-9]+/gi, "-") ?? "e2e";
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix} ${project} ${suffix}`;
}

export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("home-page")).toBeVisible();
}

export async function waitForRoom(page: Page): Promise<void> {
  await expect(page.getByTestId("room-page")).toBeVisible();
  await expect(page.getByTestId("room-header")).toBeVisible();
  await expect(page.getByTestId("room-loading")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("room-not-found")).toBeHidden();
}

export async function createRoom(
  page: Page,
  options: Partial<Pick<CreatedRoom, "name" | "driverName" | "pin">> & { driver?: string } = {},
): Promise<CreatedRoom> {
  const name = options.name ?? uniqueValue("Ride");
  const driverName = options.driverName ?? options.driver ?? uniqueValue("Driver");
  const pin = options.pin ?? "driver-123";

  await gotoHome(page);
  await page.getByTestId("mode-create").click();
  await expect(page.getByTestId("create-form")).toBeVisible();
  await page.getByTestId("create-room-name").fill(name);
  await page.getByTestId("create-display-name").fill(driverName);
  await page.getByTestId("create-pin").fill(pin);
  await expect(page.getByTestId("create-submit")).toBeEnabled();
  await page.getByTestId("create-submit").click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9]+$/i, { timeout: 20_000 });
  await waitForRoom(page);

  const code = (await page.getByTestId("room-code").locator("span").innerText()).trim();
  const url = new URL(page.url()).pathname;
  return {
    code,
    roomCode: code,
    url,
    roomUrl: url,
    name,
    driverName,
    pin,
  };
}

export async function unlockAudio(page: Page): Promise<void> {
  const status = page.getByTestId("audio-status");
  await expect(status).toBeVisible();
  if ((await status.innerText()).includes("Audio ready")) {
    return;
  }
  await status.click();
  await expect(status).toContainText("Audio ready", { timeout: 8_000 });
  await expect(page.getByTestId("audio-prompt")).toBeHidden();
}

export async function openControls(page: Page): Promise<void> {
  if (await page.getByTestId("control-center").isVisible()) {
    return;
  }
  await page.getByTestId("toggle-controls").click();
  await expect(page.getByTestId("control-center")).toBeVisible();
}

export async function selectControlTab(
  page: Page,
  tab: "room" | "people" | "activity" | "manage",
): Promise<void> {
  await openControls(page);
  await page.getByTestId(`tab-${tab}`).click();
  await expect(page.getByTestId(`pane-${tab}`)).toBeVisible();
}

export async function addSignal(
  page: Page,
  label = uniqueValue("Signal"),
  filePath = TONE_FILE,
): Promise<string> {
  await unlockAudio(page);
  await selectControlTab(page, "manage");
  await page.getByTestId("driver-create-label").fill(label);
  await page.getByTestId("driver-create-file").setInputFiles(filePath);
  await page.getByTestId("driver-create-submit").click();
  await expect(page.getByTestId("driver-success")).toContainText("Signal created", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("sound-button").filter({ hasText: label })).toBeVisible();
  return label;
}

export async function joinRoomDirect(page: Page, code: string, displayName: string): Promise<void> {
  await page.goto(`/room/${code}`);
  await waitForRoom(page);
  await unlockAudio(page);
  await expect(page.getByTestId("join-gate")).toBeVisible();
  await page.getByTestId("room-join-name").fill(displayName);
  await page.getByTestId("room-join-submit").click();
  await expect(page.getByTestId("join-gate")).toBeHidden({ timeout: 12_000 });
  await expect(page.getByTestId("page-toast")).toContainText("Joined room");
}

export async function newPreparedContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "Europe/Prague",
    colorScheme: "light",
  });
  await installBrowserStubs(context);
  return context;
}

export async function copiedText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    return (window as typeof window & { __motocomClipboard?: string }).__motocomClipboard ?? "";
  });
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > document.documentElement.clientWidth + 1 || rect.left < -1);
      })
      .slice(0, 10)
      .map((element) => ({ tag: element.tagName, className: element.className, text: element.innerText.slice(0, 80) })),
  }));
  expect(overflow.documentWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(
    overflow.viewportWidth + 1,
  );
}

export async function assertMinimumTouchTargets(page: Page, minimum = 40): Promise<void> {
  const tooSmall = await page.evaluate((min) => {
    const selectors = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]";
    return Array.from(document.querySelectorAll<HTMLElement>(selectors))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) {
          return false;
        }
        return rect.width < min || rect.height < min;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          testId: element.dataset.testid ?? "",
          text: element.innerText?.trim().slice(0, 60) ?? "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
  }, minimum);
  expect(tooSmall, JSON.stringify(tooSmall, null, 2)).toEqual([]);
}

export async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

export { installBrowserStubs };
export const createSignal = addSignal;
export const clipboardText = copiedText;
export const expectNoHorizontalOverflow = assertNoHorizontalOverflow;

export async function joinRoomFromHome(page: Page, code: string, displayName: string): Promise<void> {
  await page.goto(`/?code=${encodeURIComponent(code)}`);
  await expect(page.getByTestId("join-room-code")).toHaveValue(code);
  await page.getByTestId("join-display-name").fill(displayName);
  await page.getByTestId("join-submit").click();
  await expect(page).toHaveURL(new RegExp(`/room/${code}$`), { timeout: 20_000 });
  await waitForRoom(page);
  await unlockAudio(page);
}
