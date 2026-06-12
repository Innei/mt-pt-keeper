import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { appConfig } from "./config.js";
import { logger } from "./logger.js";
import { notify } from "./notify.js";
import {
  screenshotPathFor,
  timestampForFile,
  type KeeperRunState,
  writeRunState,
} from "./state.js";

type KeeperConfig = typeof appConfig;

const USERNAME_SELECTORS = [
  'input[name="username"]',
  'input[name="user"]',
  'input[name="email"]',
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[placeholder*="用户"]',
  'input[placeholder*="账号"]',
  'input[placeholder*="Username" i]',
  'input[placeholder*="Email" i]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[placeholder*="密码"]',
  'input[placeholder*="Password" i]',
];

const DETAIL_LINK_SELECTORS = [
  'a[href*="/detail"]',
  'a[href*="/details"]',
  'a[href*="/torrent"]',
  'a[href*="/torrents"]',
  'a[href*="torrent_id="]',
  'a[href*="torrentId="]',
  'a[href*="id="]:has-text("详情")',
  'a:has-text("详情")',
  'a:has-text("Detail")',
];

const MODAL_CLOSE_SELECTORS = [
  ".ant-modal-close",
  ".ant-modal-wrap .ant-modal-close",
  '.ant-modal-wrap button:has-text("关闭")',
  '.ant-modal-wrap button:has-text("關閉")',
  '.ant-modal-wrap button:has-text("我知道了")',
  '.ant-modal-wrap button:has-text("知道了")',
  '.ant-modal-wrap button:has-text("确定")',
  '.ant-modal-wrap button:has-text("确认")',
  '.ant-modal-wrap button:has-text("確定")',
  '.ant-modal-wrap button:has-text("確認")',
  '.ant-modal-wrap button:has-text("OK")',
  '.ant-modal-wrap button:has-text("Close")',
  '.ant-modal-wrap [role="button"]:has-text("关闭")',
  '.ant-modal-wrap [role="button"]:has-text("關閉")',
  '.ant-modal-wrap [role="button"]:has-text("確認")',
  '.ant-modal-wrap [role="button"]:has-text("OK")',
];

export interface KeeperRunResult {
  status: "success" | "expired" | "failed";
  message: string;
  url?: string;
  screenshotPath?: string;
}

class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export async function runKeeper(config: KeeperConfig): Promise<KeeperRunResult> {
  const startedAt = timestampForFile();
  const startedAtIso = new Date().toISOString();
  let context: BrowserContext | undefined;

  try {
    context = await launchContext(config, config.headless);
    const page = context.pages()[0] ?? (await context.newPage());
    let interacted = false;

    for (const url of config.keepaliveUrls) {
      logger.info({ url: redactUrl(url) }, "checking session");
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await settle(page);

      if (response?.status() === 401 || response?.status() === 403) {
        throw new SessionExpiredError(`Session rejected with HTTP ${response.status()}.`);
      }

      if (!(await isLoggedIn(page, config))) {
        throw new SessionExpiredError(
          "Saved browser session is expired or login challenge is required.",
        );
      }

      if (config.interaction.enabled && !interacted) {
        interacted = await openOneDetailPage(page, config);

        if (interacted && !(await isLoggedIn(page, config))) {
          throw new SessionExpiredError(
            "Session expired after opening a detail page.",
          );
        }
      }
    }

    return await persistResult(
      config,
      {
        status: "success",
        message: interacted
          ? "Session keepalive completed successfully with detail interaction."
          : "Session keepalive completed successfully.",
        url: redactUrl(page.url()),
      },
      startedAtIso,
    );
  } catch (error) {
    const status = error instanceof SessionExpiredError ? "expired" : "failed";
    const message = error instanceof Error ? error.message : String(error);
    const screenshotPath = context
      ? await captureScreenshot(context, config, startedAt)
      : undefined;

    return await persistResult(
      config,
      {
        status,
        message,
        url: context?.pages()[0] ? redactUrl(context.pages()[0].url()) : undefined,
        screenshotPath,
      },
      startedAtIso,
    );
  } finally {
    await context?.close().catch((error) => {
      logger.warn({ err: error }, "failed to close browser context");
    });
  }
}

