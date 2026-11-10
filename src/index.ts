import dotenv from "dotenv";
import { startFeedBot, setShuttingDown, waitForPendingSends } from "./feed-bot.js";
import { getBotConfig } from "./bot-configs.js";
import { Scenes, Telegraf } from "telegraf";
import { Logger } from "tslog";
import PKC from "@pkcprotocol/pkc-js";

export const log = new Logger({
  minLevel: "INFO",
  prettyLogTemplate:
    "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{filePathWithLine}}] ",
  prettyErrorTemplate:
    "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{filePathWithLine}}] {{errorName}}: {{errorMessage}}\n{{errorStack}}",
});

dotenv.config({ quiet: true });

const botName = process.env.BOT_NAME || "5chan-feed";
const botConfig = getBotConfig(botName);
log.info(`Selected bot: ${botConfig.name} (${botConfig.clientName})`);

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

export const tgBot = new Telegraf<Scenes.WizardContext>(process.env.BOT_TOKEN!);

process.env.DEBUG = "";

// Filter noisy console output from IPFS/PKC internals
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const NOISE_PATTERNS = ["upvoteCount", "Server responded with 429 Too Many Requests"];

function isNoisyOutput(args: any[]): boolean {
  const stringified = args.map((arg) => (typeof arg === "object" ? String(arg) : arg)).join(" ");
  return NOISE_PATTERNS.some(
    (pattern) =>
      stringified.includes(pattern) &&
      (stringified.includes("signature") || stringified.includes("Retrying after")),
  );
}

console.log = (...args: any[]) => {
  if (!isNoisyOutput(args)) originalConsoleLog.apply(console, args);
};
console.error = (...args: any[]) => {
  if (!isNoisyOutput(args)) originalConsoleError.apply(console, args);
};
console.warn = (...args: any[]) => {
  if (!isNoisyOutput(args)) originalConsoleWarn.apply(console, args);
};

export let pkc: any;

let errorCleanupInterval: NodeJS.Timeout | undefined;
let isShuttingDown = false;

// How long shutdown waits for a Telegram send already in flight to finish and be recorded.
const PENDING_SENDS_TIMEOUT_MS = 5000;

// exitCode is 0 for signals and 1 for fatal errors, so supervisors that restart on failure restart the bot.
const gracefulShutdown = async (signal: string, exitCode = 0) => {
  if (isShuttingDown) {
    log.warn("Force shutting down...");
    process.exit(1);
  }

  isShuttingDown = true;
  log.info(`\nReceived ${signal}. Shutting down bot gracefully...`);

  try {
    setShuttingDown(true);

    // A send cut off by exit is not in history.json yet and would be sent again after restart.
    await waitForPendingSends(PENDING_SENDS_TIMEOUT_MS);

    if (tgBot) {
      log.info("Stopping Telegram bot...");
      try {
        await tgBot.stop();
      } catch (error) {
        // stop() throws "Bot is not running!" when launch() failed; PKC must still be destroyed.
        log.warn("Could not stop Telegram bot:", error instanceof Error ? error.message : String(error));
      }
    }

    if (pkc) {
      log.info("Stopping PKC instance...");
      await pkc.destroy();
    }

    if (errorCleanupInterval) clearInterval(errorCleanupInterval);

    log.info("Bot shutdown complete");
    process.exit(exitCode);
  } catch (error) {
    log.error("Error during shutdown:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGQUIT", () => gracefulShutdown("SIGQUIT"));

process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error);
  gracefulShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled Rejection:", reason);
  gracefulShutdown("unhandledRejection", 1);
});

const start = async () => {
  try {
    if (isShuttingDown) return;

    log.info(`Starting ${botConfig.name} bot...`);

    tgBot.launch().catch((error) => {
      log.error("Telegram bot launch error:", error);
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    log.info("Telegram bot launched successfully");

    try {
      const botInfo = await tgBot.telegram.getMe();
      log.info(`Bot started: https://t.me/${botInfo.username}`);
    } catch (error) {
      log.warn("Could not get bot info:", error instanceof Error ? error.message : String(error));
    }

    log.info("Initializing PKC...");
    try {
      pkc = await Promise.race([
        PKC({
          kuboRpcClientsOptions: [`http://localhost:50019/api/v0`],
        }),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("PKC initialization timed out after 2 minutes")),
            2 * 60 * 1000,
          );
        }),
      ]);

      const errorCounts = new Map<string, { count: number; lastLogged: number }>();
      const ERROR_LOG_INTERVAL = 60000;
      const MAX_ERROR_LOGS_PER_INTERVAL = 3;
      const ERROR_CLEANUP_INTERVAL = 3600000;
      const ERROR_RETENTION_TIME = 7200000;

      errorCleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, value] of errorCounts.entries()) {
          if (now - value.lastLogged > ERROR_RETENTION_TIME) {
            errorCounts.delete(key);
          }
        }
      }, ERROR_CLEANUP_INTERVAL);

      pkc.on("error", (error: any) => {
        const errorKey = error.message || error.code || "Unknown PKC error";
        const now = Date.now();
        const errorInfo = errorCounts.get(errorKey) || { count: 0, lastLogged: 0 };

        errorInfo.count++;
        let shouldLog = false;

        const isIPFSError =
          errorKey.includes("Failed to resolve IPNS") ||
          errorKey.includes("IPFS") ||
          errorKey.includes("timeout") ||
          errorKey.includes("connect ECONNREFUSED");
        const logInterval = isIPFSError ? 15 * 60 * 1000 : ERROR_LOG_INTERVAL;

        if (now - errorInfo.lastLogged > logInterval) {
          errorInfo.count = 1;
          errorInfo.lastLogged = now;
          shouldLog = true;
        } else if (!isIPFSError && errorInfo.count <= MAX_ERROR_LOGS_PER_INTERVAL) {
          errorInfo.lastLogged = now;
          shouldLog = true;
        }

        errorCounts.set(errorKey, errorInfo);

        if (shouldLog) {
          if (errorKey.includes("Failed to resolve IPNS")) {
            log.warn("Some communities offline (IPNS resolution issues)");
          } else if (isIPFSError) {
            log.warn(`IPFS connectivity issue: ${errorKey.substring(0, 50)}...`);
          } else {
            log.error("PKC error:", errorKey);
          }
        }
      });

      log.info("PKC initialized successfully");
    } catch (error) {
      log.error(
        "Failed to initialize PKC:",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    if (isShuttingDown) return;

    await startFeedBot(tgBot, botConfig);
  } catch (error) {
    log.error("Bot startup error:", error instanceof Error ? error.message : String(error));

    if (!isShuttingDown) {
      await gracefulShutdown("startup-error", 1);
    }
  }
};

start().catch((error) => {
  log.error("Unhandled start error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
