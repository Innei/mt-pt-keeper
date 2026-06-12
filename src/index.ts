import cron from "node-cron";
import { appConfig } from "./config.js";
import { initializeSession, runKeeper } from "./keeper.js";
import { logger } from "./logger.js";

const mode = process.argv[2] ?? "daemon";

async function runOnce() {
  const result = await runKeeper(appConfig);
  if (result.status !== "success") {
    process.exitCode = 1;
  }
}

async function initSession() {
  const result = await initializeSession(appConfig);
  if (result.status !== "success") {
    process.exitCode = 1;
  }
}

function runDaemon() {
  logger.info(
    {
      cron: appConfig.cron,
      timezone: appConfig.timezone,
      baseUrl: appConfig.baseUrl,
      keepaliveUrls: appConfig.keepaliveUrls,
      headless: appConfig.headless,
    },
    "starting MT-PT keeper",
  );

  let running = false;

  const execute = async () => {
    if (running) {
      logger.warn("previous keeper run is still active; skipping this tick");
      return;
    }

    running = true;
    try {
      await runKeeper(appConfig);
    } finally {
      running = false;
    }
  };

  cron.schedule(appConfig.cron, execute, {
    timezone: appConfig.timezone,
  });

  void execute();
}

if (mode === "init-session") {
  await initSession();
} else if (mode === "once") {
  await runOnce();
} else if (mode === "daemon") {
  runDaemon();
} else {
  logger.error({ mode }, "unknown mode; use `init-session`, `once`, or `daemon`");
  process.exitCode = 1;
}