export async function initializeSession(config: KeeperConfig): Promise<KeeperRunResult> {
  const startedAt = timestampForFile();
  const startedAtIso = new Date().toISOString();
  let context: BrowserContext | undefined;

  try {
    context = await launchContext(config, false);
    const page = context.pages()[0] ?? (await context.newPage());

    logger.info(
      { url: config.baseUrl, userDataDir: config.userDataDir },
      "opening browser for manual session initialization",
    );

    await page.goto(config.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await settle(page);

    if (!(await isLoggedIn(page, config))) {
      logger.info(
        "complete the captcha/login in the opened browser; keeper will continue after the session is valid",
      );
      await waitForManualLogin(page, config);
    }

    return await persistResult(
      config,
      {
        status: "success",
        message: "Manual browser session initialized successfully.",
        url: redactUrl(page.url()),
      },
      startedAtIso,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const screenshotPath = context
      ? await captureScreenshot(context, config, startedAt)
      : undefined;

    return await persistResult(
      config,
      {
        status: "failed",
        message,
        url: context?.pages()[0] ? redactUrl(context.pages()[0].url()) : undefined,
        screenshotPath,
      },
      startedAtIso,
    );
  } finally {
    await context?.close().catch((error) => {
      logger.warn({ err: error }, "failed to close browser context");
    });
  }
}

async function launchContext(config: KeeperConfig, headless: boolean) {
  return chromium.launchPersistentContext(config.userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  });
}

async function waitForManualLogin(page: Page, config: KeeperConfig) {
  const deadline = Date.now() + 15 * 60_000;

  while (Date.now() < deadline) {
    await settle(page);
    if (await isLoggedIn(page, config)) return;
    await page.waitForTimeout(2_000);
  }

  throw new Error("Manual session initialization timed out after 15 minutes.");
}

async function openOneDetailPage(page: Page, config: KeeperConfig) {
  await closeBlockingModals(page, config);

  const selectors = [
    config.interaction.detailLinkSelector,
    ...DETAIL_LINK_SELECTORS,
  ].filter((selector): selector is string => Boolean(selector));

  logger.info(
    { selectors, pageUrl: redactUrl(page.url()) },
    "looking for a detail link to interact with",
  );

  const candidates = await findDetailCandidates(page, selectors);

  logger.info(
    {
      count: candidates.length,
      candidates: candidates.slice(0, 5).map((candidate) => ({
        text: candidate.text,
        href: redactUrl(candidate.href),
      })),
    },
    "detail link candidates found",
  );

  const candidate = candidates[0];
  if (!candidate) {
    logger.warn("no detail link candidate found; keepalive will continue without interaction");
    return false;
  }

  logger.info(
    { text: candidate.text, href: redactUrl(candidate.href) },
    "opening detail link",
  );

  await openDetailCandidate(page, candidate);

  await settle(page);

  logger.info({ url: redactUrl(page.url()) }, "detail page opened");
  return true;
}

async function openDetailCandidate(page: Page, candidate: DetailCandidate) {
  const beforeUrl = page.url();

  try {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined),
      candidate.locator.click({ timeout: 15_000 }),
    ]);
    return;
  } catch (error) {
    if (!isPointerInterceptError(error)) {
      throw error;
    }

    logger.warn(
      { err: error, href: redactUrl(candidate.href) },
      "detail click was blocked by an overlay; trying DOM click fallback",
    );
    await logBlockingModal(page);
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined),
    candidate.locator.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
      }
    }),
  ]).catch((error) => {
    logger.warn({ err: error }, "DOM click fallback failed");
  });
  await settle(page);

  if (page.url() !== beforeUrl) {
    logger.info({ url: redactUrl(page.url()) }, "detail opened with DOM click fallback");
    return;
  }

  logger.warn(
    { href: redactUrl(candidate.href) },
    "DOM click did not navigate; opening detail href directly",
  );
  await page.goto(candidate.href, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
}

async function closeBlockingModals(page: Page, config: KeeperConfig) {
  const modalWrap = page.locator(".ant-modal-wrap").first();
  const modalVisible = await modalWrap.isVisible({ timeout: 500 }).catch(() => false);

  if (!modalVisible) return;

  logger.info("blocking modal detected before detail interaction");

  const selectors = [
    config.interaction.modalCloseSelector,
    ...MODAL_CLOSE_SELECTORS,
  ].filter((selector): selector is string => Boolean(selector));

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) continue;

    logger.info({ selector }, "closing blocking modal");
    await locator.click({ timeout: 5_000 }).catch((error) => {
      logger.debug({ err: error, selector }, "modal close click failed");
    });
    await page.waitForTimeout(500);

    if (!(await modalWrap.isVisible({ timeout: 500 }).catch(() => false))) {
      logger.info("blocking modal closed");
      return;
    }
  }

  logger.info("modal close selectors did not clear the modal; trying Escape");
  await page.keyboard.press("Escape").catch((error) => {
    logger.debug({ err: error }, "modal escape close failed");
  });
  await page.waitForTimeout(500);

  if (await modalWrap.isVisible({ timeout: 500 }).catch(() => false)) {
    logger.warn(
      "blocking modal is still visible; detail interaction may be skipped if click is intercepted",
    );
  } else {
    logger.info("blocking modal closed with Escape");
  }
}

