import { Bot } from "grammy";
import { loadConfig } from "./config";
import { DEFAULT_CONFIG_PATH, startConfigWatcher } from "./config_runtime";
import { configureLogger, logger } from "./logger";
import { OpenCodeService } from "./opencode";
import { currentModel, loadPersistentState, persistState, state } from "./state";
import { pruneExpiredPendingAuthorizationsFromState } from "./pending_access";
import { handleReminderCallback, prepareReminderDeliveryText, prewarmReminderDeliveryTexts, pruneExpiredReminderEvents, reminderEventScheduleSummary, startReminderLoop } from "./reminders";
import {
  buildProviderKeyboard,
  buildProviderModelKeyboard,
  providersFromModels,
  resolveDisplayedModel,
} from "./model_menu";
import { t } from "./i18n";
import { replyFormatted, sendMessageFormatted } from "./telegram_format";
import { isAddressedToBot, isAdminUserId, isTrustedUserId, unauthorizedGuard } from "./access";
import { handleModelCallback } from "./model_callback";
import { PromptController } from "./prompt_controller";
import { startDreamLoop } from "./dreaming";

const configPath = DEFAULT_CONFIG_PATH;
const config = loadConfig(configPath);
await loadPersistentState(config.paths.stateFile);
configureLogger(config.paths.logFile);
await logger.info(`telegram bot process starting pid=${process.pid}`);
const bot = new Bot(config.telegram.botToken);
const opencode = new OpenCodeService(config);
let botUsername: string | null = null;
let botUserId: number | null = null;
const pendingAuthorizationCleanup = setInterval(() => {
  void (async () => {
    const removed = await pruneExpiredPendingAuthorizationsFromState(config);
    if (removed <= 0) return;
    await logger.info(`removed ${removed} expired pending authorizations`);
  })().catch(async (error) => {
    await logger.warn(`pending authorization cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, 60_000);

const promptController = new PromptController({
  config,
  bot,
  opencode,
  isTrustedUserId: (userId) => isTrustedUserId(config, userId),
  isAdminUserId: (userId) => isAdminUser(userId),
  isAddressedToBot: (ctx) => isAddressedToBot(ctx, botUsername, botUserId),
});

async function sendAdminMessage(text: string): Promise<void> {
  const adminUserId = config.telegram.adminUserId;
  if (!adminUserId) return;
  await sendMessageFormatted(bot, adminUserId, text);
}

async function ensureUsableStartupModel(): Promise<void> {
  if (!state.model) return;
  try {
    const { models } = await opencode.listModels();
    if (models.includes(state.model)) return;
    await logger.warn(`configured model ${state.model} is unavailable; falling back to the OpenCode default model`);
    state.model = null;
    await persistState(config.paths.stateFile);
  } catch (error) {
    await logger.warn(`failed to validate configured model at startup: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function sendStartupGreeting(): Promise<void> {
  try {
    const adminUserId = config.telegram.adminUserId;
    if (!adminUserId) {
      await logger.warn("telegram.admin_user_id is not configured; skipping startup greeting");
      return;
    }

    const greeting = await opencode.generateStartupGreeting();
    if (!greeting) {
      await logger.warn("startup greeting generation returned empty output; skipping greet");
      return;
    }

    await sendAdminMessage(greeting);
    await logger.info("Sent startup greeting to admin_user_id only");
  } catch (error) {
    await logger.warn(`failed to send startup greeting: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function startDreamLoopWithNotifications(): NodeJS.Timeout | null {
  return startDreamLoop(config, opencode, {
    isBusy: () => promptController.hasActiveTask(),
    onChange: async (summary) => {
      await sendAdminMessage(summary);
    },
  });
}

function helpText(): string {
  return t(config, "help_text");
}

function isAdminUser(userId: number | undefined): boolean {
  return isAdminUserId(config, userId);
}

bot.use((ctx, next) => unauthorizedGuard(config, ctx, next));

bot.command("help", async (ctx) => {
  await replyFormatted(ctx, helpText());
});

bot.command("new", async (ctx) => {
  const sessionId = await promptController.resetSession(ctx);
  await persistState(config.paths.stateFile);
  await replyFormatted(ctx, t(config, "new_session", { sessionId }));
});

bot.command("model", async (ctx) => {
  if (!isTrustedUserId(config, ctx.from?.id)) {
    await replyFormatted(ctx, t(config, "trusted_only_command"));
    return;
  }
  try {
    const { defaults, models } = await opencode.listModels();
    const activeModel = resolveDisplayedModel(state.model, defaults, currentModel());
    const providers = providersFromModels(models);
    const activeProvider = activeModel.split("/", 1)[0] || providers[0];
    if (providers.length === 1 || providers.includes(activeProvider)) {
      await replyFormatted(ctx, t(config, "choose_model_under_provider", { provider: activeProvider }), {
        reply_markup: buildProviderModelKeyboard(activeProvider, models, activeModel, config.bot.menuPageSize, t(config, "reminder_back"), 0),
      });
    } else {
      await replyFormatted(ctx, t(config, "choose_provider"), {
        reply_markup: buildProviderKeyboard(models, activeModel, config.bot.menuPageSize, t(config, "reminder_back"), 0),
      });
    }
  } catch (error) {
    await replyFormatted(ctx, t(config, "fetch_models_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
});

bot.on("callback_query:data", async (ctx) => {
  if (await handleReminderCallback(config, ctx)) {
    return;
  }

  if (!isTrustedUserId(config, ctx.from?.id)) {
    await ctx.answerCallbackQuery({ text: t(config, "trusted_only_command"), show_alert: true });
    return;
  }

  if (await handleModelCallback(ctx, {
    config,
    listModels: () => opencode.listModels(),
    currentModelLabel: () => currentModel(),
    persistState: () => persistState(config.paths.stateFile),
    interruptActiveTask: (reason) => promptController.interruptActiveTask(reason),
    editMessageTextFormattedSafe: (innerCtx, chatId, messageId, text, options) => promptController.editMessageTextFormattedSafe(innerCtx, chatId, messageId, text, options),
  })) {
    return;
  }

  await ctx.answerCallbackQuery();
});

bot.on("message:text", (ctx) => promptController.handleIncomingText(ctx));
bot.on("message:document", (ctx) => promptController.handleIncomingFile(ctx));
bot.on("message:photo", (ctx) => promptController.handleIncomingFile(ctx));
bot.on("message:voice", (ctx) => promptController.handleIncomingFile(ctx));
bot.on("message:audio", (ctx) => promptController.handleIncomingFile(ctx));
bot.on("message:contact", (ctx) => promptController.handleIncomingContact(ctx));

bot.catch(async (error) => {
  const message = error.error instanceof Error ? error.error.stack || error.error.message : String(error.error);
  await logger.error(`unhandled bot error for update ${error.ctx.update.update_id}: ${message}`);
  try {
    if (error.ctx.chat?.id) {
      await replyFormatted(error.ctx, t(config, "task_failed", { error: "internal error" }));
    }
  } catch {
    // ignore secondary reply failures
  }
});

async function syncBotCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: "help", description: t(config, "command_help") },
    { command: "new", description: t(config, "command_new") },
    { command: "model", description: t(config, "command_model") },
  ]);
}

await logger.info("Telegram bot starting");
let reminderLoop = await startReminderLoop(
  config,
  bot,
  async (event, _instance, fallback) => {
    try {
      const recurrence = reminderEventScheduleSummary(config, event);
      const message = await opencode.generateReminderMessage(
        event.title,
        event.deliveryState?.currentOccurrence?.scheduledAt || new Date().toLocaleString(),
        recurrence,
        config.bot.reminderMessageTimeoutMs,
      );
      return message || fallback;
    } catch (error) {
      await logger.warn(`reminder message fallback: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  },
  async (event) => {
    try {
      await prepareReminderDeliveryText(config, opencode, event);
    } catch (error) {
      await logger.warn(`failed to refresh reminder message for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
);
let dreamLoop = startDreamLoopWithNotifications();
const configWatcher = startConfigWatcher(configPath, config, async (_reloadedConfig, result) => {
  configureLogger(config.paths.logFile);
  opencode.reloadConfig(config);
  if (dreamLoop) clearInterval(dreamLoop);
  dreamLoop = startDreamLoopWithNotifications();
  await syncBotCommands();
  if (config.telegram.adminUserId && (result.reloadedKeys.length > 0 || result.restartRequiredKeys.length > 0)) {
    const lines = [t(config, "config_reload_notice")];
    if (result.reloadedKeys.length > 0) {
      lines.push(t(config, "config_reload_applied", { keys: result.reloadedKeys.join(", ") }));
    }
    if (result.restartRequiredKeys.length > 0) {
      lines.push(t(config, "config_reload_restart_required", { keys: result.restartRequiredKeys.join(", ") }));
      lines.push(t(config, "config_reload_restart_hint"));
    }
    await sendAdminMessage(lines.join("\n"));
  }
});

await bot.start({
  drop_pending_updates: true,
  onStart: async (botInfo) => {
    await syncBotCommands();
    botUsername = botInfo.username || null;
    botUserId = botInfo.id;
    await logger.info(`Telegram bot started as @${botInfo.username}`);
    await ensureUsableStartupModel();
    const expiredReminderCleanup = await pruneExpiredReminderEvents(config);
    if (expiredReminderCleanup.removed > 0) {
      await logger.info(`startup pruned ${expiredReminderCleanup.removed} expired reminders: ${expiredReminderCleanup.removedIds.join(", ")}`);
    }
    await prewarmReminderDeliveryTexts(config, opencode);
    await sendStartupGreeting();
  },
});

process.on("SIGINT", () => {
  clearInterval(reminderLoop);
  configWatcher.close();
  if (dreamLoop) clearInterval(dreamLoop);
  opencode.stop();
  bot.stop();
});
process.on("SIGTERM", () => {
  clearInterval(reminderLoop);
  configWatcher.close();
  if (dreamLoop) clearInterval(dreamLoop);
  opencode.stop();
  bot.stop();
});
