import { mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalBoolean = z.preprocess(
  (value) => {
    if (value === "") return undefined;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return value;
  },
  z.boolean().optional(),
);

const envSchema = z.object({
  MT_PT_BASE_URL: z.string().url().default("https://kp.m-team.cc/"),
  KEEPER_KEEPALIVE_URLS: optionalString,
  KEEPER_CRON: z.string().default("0 9 * * *"),
  KEEPER_TIMEZONE: z.string().default("Asia/Shanghai"),
  KEEPER_HEADLESS: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  KEEPER_USER_DATA_DIR: z.string().default(".keeper/browser-profile"),
  KEEPER_STATE_FILE: z.string().default(".keeper/state.json"),
  KEEPER_SCREENSHOT_DIR: z.string().default(".keeper/screenshots"),
  KEEPER_INTERACTION_ENABLED: optionalBoolean.default(true),
  KEEPER_DETAIL_LINK_SELECTOR: optionalString,
  KEEPER_MODAL_CLOSE_SELECTOR: optionalString,
  MT_PT_USERNAME_SELECTOR: optionalString,
  MT_PT_PASSWORD_SELECTOR: optionalString,
  MT_PT_SUCCESS_URL_PATTERN: optionalString,
  MT_PT_EXPIRED_URL_PATTERN: optionalString,
  MT_PT_SUCCESS_TEXT_PATTERN: optionalString,
  MT_PT_EXPIRED_TEXT_PATTERN: optionalString,
  KEEPER_NOTIFY_SUCCESS: optionalBoolean.default(false),
  KEEPER_WEBHOOK_URL: optionalUrl,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
});

const parsedEnvResult = envSchema.safeParse(process.env);

if (!parsedEnvResult.success) {
  const messages = parsedEnvResult.error.issues.map((issue) => {
    const key = issue.path.join(".");
    return key ? `${key}: ${issue.message}` : issue.message;
  });

  console.error(`Invalid configuration:\n${messages.map((message) => `- ${message}`).join("\n")}`);
  process.exit(1);
}

const parsedEnv = parsedEnvResult.data;
const successUrlPattern = compileRegex(
  parsedEnv.MT_PT_SUCCESS_URL_PATTERN,
  "MT_PT_SUCCESS_URL_PATTERN",
);
const expiredUrlPattern = compileRegex(
  parsedEnv.MT_PT_EXPIRED_URL_PATTERN,
  "MT_PT_EXPIRED_URL_PATTERN",
);
const successTextPattern = compileRegex(
  parsedEnv.MT_PT_SUCCESS_TEXT_PATTERN,
  "MT_PT_SUCCESS_TEXT_PATTERN",
);
const expiredTextPattern = compileRegex(
  parsedEnv.MT_PT_EXPIRED_TEXT_PATTERN,
  "MT_PT_EXPIRED_TEXT_PATTERN",
);

const resolveFromCwd = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);

export const appConfig = {
  baseUrl: parsedEnv.MT_PT_BASE_URL,
  keepaliveUrls: parseKeepaliveUrls(
    parsedEnv.KEEPER_KEEPALIVE_URLS,
    parsedEnv.MT_PT_BASE_URL,
  ),
  cron: parsedEnv.KEEPER_CRON,
  timezone: parsedEnv.KEEPER_TIMEZONE,
  headless: parsedEnv.KEEPER_HEADLESS,
  userDataDir: resolveFromCwd(parsedEnv.KEEPER_USER_DATA_DIR),
  stateFile: resolveFromCwd(parsedEnv.KEEPER_STATE_FILE),
  screenshotDir: resolveFromCwd(parsedEnv.KEEPER_SCREENSHOT_DIR),
  interaction: {
    enabled: parsedEnv.KEEPER_INTERACTION_ENABLED,
    detailLinkSelector: parsedEnv.KEEPER_DETAIL_LINK_SELECTOR,
    modalCloseSelector: parsedEnv.KEEPER_MODAL_CLOSE_SELECTOR,
  },
  selectors: {
    username: parsedEnv.MT_PT_USERNAME_SELECTOR,
    password: parsedEnv.MT_PT_PASSWORD_SELECTOR,
  },
  successUrlPattern,
  expiredUrlPattern,
  successTextPattern,
  expiredTextPattern,
  notifySuccess: parsedEnv.KEEPER_NOTIFY_SUCCESS,
  webhookUrl: parsedEnv.KEEPER_WEBHOOK_URL,
  telegram: {
    botToken: parsedEnv.TELEGRAM_BOT_TOKEN,
    chatId: parsedEnv.TELEGRAM_CHAT_ID,
  },
} as const;

mkdirSync(path.dirname(appConfig.stateFile), { recursive: true });
mkdirSync(appConfig.screenshotDir, { recursive: true });
mkdirSync(appConfig.userDataDir, { recursive: true });

function compileRegex(value: string | undefined, key: string) {
  if (!value) return undefined;

  try {
    return new RegExp(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Invalid configuration:\n- ${key}: ${message}`);
    process.exit(1);
  }
}

function parseKeepaliveUrls(value: string | undefined, baseUrl: string) {
  const urls = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return urls?.length ? urls : [baseUrl];
}
