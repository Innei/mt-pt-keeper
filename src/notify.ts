import type { appConfig } from "./config.js";
import type { KeeperRunState } from "./state.js";

type NotifyConfig = Pick<
  typeof appConfig,
  "notifySuccess" | "timezone" | "webhookUrl" | "telegram"
>;

export async function notify(config: NotifyConfig, state: KeeperRunState) {
  const canSendTelegram = Boolean(config.telegram.botToken && config.telegram.chatId);
  const shouldSendSuccess = config.notifySuccess || canSendTelegram;

  if (state.status === "success" && !shouldSendSuccess) return;

  const text = formatMessage(state, config.timezone);
  const tasks: Array<Promise<void>> = [];

  if (config.webhookUrl && (state.status !== "success" || config.notifySuccess)) {
    tasks.push(sendWebhook(config.webhookUrl, text));
  }

  if (config.telegram.botToken && config.telegram.chatId) {
    tasks.push(sendTelegram(config.telegram.botToken, config.telegram.chatId, text));
  }

  await Promise.all(tasks);
}

function formatMessage(state: KeeperRunState, timezone: string) {
  const accountStats = formatAccountStats(state);

  if (state.status === "success") {
    return [
      "<b>✅ MT-PT 保活成功</b>",
      "",
      accountStats,
      accountStats ? "" : undefined,
      `结果：${escapeHtml(formatSuccessMessage(state.message))}`,
      `时间：${escapeHtml(formatDateTime(state.finishedAt, timezone))}`,
    ]
      .filter(isDefined)
      .join("\n");
  }

  const title =
    state.status === "expired"
      ? "⚠️ MT-PT 登录已失效"
      : "❌ MT-PT 保活失败";

  const lines = [
    `<b>${title}</b>`,
    "",
    `原因：${escapeHtml(state.message)}`,
    state.url ? `当前页面：${escapeHtml(state.url)}` : undefined,
    accountStats ? "" : undefined,
    accountStats,
    accountStats ? "" : undefined,
    `时间：${escapeHtml(formatDateTime(state.finishedAt, timezone))}`,
    "",
    state.status === "expired"
      ? "处理：运行 <code>pnpm init-session</code> 后完成登录/验证码"
      : undefined,
  ];

  return lines.filter(isDefined).join("\n");
}

function formatAccountStats(state: KeeperRunState) {
  const stats = state.accountStats;
  if (!stats) return undefined;

  const lines = [
    stats.downloaded ? `下载量：${escapeHtml(stats.downloaded)}` : undefined,
    stats.uploaded ? `上传量：${escapeHtml(stats.uploaded)}` : undefined,
    stats.ratio ? `分享率：${escapeHtml(stats.ratio)}` : undefined,
  ];

  return lines.filter(isDefined).join("\n");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function formatSuccessMessage(message: string) {
  if (message.includes("detail interaction")) return "已完成详情页交互";
  if (message.includes("Manual browser session initialized")) return "浏览器会话初始化完成";
  if (message.includes("successfully")) return "保活完成";
  return message;
}

function formatDateTime(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
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
