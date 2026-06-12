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
  const title =
    state.status === "success"
      ? "MT-PT Keeper succeeded"
      : state.status === "expired"
        ? "MT-PT session expired"
        : "MT-PT Keeper failed";

  const lines = [
    `${title}: ${state.message}`,
    state.url ? `URL: ${state.url}` : undefined,
    state.screenshotPath ? `Screenshot: ${state.screenshotPath}` : undefined,
    "Action: run `pnpm init-session` and finish the captcha/login again.",
  ];

  return lines.filter(Boolean).join("\n");
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
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram notification failed with HTTP ${response.status}.`);
  }
}
