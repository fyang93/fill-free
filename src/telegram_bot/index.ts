import { Bot } from "grammy";
import { loadConfig } from "./config";
import { configureLogger, logger } from "./logger";
import { OpenCodeService } from "./opencode";
import { currentModel, loadPersistentState, persistState, state } from "./state";
import { handleReminderCallback, reminderEventScheduleSummary, startReminderLoop } from "./reminders";
import {
  buildProviderKeyboard,
  buildProviderModelKeyboard,
  providersFromModels,
  resolveDisplayedModel,
} from "./model_menu";
import { t } from "./i18n";
import { replyFormatted, sendMessageFormatted } from "./telegram_format";
import { isAddressedToBot, isTrustedUserId, unauthorizedGuard } from "./access";
import { handleModelCallback } from "./model_callback";
import { PromptController } from "./prompt_controller";
import { startDreamLoop } from "./dreaming";

const config = loadConfig();
await loadPersistentState(config.paths.stateFile);
configureLogger(config.paths.logFile);
const bot = new Bot(config.telegram.botToken);
const opencode = new OpenCodeService(config);
let botUsername: string | null = null;
let botUserId: number | null = null;

const promptController = new PromptController({
  config,
  bot,
  opencode,
  isTrustedUserId: (userId) => isTrustedUserId(config, userId),
  isAddressedToBot: (ctx) => isAddressedToBot(ctx, botUsername, botUserId),
});

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

    await sendMessageFormatted(bot, adminUserId, greeting);
    await logger.info("Sent startup greeting to admin_user_id only");
  } catch (error) {
    await logger.warn(`failed to send startup greeting: ${error instanceof Error ? error.message : String(error)}`);
  }
}


function helpText(): string {
  return t(config, "help_text");
}

function isAdminUser(userId: number | undefined): boolean {
  return Boolean(config.telegram.adminUserId && userId === config.telegram.adminUserId);
}

bot.use((ctx, next) => unauthorizedGuard(config, ctx, next));

bot.command("help", async (ctx) => {
  await replyFormatted(ctx, helpText());
});

bot.command("new", async (ctx) => {
  if (!isAdminUser(ctx.from?.id)) {
    await replyFormatted(ctx, t(config, "admin_only_command"));
    return;
  }
  const sessionId = await promptController.resetSession();
  await persistState(config.paths.stateFile);
  await replyFormatted(ctx, t(config, "new_session", { sessionId }));
});

bot.command("model", async (ctx) => {
  if (!isAdminUser(ctx.from?.id)) {
    await replyFormatted(ctx, t(config, "admin_only_command"));
    return;
  }
  try {
    const { defaults, models } = await opencode.listModels();
    const activeModel = resolveDisplayedModel(state.model, defaults, currentModel());
    const providers = providersFromModels(models);
    const activeProvider = activeModel.split("/", 1)[0] || providers[0];
    if (providers.length === 1 || providers.includes(activeProvider)) {
      await replyFormatted(ctx, t(config, "choose_model_under_provider", { provider: activeProvider }), {
        reply_markup: buildProviderModelKeyboard(activeProvider, models, activeModel, config.telegram.menuPageSize, t(config, "reminder_back"), 0),
      });
    } else {
      await replyFormatted(ctx, t(config, "choose_provider"), {
        reply_markup: buildProviderKeyboard(models, activeModel, config.telegram.menuPageSize, t(config, "reminder_back"), 0),
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

  if (!isAdminUser(ctx.from?.id)) {
    await ctx.answerCallbackQuery({ text: t(config, "admin_only_command"), show_alert: true });
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

await logger.info("Telegram bot starting");
const reminderLoop = await startReminderLoop(config, bot, async (event, _instance, fallback) => {
  try {
    const recurrence = reminderEventScheduleSummary(config, event);
    const message = await opencode.generateReminderMessage(
      event.title,
      event.deliveryState?.currentOccurrence?.scheduledAt || new Date().toLocaleString(),
      recurrence,
      config.telegram.reminderMessageTimeoutMs,
    );
    return message || fallback;
  } catch (error) {
    await logger.warn(`reminder message fallback: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
});
const dreamLoop = startDreamLoop(config, opencode, {
  isBusy: () => promptController.hasActiveTask(),
});
await bot.start({
  drop_pending_updates: true,
  onStart: async (botInfo) => {
    await bot.api.setMyCommands([
      { command: "help", description: t(config, "command_help") },
      { command: "new", description: t(config, "command_new") },
      { command: "model", description: t(config, "command_model") },
    ]);
    botUsername = botInfo.username || null;
    botUserId = botInfo.id;
    await logger.info(`Telegram bot started as @${botInfo.username}`);
    await sendStartupGreeting();
  },
});

process.on("SIGINT", () => {
  clearInterval(reminderLoop);
  if (dreamLoop) clearInterval(dreamLoop);
  opencode.stop();
  bot.stop();
});
process.on("SIGTERM", () => {
  clearInterval(reminderLoop);
  if (dreamLoop) clearInterval(dreamLoop);
  opencode.stop();
  bot.stop();
});
