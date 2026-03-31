import { Bot, InlineKeyboard, type Context } from "grammy";
import { loadConfig } from "./config";
import { saveTelegramFile, sendLocalFiles, sendPromptAttachments, uploadedFileToAttachment } from "./files";
import { configureLogger, logger } from "./logger";
import { OpenCodeService } from "./opencode";
import { clearRecentUploads, currentModel, getRecentUploads, loadPersistentState, persistState, rememberUploads, state, touchActivity } from "./state";
import { createReminder, handleReminderCallback, showReminderList, startReminderLoop } from "./reminders";
import { t, uiLocaleTag } from "./i18n";
import type { PromptAttachment, UploadedFile } from "./types";

const MODEL_LIST_LIMIT = 30;
const MODEL_CALLBACK_PREFIX = "model:set:";
const REMINDER_HINT_RE = /(提醒|remind|reminder|到时候提醒|记得|别忘了|闹钟|alarm|schedule)/i;

type ActiveTask = {
  id: number;
  chatId: number;
  sourceMessageId: number;
  waitingMessageId: number;
  cancelled: boolean;
};

const config = loadConfig();
await loadPersistentState();
configureLogger(config.paths.logFile);
const bot = new Bot(config.telegram.botToken);
const opencode = new OpenCodeService(config);
const hasPendingUpdatesOnStartup = await hasPendingAuthorizedUpdates();
let activeTask: ActiveTask | null = null;
let nextTaskId = 1;

function isAuthorized(ctx: Context): boolean {
  return ctx.from?.id === config.telegram.allowedUserId;
}

async function hasPendingAuthorizedUpdates(): Promise<boolean> {
  try {
    const updates = await bot.api.getUpdates({
      limit: 20,
      timeout: 0,
      allowed_updates: ["message", "callback_query"],
    } as any);
    return updates.some((update: any) => {
      const fromId = update.message?.from?.id ?? update.callback_query?.from?.id;
      return fromId === config.telegram.allowedUserId;
    });
  } catch (error) {
    await logger.warn(`failed to inspect pending Telegram updates on startup: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function sendStartupGreetingIfIdle(): Promise<void> {
  if (hasPendingUpdatesOnStartup) {
    await logger.info("Skipping startup greeting because pending authorized updates exist");
    return;
  }

  try {
    const greeting = await opencode.generateStartupGreeting();
    await bot.api.sendMessage(config.telegram.allowedUserId, greeting);
    await logger.info("Sent startup greeting to authorized Telegram user");
  } catch (error) {
    await logger.warn(`failed to send startup greeting: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function unauthorizedGuard(ctx: Context, next: () => Promise<void>): Promise<void> {
  if (!isAuthorized(ctx)) {
    await logger.warn(`Unauthorized Telegram access from user=${ctx.from?.id ?? "unknown"}`);
    return;
  }
  touchActivity();
  await next();
}

async function setReactionSafe(ctx: Context, emoji: string): Promise<void> {
  const messageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;
  if (!messageId || !chatId) return;
  await setReactionByMessageSafe(chatId, messageId, emoji);
}

async function setReactionByMessageSafe(chatId: number, messageId: number, emoji: string): Promise<void> {
  try {
    await (bot.api as any).setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }], false);
  } catch {
    // ignore reaction failures
  }
}

function compactModelLabel(model: string): string {
  return model.length > 48 ? `${model.slice(0, 45)}...` : model;
}

function resolveDisplayedModel(defaults: Record<string, string>): string {
  if (state.model) return state.model;
  if (defaults.opencode) return `opencode/${defaults.opencode}`;
  const first = Object.entries(defaults)[0];
  if (first) return `${first[0]}/${first[1]}`;
  return currentModel();
}

function buildModelKeyboard(models: string[], activeModel: string | null): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  models.slice(0, MODEL_LIST_LIMIT).forEach((model, index) => {
    const label = model === activeModel ? `✅ ${compactModelLabel(model)}` : compactModelLabel(model);
    keyboard.text(label, `${MODEL_CALLBACK_PREFIX}${model}`);
    if (index % 1 === 0) keyboard.row();
  });
  return keyboard;
}

function shouldAttemptReminderParse(text: string): boolean {
  return REMINDER_HINT_RE.test(text);
}

function helpText(): string {
  return t(config, "help_text");
}

