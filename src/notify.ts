import type { appConfig } from "./config.js";
import type { KeeperRunState } from "./state.js";

type NotifyConfig = Pick<
  typeof appConfig,
  "notifySuccess" | "webhookUrl" | "telegram"
>;

export async function notify(config: NotifyConfig, state: KeeperRunState) {
  if (state.status === "success" && !config.notifySuccess) return;

  const text = formatMessage(state);
  const tasks: Array<Promise<void>> = [];

  if (config.webhookUrl) {
    tasks.push(sendWebhook(config.webhookUrl, text));
  }

  if (config.telegram.botToken && config.telegram.chatId) {
    tasks.push(sendTelegram(config.telegram.botToken, config.telegram.chatId, text));
  }

  await Promise.all(tasks);
}

function formatMessage(state: KeeperRunState) {
  if (state.status === "success") {
    return [
      "<b>[MT-PT Keeper] KEEPALIVE OK</b>",
      "",
      `Result: ${escapeHtml(state.message)}`,
      state.url ? `URL: ${escapeHtml(state.url)}` : undefined,
      `Finished: ${escapeHtml(state.finishedAt)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const title =
    state.status === "expired"
      ? "[MT-PT Keeper] SESSION EXPIRED"
      : "[MT-PT Keeper] KEEPALIVE FAILED";

  const lines = [
    `<b>${title}</b>`,
    "",
    "<b>ACTION REQUIRED</b>",
    "Run: <code>pnpm init-session</code>",
    "Then finish the captcha/login in the opened browser.",
    "",
    `Reason: ${escapeHtml(state.message)}`,
    state.url ? `URL: ${escapeHtml(state.url)}` : undefined,
    state.screenshotPath ? `Screenshot: ${escapeHtml(state.screenshotPath)}` : undefined,
    `Finished: ${escapeHtml(state.finishedAt)}`,
  ];

  return lines.filter(Boolean).join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function sendWebhook(webhookUrl: string, text: string) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
}

async function sendTelegram(botToken: string, chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram notification failed with HTTP ${response.status}.`);
  }
}