async function logBlockingModal(page: Page) {
  const modal = page.locator(".ant-modal-wrap").first();
  const visible = await modal.isVisible({ timeout: 500 }).catch(() => false);
  if (!visible) return;

  const text = normalizeText(await modal.innerText({ timeout: 1_000 }).catch(() => ""));
  const closeButtons = await page
    .locator(".ant-modal-wrap button, .ant-modal-wrap [role='button'], .ant-modal-close")
    .evaluateAll((elements) =>
      elements.slice(0, 10).map((element) => ({
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        className: element.getAttribute("class"),
        ariaLabel: element.getAttribute("aria-label"),
      })),
    )
    .catch(() => []);

  logger.warn({ text, closeButtons }, "blocking modal details");
}

interface DetailCandidate {
  locator: Locator;
  text: string;
  href: string;
}

async function findDetailCandidates(
  page: Page,
  selectors: string[],
): Promise<DetailCandidate[]> {
  const candidates: DetailCandidate[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);

    logger.debug({ selector, count }, "detail selector scan result");

    for (let index = 0; index < Math.min(count, 20); index += 1) {
      const item = locator.nth(index);
      const visible = await item.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;

      const href = await item.getAttribute("href").catch(() => undefined);
      if (!href || href.startsWith("javascript:") || href === "#") continue;

      const absoluteHref = toAbsoluteUrl(page.url(), href);
      if (seen.has(absoluteHref)) continue;

      seen.add(absoluteHref);
      candidates.push({
        locator: item,
        href: absoluteHref,
        text: normalizeText(await item.innerText({ timeout: 1_000 }).catch(() => "")),
      });
    }
  }

  return candidates;
}

async function isLoggedIn(page: Page, config: KeeperConfig) {
  const url = page.url();

  if (config.expiredUrlPattern?.test(url)) {
    return false;
  }

  if (config.successUrlPattern?.test(url)) {
    return true;
  }

  const visiblePassword = await firstVisible(page, [
    config.selectors.password,
    ...PASSWORD_SELECTORS,
  ]);

  if (visiblePassword) {
    return false;
  }

  const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");

  if (config.expiredTextPattern?.test(bodyText)) {
    return false;
  }

  if (config.successTextPattern?.test(bodyText)) {
    return true;
  }

  const visibleUsername = await firstVisible(page, [
    config.selectors.username,
    ...USERNAME_SELECTORS,
  ]);
  const looksLikeLoginPage =
    Boolean(visibleUsername) || /登录|登入|验证码|login|sign in|captcha/i.test(bodyText);
  const hasAccountSignals = /logout|sign out|退出|登出|魔力值|做种|上传|下载|upload|download/i.test(
    bodyText,
  );

  return hasAccountSignals || !looksLikeLoginPage;
}

async function firstVisible(page: Page, selectors: Array<string | undefined>): Promise<Locator | undefined> {
  for (const selector of selectors) {
    if (!selector) continue;
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1_000 }).catch(() => false)) {
      return locator;
    }
  }
  return undefined;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
}

async function captureScreenshot(
  context: BrowserContext,
  config: KeeperConfig,
  startedAt: string,
) {
  const page = context.pages()[0];
  if (!page) return undefined;

  const screenshotPath = screenshotPathFor(config.screenshotDir, startedAt);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    logger.warn({ err: error }, "failed to capture screenshot");
  });

  return screenshotPath;
}

async function persistResult(
  config: KeeperConfig,
  result: KeeperRunResult,
  startedAt: string,
): Promise<KeeperRunResult> {
  const state: KeeperRunState = {
    status: result.status,
    startedAt,
    finishedAt: new Date().toISOString(),
    url: result.url,
    message: result.message,
    screenshotPath: result.screenshotPath,
  };

  await writeRunState(config.stateFile, state);
  await notify(config, state).catch((error) => {
    logger.warn({ err: error }, "failed to send notification");
  });

  if (result.status === "success") {
    logger.info({ url: result.url }, result.message);
  } else {
    logger.error({ url: result.url, screenshotPath: result.screenshotPath }, result.message);
  }

  return result;
}

function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function toAbsoluteUrl(pageUrl: string, href: string) {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return href;
  }
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

function isPointerInterceptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("intercepts pointer events") ||
    message.includes("subtree intercepts pointer events")
  );
}