function messageReferenceTime(ctx: Context): string {
  const unixSeconds = ctx.message?.date;
  if (typeof unixSeconds === "number") {
    return new Date(unixSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

async function buildRecentAttachments(files: UploadedFile[]): Promise<PromptAttachment[]> {
  return Promise.all(
    files
      .filter((file) => file.source !== "voice" && file.source !== "audio")
      .map((file) => uploadedFileToAttachment(file)),
  );
}

async function interruptActiveTask(reason: string): Promise<void> {
  const running = activeTask;
  if (!running || running.cancelled) return;
  running.cancelled = true;
  activeTask = null;
  await logger.warn(`interrupting active task ${running.id}: ${reason}`);
  await opencode.abortCurrentSession();
  await setReactionByMessageSafe(running.chatId, running.sourceMessageId, "👎");
  try {
    await bot.api.editMessageText(running.chatId, running.waitingMessageId, t(config, "task_interrupted"));
  } catch {
    // ignore message edit failures
  }
}

function startPromptTask(
  ctx: Context,
  waitingText: string,
  promptText: string,
  uploadedFiles: UploadedFile[] = [],
  attachments: PromptAttachment[] = [],
): void {
  void runPromptTask(ctx, waitingText, promptText, uploadedFiles, attachments).catch(async (error) => {
    await logger.error(`background prompt task crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  });
}

async function runPromptTask(
  ctx: Context,
  waitingText: string,
  promptText: string,
  uploadedFiles: UploadedFile[] = [],
  attachments: PromptAttachment[] = [],
): Promise<void> {
  const chatId = ctx.chat?.id;
  const sourceMessageId = ctx.message?.message_id;
  if (!chatId || !sourceMessageId) return;

  await interruptActiveTask(`new incoming message ${sourceMessageId}`);
  await setReactionSafe(ctx, "🤔");
  const waiting = await ctx.reply(waitingText);
  const task: ActiveTask = {
    id: nextTaskId++,
    chatId,
    sourceMessageId,
    waitingMessageId: waiting.message_id,
    cancelled: false,
  };
  activeTask = task;

  try {
    const answer = await opencode.prompt(promptText, uploadedFiles, attachments);
    if (task.cancelled || activeTask?.id !== task.id) {
      await logger.warn(`discarding stale prompt result for task ${task.id}`);
      return;
    }

    await ctx.api.editMessageText(chatId, waiting.message_id, answer.message || t(config, "generic_done"));

    if (answer.attachments.length > 0) {
      const sentAttachments = await sendPromptAttachments(ctx, answer.attachments);
      if (sentAttachments > 0) {
        await logger.info(`sent ${sentAttachments} direct attachments back to telegram`);
      }
    }

    if (answer.files.length > 0) {
      const sentFiles = await sendLocalFiles(ctx, config, answer.files);
      if (sentFiles.length > 0) {
        await logger.info(`sent files back to telegram: ${sentFiles.join(", ")}`);
      } else {
        await logger.warn(`file send failed for candidates: ${answer.files.join(", ")}`);
        await ctx.reply(t(config, "send_failed"));
      }
    }
    await setReactionSafe(ctx, "👍");
  } catch (error) {
    if (task.cancelled || activeTask?.id !== task.id) {
      await logger.warn(`ignored prompt failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`prompt handling failed: ${message}`);
    await ctx.api.editMessageText(chatId, waiting.message_id, t(config, "task_failed", { error: message }));
    await setReactionSafe(ctx, "👎");
  } finally {
    if (activeTask?.id === task.id) {
      activeTask = null;
    }
  }
}

bot.use(unauthorizedGuard);

bot.command("help", async (ctx) => {
  await ctx.reply(helpText());
});

bot.command("new", async (ctx) => {
  await interruptActiveTask("/new command");
  const sessionId = await opencode.newSession();
  clearRecentUploads();
  await ctx.reply(t(config, "new_session", { sessionId }));
});

bot.command("reminders", async (ctx) => {
  await showReminderList(config, ctx, 0);
});

bot.command("model", async (ctx) => {
  const text = ctx.message?.text || "";
  const parts = text.trim().split(/\s+/).slice(1);

  if (parts.length === 0) {
    try {
      const { defaults, models } = await opencode.listModels();
      const activeModel = resolveDisplayedModel(defaults);
      await ctx.reply(t(config, "choose_model"), {
        reply_markup: buildModelKeyboard(models, activeModel),
      });
    } catch (error) {
      await ctx.reply(t(config, "fetch_models_failed", { error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  const nextModel = parts[0];
  try {
    const { models } = await opencode.listModels();
    if (!models.includes(nextModel)) {
      await ctx.reply(t(config, "model_not_found", { model: nextModel }));
      return;
    }
    await interruptActiveTask(`/model switch to ${nextModel}`);
    state.model = nextModel;
    await persistState();
    await ctx.reply(t(config, "model_switched", { model: nextModel }));
  } catch (error) {
    await ctx.reply(t(config, "model_switch_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
});

async function handleIncomingText(ctx: Context): Promise<void> {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() || "" : "";
  if (!text || text.startsWith("/")) return;

  if (shouldAttemptReminderParse(text)) {
    const reminder = await opencode.parseReminderRequest(text, messageReferenceTime(ctx));
    if (reminder.shouldCreate && reminder.scheduledAt && reminder.text) {
      const created = await createReminder(config, reminder.text, reminder.scheduledAt);
      const displayTime = new Date(created.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false });
      await ctx.reply(reminder.needsConfirmation && reminder.confirmationText
        ? reminder.confirmationText
        : t(config, "reminder_created", { time: displayTime, text: created.text }));
      return;
    }
  }

  const recentUploads = getRecentUploads();
  const attachments = await buildRecentAttachments(recentUploads);
  await logger.info(`received text message ${ctx.message?.message_id} and scheduled prompt task`);
  startPromptTask(ctx, config.telegram.waitingMessage, text, recentUploads, attachments);
}

async function handleIncomingFile(ctx: Context): Promise<void> {
  const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
  try {
    const uploaded = await saveTelegramFile(ctx, config);
    if (!uploaded) return;

    await logger.info(`saved telegram file ${uploaded.savedPath}`);
    rememberUploads([uploaded]);

    if (!caption) {
      await setReactionSafe(ctx, "👍");
      await ctx.reply(t(config, "file_saved", { path: uploaded.savedPath, waiting_message: config.telegram.waitingMessage }));
      return;
    }

    const attachment = await uploadedFileToAttachment(uploaded);
    const waitingText = t(config, "file_saved_and_processing", { path: uploaded.savedPath, waiting_message: config.telegram.waitingMessage });

    await logger.info(`received ${uploaded.source} message ${ctx.message?.message_id} with caption and scheduled prompt task`);
    startPromptTask(ctx, waitingText, caption, [uploaded], [attachment]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`file handling failed: ${message}`);
    await ctx.reply(t(config, "file_processing_failed", { error: message }));
    await setReactionSafe(ctx, "👎");
  }
}

bot.on("callback_query:data", async (ctx) => {
  if (await handleReminderCallback(config, ctx)) {
    return;
  }

  const data = ctx.callbackQuery.data;
  if (!data.startsWith(MODEL_CALLBACK_PREFIX)) {
    await ctx.answerCallbackQuery();
    return;
  }

  const model = data.slice(MODEL_CALLBACK_PREFIX.length);
  try {
    const { models } = await opencode.listModels();
    if (!models.includes(model)) {
      await ctx.answerCallbackQuery({ text: t(config, "model_unavailable"), show_alert: true });
      return;
    }
    await interruptActiveTask(`model callback switch to ${model}`);
    state.model = model;
    await persistState();
    await ctx.answerCallbackQuery({ text: t(config, "callback_model_switched", { model: compactModelLabel(model) }) });
    if (ctx.chat && ctx.callbackQuery.message?.message_id) {
      await ctx.api.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model"), {
        reply_markup: buildModelKeyboard(models, state.model || model),
      });
    }
  } catch (error) {
    await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : String(error), show_alert: true });
  }
});

bot.on("message:text", handleIncomingText);
bot.on("message:document", handleIncomingFile);
bot.on("message:photo", handleIncomingFile);
bot.on("message:voice", handleIncomingFile);
bot.on("message:audio", handleIncomingFile);

await logger.info("Telegram bot starting");
const reminderLoop = await startReminderLoop(config, bot);
await bot.start({
  drop_pending_updates: false,
  onStart: async (botInfo) => {
    await bot.api.setMyCommands([
      { command: "help", description: t(config, "command_help") },
      { command: "new", description: t(config, "command_new") },
      { command: "model", description: t(config, "command_model") },
      { command: "reminders", description: t(config, "command_reminders") },
    ]);
    await logger.info(`Telegram bot started as @${botInfo.username}`);
    await sendStartupGreetingIfIdle();
  },
});

process.on("SIGINT", () => {
  clearInterval(reminderLoop);
  opencode.stop();
  bot.stop();
});
process.on("SIGTERM", () => {
  clearInterval(reminderLoop);
  opencode.stop();
  bot.stop();
});
