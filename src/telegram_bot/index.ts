import { stat } from "node:fs/promises";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { loadConfig } from "./config";
import { saveTelegramFile, sendLocalFiles, sendPromptAttachments, uploadedFileToAttachment } from "./files";
import { configureLogger, logger } from "./logger";
import { OpenCodeService, type ReminderParseResult } from "./opencode";
import {
  clearRecentUploads,
  currentModel,
  getRecentUploads,
  hasRecentUploads,
  loadPersistentState,
  persistState,
  rememberUploads,
  retainRecentUploads,
  state,
  touchActivity,
} from "./state";
import { createAutoEventReminders, createReminder, handleReminderCallback, reminderScheduleSummary, startReminderLoop, summarizeCreatedReminders, type AutoReminderEvent } from "./reminders";
import { t } from "./i18n";
import { editMessageTextFormatted, replyFormatted, sendMessageFormatted } from "./telegram_format";
import { getAccurateNowIso } from "./time";
import type { PromptAttachment, UploadedFile } from "./types";

const MODEL_CALLBACK_PREFIX = "model:";
const WAITING_MESSAGE_PLACEHOLDER = "__WAITING_MESSAGE__";

type ActiveTask = {
  id: number;
  chatId: number;
  sourceMessageId: number;
  waitingMessageId: number;
  cancelled: boolean;
  waitingMessageRotation?: NodeJS.Timeout;
};

const config = loadConfig();
await loadPersistentState();
configureLogger(config.paths.logFile);
const bot = new Bot(config.telegram.botToken);
const opencode = new OpenCodeService(config);
let botUsername: string | null = null;
let botUserId: number | null = null;
let activeTask: ActiveTask | null = null;
let nextTaskId = 1;

type AccessLevel = "trusted" | "allowed" | "none";

function accessLevelForUserId(userId: number | undefined): AccessLevel {
  if (typeof userId !== "number") return "none";
  if (config.telegram.trustedUserIds.includes(userId)) return "trusted";
  if (config.telegram.allowedUserIds.includes(userId)) return "allowed";
  return "none";
}

function isTrustedUserId(userId: number | undefined): boolean {
  return accessLevelForUserId(userId) === "trusted";
}

function isAuthorized(ctx: Context): boolean {
  return accessLevelForUserId(ctx.from?.id) !== "none";
}

async function sendStartupGreeting(): Promise<void> {
  try {
    const greeting = await opencode.generateStartupGreeting();
    if (!greeting) {
      await logger.warn("startup greeting generation returned empty output; skipping greet");
      return;
    }

    const mainUserId = config.telegram.mainUserId;
    if (!mainUserId) {
      await logger.warn("telegram.main_user_id is not configured; skipping startup greeting");
      return;
    }

    await sendMessageFormatted(bot, mainUserId, greeting);
    await logger.info("Sent startup greeting to main_user_id only");
  } catch (error) {
    await logger.warn(`failed to send startup greeting: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function unauthorizedGuard(ctx: Context, next: () => Promise<void>): Promise<void> {
  const userId = ctx.from?.id;
  const accessLevel = accessLevelForUserId(userId);
  if (accessLevel === "none") {
    await logger.warn(`Telegram access denied level=none user=${userId ?? "unknown"}`);
    return;
  }
  await logger.info(`Telegram access granted level=${accessLevel} user=${userId ?? "unknown"}`);
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

function modelIdLabel(model: string): string {
  const index = model.indexOf("/");
  const label = index >= 0 ? model.slice(index + 1) : model;
  return compactModelLabel(label);
}

function compactProviderLabel(provider: string): string {
  return provider.length > 32 ? `${provider.slice(0, 29)}...` : provider;
}

function resolveDisplayedModel(defaults: Record<string, string>): string {
  if (state.model) return state.model;
  if (defaults.opencode) return `opencode/${defaults.opencode}`;
  const first = Object.entries(defaults)[0];
  if (first) return `${first[0]}/${first[1]}`;
  return currentModel();
}

function providersFromModels(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.split("/", 1)[0]))).sort((a, b) => a.localeCompare(b));
}

function modelsForProvider(models: string[], provider: string): string[] {
  return models.filter((model) => model.startsWith(`${provider}/`));
}

function buildPagedKeyboard(items: Array<{ label: string; data: string }>, pageSize: number, page: number, navPrefix: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = currentPage * safePageSize;
  const pageItems = items.slice(start, start + safePageSize);
  pageItems.forEach((item) => keyboard.text(item.label, item.data).row());
  if (totalPages > 1) {
    if (currentPage > 0) keyboard.text("⬅", `${MODEL_CALLBACK_PREFIX}${navPrefix}:${currentPage - 1}`);
    if (currentPage < totalPages - 1) keyboard.text("➡", `${MODEL_CALLBACK_PREFIX}${navPrefix}:${currentPage + 1}`);
  }
  return keyboard;
}

function buildProviderKeyboard(models: string[], activeModel: string | null, pageSize: number, page = 0): InlineKeyboard {
  const activeProvider = activeModel?.split("/", 1)[0] || null;
  const items = providersFromModels(models).map((provider) => ({
    label: provider === activeProvider ? `✅ ${compactProviderLabel(provider)}` : compactProviderLabel(provider),
    data: `${MODEL_CALLBACK_PREFIX}provider:${provider}:0`,
  }));
  return buildPagedKeyboard(items, pageSize, page, "providers");
}

function buildProviderModelKeyboard(provider: string, models: string[], activeModel: string | null, pageSize: number, page = 0): InlineKeyboard {
  const items = modelsForProvider(models, provider).map((model) => ({
    label: model === activeModel ? `✅ ${modelIdLabel(model)}` : modelIdLabel(model),
    data: `${MODEL_CALLBACK_PREFIX}set:${model}`,
  }));
  const keyboard = buildPagedKeyboard(items, pageSize, page, `models:${provider}`);
  if (providersFromModels(models).length > 1) {
    keyboard.row().text(t(config, "reminder_back"), `${MODEL_CALLBACK_PREFIX}providers:0`);
  }
  return keyboard;
}

async function editMessageTextFormattedSafe(ctx: Context, chatId: number, messageId: number, text: string, options?: Parameters<typeof editMessageTextFormatted>[4]): Promise<void> {
  try {
    await editMessageTextFormatted(ctx, chatId, messageId, text, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/message is not modified|400: Bad Request/i.test(message)) {
      return;
    }
    throw error;
  }
}

function helpText(): string {
  return t(config, "help_text");
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerInRange(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function normalizeParsedRecurrence(recurrence: ReminderParseResult["recurrence"]): ReminderParseResult["recurrence"] | undefined {
  if (!recurrence || typeof recurrence !== "object") return undefined;
  const kind = recurrence.kind;
  if (kind === "once" || kind === "daily" || kind === "weekdays") return { kind };
  if (kind === "interval") {
    const unit = recurrence.unit;
    const every = integerInRange(recurrence.every, 1, 10000);
    if (unit && every && ["minute", "hour", "day", "week", "month", "year"].includes(unit)) {
      return { kind, unit, every };
    }
    return undefined;
  }
  if (kind === "weekly") {
    const daysOfWeek = Array.isArray(recurrence.daysOfWeek)
      ? Array.from(new Set(recurrence.daysOfWeek.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))).sort((a, b) => a - b)
      : [];
    const every = integerInRange(recurrence.every, 1, 1000) ?? 1;
    return daysOfWeek.length > 0 ? { kind, every, daysOfWeek } : undefined;
  }
  if (kind === "monthly") {
    const every = integerInRange(recurrence.every, 1, 1000) ?? 1;
    if (recurrence.mode === "nthWeekday") {
      const weekOfMonth = integerInRange(recurrence.weekOfMonth, -1, 5);
      const dayOfWeek = integerInRange(recurrence.dayOfWeek, 0, 6);
      if (weekOfMonth && weekOfMonth !== 0 && dayOfWeek !== undefined) return { kind, every, mode: "nthWeekday", weekOfMonth, dayOfWeek };
      return undefined;
    }
    const dayOfMonth = integerInRange(recurrence.dayOfMonth, 1, 31);
    return dayOfMonth ? { kind, every, mode: "dayOfMonth", dayOfMonth } : undefined;
  }
  if (kind === "yearly") {
    const month = integerInRange(recurrence.month, 1, 12);
    const day = integerInRange(recurrence.day, 1, 31);
    const every = integerInRange(recurrence.every, 1, 1000) ?? 1;
    if (!month || !day) return undefined;
    const normalized: NonNullable<ReminderParseResult["recurrence"]> = { kind, every, month, day };
    const offsetDays = Number(recurrence.offsetDays);
    if (Number.isInteger(offsetDays)) normalized.offsetDays = offsetDays;
    return normalized;
  }
  if (kind === "lunarYearly") {
    const month = integerInRange(recurrence.month, 1, 12);
    const day = integerInRange(recurrence.day, 1, 30);
    if (!month || !day) return undefined;
    const normalized: NonNullable<ReminderParseResult["recurrence"]> = { kind, month, day };
    if (recurrence.isLeapMonth === true) normalized.isLeapMonth = true;
    if (recurrence.leapMonthPolicy === "same-leap-only" || recurrence.leapMonthPolicy === "prefer-non-leap" || recurrence.leapMonthPolicy === "both") normalized.leapMonthPolicy = recurrence.leapMonthPolicy;
    const offsetDays = Number(recurrence.offsetDays);
    if (Number.isInteger(offsetDays)) normalized.offsetDays = offsetDays;
    return normalized;
  }
  return undefined;
}

function normalizeParsedEvent(event: ReminderParseResult["event"], fallbackTitle: string): AutoReminderEvent | undefined {
  if (!event || typeof event !== "object") return undefined;
  if (event.kind !== "birthday" && event.kind !== "anniversary" && event.kind !== "memorial" && event.kind !== "festival") return undefined;
  if (event.calendar !== "gregorian" && event.calendar !== "chinese-lunar") return undefined;
  const month = integerInRange(event.month, 1, 12);
  const day = integerInRange(event.day, 1, event.calendar === "chinese-lunar" ? 30 : 31);
  if (!month || !day) return undefined;
  const reminderTimeHour = integerInRange(event.reminderTime?.hour, 0, 23);
  const reminderTimeMinute = integerInRange(event.reminderTime?.minute, 0, 59);
  const rawOffsets = Array.isArray(event.offsetsDays)
    ? Array.from(new Set(event.offsetsDays.map((value) => Number(value)).filter((value) => Number.isInteger(value)))).sort((a, b) => a - b)
    : [];
  const offsetsDays = rawOffsets.length > 0 ? rawOffsets : undefined;

  const isBirthdayOrAnniversary = event.kind === "birthday" || event.kind === "anniversary";
  if (!isBirthdayOrAnniversary && !offsetsDays) {
    // For memorials and festivals, do not invent offsets; fall back to normal reminder behavior unless the user explicitly provided offsets.
    return undefined;
  }

  return {
    kind: event.kind,
    title: trimmedString(event.title) || fallbackTitle,
    calendar: event.calendar,
    month,
    day,
    year: integerInRange(event.year, 1, 9999),
    isLeapMonth: event.isLeapMonth === true,
    leapMonthPolicy: event.leapMonthPolicy === "same-leap-only" || event.leapMonthPolicy === "prefer-non-leap" || event.leapMonthPolicy === "both" ? event.leapMonthPolicy : undefined,
    reminderTime: {
      hour: reminderTimeHour ?? 9,
      minute: reminderTimeMinute ?? 0,
    },
    offsetsDays,
  };
}

function normalizeReminderParseResult(parsed: ReminderParseResult, fallbackTitle: string): {
  shouldCreate: boolean;
  text?: string;
  scheduledAt?: string;
  recurrence?: ReminderParseResult["recurrence"];
  event?: AutoReminderEvent;
  needsConfirmation: boolean;
  confirmationText?: string;
} {
  const text = trimmedString(parsed.text);
  const scheduledAt = trimmedString(parsed.scheduledAt);
  const validScheduledAt = scheduledAt && Number.isFinite(Date.parse(scheduledAt)) ? scheduledAt : undefined;
  const recurrence = normalizeParsedRecurrence(parsed.recurrence);
  const event = normalizeParsedEvent(parsed.event, text || fallbackTitle);
  const normalized = {
    shouldCreate: parsed.shouldCreate === true && Boolean(event || (text && validScheduledAt)),
    text,
    scheduledAt: validScheduledAt,
    recurrence,
    event,
    needsConfirmation: parsed.needsConfirmation === true,
    confirmationText: trimmedString(parsed.confirmationText),
  };
  if (parsed.shouldCreate && !normalized.shouldCreate && !normalized.needsConfirmation) {
    normalized.needsConfirmation = true;
    normalized.confirmationText = "我理解你是想设置提醒，但时间或提醒类型还不够明确。你可以再具体说一下时间、频率，或是否是生日/纪念日这类事件。";
  }
  return normalized;
}

function requiresDirectMention(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function entityMentionsBot(text: string | undefined, entities: Array<{ type?: string; offset?: number; length?: number }> | undefined): boolean {
  if (!text || !entities || !botUsername) return false;
  const expectedMention = `@${botUsername.toLowerCase()}`;
  return entities.some((entity) => {
    if (entity.type !== "mention") return false;
    if (typeof entity.offset !== "number" || typeof entity.length !== "number") return false;
    const mention = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
    return mention === expectedMention;
  });
}

function isReplyingToBot(message: Context["message"]): boolean {
  if (!message || botUserId == null) return false;
  const repliedMessage = "reply_to_message" in message ? message.reply_to_message : undefined;
  return repliedMessage?.from?.id === botUserId;
}

function isAddressedToBot(ctx: Context): boolean {
  if (!requiresDirectMention(ctx)) return true;
  const message = ctx.message;
  if (!message) return false;

  if (isReplyingToBot(message)) return true;

  const text = "text" in message ? message.text : undefined;
  const textEntities = "entities" in message ? (message.entities as Array<{ type?: string; offset?: number; length?: number }> | undefined) : undefined;
  if (entityMentionsBot(text, textEntities)) return true;

  const caption = "caption" in message ? message.caption : undefined;
  const captionEntities = "caption_entities" in message ? (message.caption_entities as Array<{ type?: string; offset?: number; length?: number }> | undefined) : undefined;
  return entityMentionsBot(caption, captionEntities);
}

async function messageReferenceTime(ctx: Context): Promise<string> {
  const unixSeconds = ctx.message?.date;
  if (typeof unixSeconds === "number") {
    return new Date(unixSeconds * 1000).toISOString();
  }
  return getAccurateNowIso();
}

async function buildRecentAttachments(files: UploadedFile[]): Promise<{ files: UploadedFile[]; attachments: PromptAttachment[] }> {
  const settled = await Promise.allSettled(
    files.map(async (file) => ({
      file,
      attachment: file.source === "voice" || file.source === "audio" ? null : await uploadedFileToAttachment(file),
    })),
  );

  const validFiles: UploadedFile[] = [];
  const attachments: PromptAttachment[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      validFiles.push(result.value.file);
      if (result.value.attachment) attachments.push(result.value.attachment);
      continue;
    }
    await logger.warn(`skipping missing recent upload: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  }

  if (validFiles.length !== files.length) {
    retainRecentUploads(validFiles);
  }

  return { files: validFiles, attachments };
}

async function pruneRecentUploads(): Promise<void> {
  if (!hasRecentUploads()) return;
  const recentUploads = getRecentUploads();
  const settled = await Promise.allSettled(
    recentUploads.map(async (file) => {
      await stat(file.absolutePath);
      return file;
    }),
  );

  const validFiles: UploadedFile[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      validFiles.push(result.value);
    }
  }

  if (validFiles.length !== recentUploads.length) {
    retainRecentUploads(validFiles);
    await logger.info(`pruned stale recent uploads: ${recentUploads.length - validFiles.length} removed`);
  }
}

async function interruptActiveTask(reason: string): Promise<void> {
  const running = activeTask;
  if (!running || running.cancelled) return;
  running.cancelled = true;
  stopWaitingMessageRotation(running);
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

function renderWaitingText(template: string, waitingMessage: string): string {
  return template.includes(WAITING_MESSAGE_PLACEHOLDER)
    ? template.replaceAll(WAITING_MESSAGE_PLACEHOLDER, waitingMessage)
    : waitingMessage;
}

function chooseNextWaitingMessage(current: string, candidates: string[]): string {
  const filtered = candidates.filter((candidate) => candidate !== current);
  const pool = filtered.length > 0 ? filtered : candidates;
  return pool[Math.floor(Math.random() * pool.length)] || current;
}

function startWaitingMessageRotation(task: ActiveTask, waitingTemplate: string, initialWaitingMessage: string): void {
  const candidates = config.telegram.waitingMessageCandidates;
  if (candidates.length === 0) return;

  let currentWaitingMessage = initialWaitingMessage;
  task.waitingMessageRotation = setInterval(() => {
    if (task.cancelled || activeTask?.id !== task.id) return;
    const nextWaitingMessage = chooseNextWaitingMessage(currentWaitingMessage, candidates);
    if (!nextWaitingMessage || nextWaitingMessage === currentWaitingMessage) return;
    currentWaitingMessage = nextWaitingMessage;
    void bot.api.editMessageText(task.chatId, task.waitingMessageId, renderWaitingText(waitingTemplate, currentWaitingMessage)).catch(() => {
      // ignore transient edit failures during waiting-message rotation
    });
  }, config.telegram.waitingMessageRotationMs);
}

function stopWaitingMessageRotation(task: ActiveTask | null): void {
  if (!task?.waitingMessageRotation) return;
  clearInterval(task.waitingMessageRotation);
  task.waitingMessageRotation = undefined;
}

function startPromptTask(
  ctx: Context,
  waitingTemplate: string,
  promptText: string,
  uploadedFiles: UploadedFile[] = [],
  attachments: PromptAttachment[] = [],
  telegramMessageTime?: string,
): void {
  void runPromptTask(ctx, waitingTemplate, promptText, uploadedFiles, attachments, telegramMessageTime).catch(async (error) => {
    await logger.error(`background prompt task crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  });
}

async function runPromptTask(
  ctx: Context,
  waitingTemplate: string,
  promptText: string,
  uploadedFiles: UploadedFile[] = [],
  attachments: PromptAttachment[] = [],
  telegramMessageTime?: string,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const sourceMessageId = ctx.message?.message_id;
  if (!chatId || !sourceMessageId) return;

  await interruptActiveTask(`new incoming message ${sourceMessageId}`);
  await setReactionSafe(ctx, "🤔");
  const initialWaitingMessage = config.telegram.waitingMessage;
  const waiting = await ctx.reply(renderWaitingText(waitingTemplate, initialWaitingMessage));
  const task: ActiveTask = {
    id: nextTaskId++,
    chatId,
    sourceMessageId,
    waitingMessageId: waiting.message_id,
    cancelled: false,
  };
  activeTask = task;
  startWaitingMessageRotation(task, waitingTemplate, initialWaitingMessage);

  try {
    const answer = await opencode.prompt(promptText, uploadedFiles, attachments, telegramMessageTime, isTrustedUserId(ctx.from?.id));
    if (task.cancelled || activeTask?.id !== task.id) {
      await logger.warn(`discarding stale prompt result for task ${task.id}`);
      return;
    }

    stopWaitingMessageRotation(task);
    await editMessageTextFormatted(ctx, chatId, waiting.message_id, answer.message || t(config, "generic_done"));

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
        await replyFormatted(ctx, t(config, "send_failed"));
      }
    }

    await pruneRecentUploads();
    await setReactionSafe(ctx, "👍");
  } catch (error) {
    if (task.cancelled || activeTask?.id !== task.id) {
      await logger.warn(`ignored prompt failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    stopWaitingMessageRotation(task);
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`prompt handling failed: ${message}`);
    await pruneRecentUploads();
    await editMessageTextFormatted(ctx, chatId, waiting.message_id, t(config, "task_failed", { error: message }));
    await setReactionSafe(ctx, "👎");
  } finally {
    stopWaitingMessageRotation(task);
    if (activeTask?.id === task.id) {
      activeTask = null;
    }
  }
}

async function runReminderTask<T>(
  ctx: Context,
  work: () => Promise<T>,
  onSuccess: (result: T, chatId: number, waitingMessageId: number) => Promise<void>,
  description: string,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const sourceMessageId = ctx.message?.message_id;
  if (!chatId || !sourceMessageId) return;

  await logger.info(`received reminder message ${sourceMessageId}: ${description}`);
  await interruptActiveTask(`new incoming reminder message ${sourceMessageId}`);
  await setReactionSafe(ctx, "🤔");
  const initialWaitingMessage = config.telegram.waitingMessage;
  const waiting = await ctx.reply(renderWaitingText(WAITING_MESSAGE_PLACEHOLDER, initialWaitingMessage));
  const task: ActiveTask = {
    id: nextTaskId++,
    chatId,
    sourceMessageId,
    waitingMessageId: waiting.message_id,
    cancelled: false,
  };
  activeTask = task;
  startWaitingMessageRotation(task, WAITING_MESSAGE_PLACEHOLDER, initialWaitingMessage);

  try {
    const result = await work();
    if (task.cancelled || activeTask?.id !== task.id) {
      await logger.warn(`discarding stale reminder result for task ${task.id}`);
      return;
    }

    stopWaitingMessageRotation(task);
    await logger.info(`reminder task ${task.id} completed: ${description}`);
    await onSuccess(result, chatId, waiting.message_id);
    await setReactionSafe(ctx, "👍");
  } catch (error) {
    if (task.cancelled || activeTask?.id !== task.id) {
      await logger.warn(`ignored reminder failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    stopWaitingMessageRotation(task);
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`reminder handling failed: ${message}`);
    await editMessageTextFormatted(ctx, chatId, waiting.message_id, t(config, "task_failed", { error: message }));
    await setReactionSafe(ctx, "👎");
  } finally {
    stopWaitingMessageRotation(task);
    if (activeTask?.id === task.id) {
      activeTask = null;
    }
  }
}

bot.use(unauthorizedGuard);

bot.command("help", async (ctx) => {
  await replyFormatted(ctx, helpText());
});

bot.command("new", async (ctx) => {
  await interruptActiveTask("/new command");
  const sessionId = await opencode.newSession();
  clearRecentUploads();
  await replyFormatted(ctx, t(config, "new_session", { sessionId }));
});

bot.command("model", async (ctx) => {
  try {
    const { defaults, models } = await opencode.listModels();
    const activeModel = resolveDisplayedModel(defaults);
    const providers = providersFromModels(models);
    const activeProvider = activeModel.split("/", 1)[0] || providers[0];
    if (providers.length === 1 || providers.includes(activeProvider)) {
      await replyFormatted(ctx, t(config, "choose_model_under_provider", { provider: activeProvider }), {
        reply_markup: buildProviderModelKeyboard(activeProvider, models, activeModel, config.telegram.menuPageSize, 0),
      });
    } else {
      await replyFormatted(ctx, t(config, "choose_provider"), {
        reply_markup: buildProviderKeyboard(models, activeModel, config.telegram.menuPageSize, 0),
      });
    }
  } catch (error) {
    await replyFormatted(ctx, t(config, "fetch_models_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
});

async function handleIncomingText(ctx: Context): Promise<void> {
  try {
    const text = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() || "" : "";
    if (!text || text.startsWith("/")) return;
    if (!isAddressedToBot(ctx)) return;

    const recentUploads = getRecentUploads();
    const { files: validRecentUploads, attachments } = await buildRecentAttachments(recentUploads);
    const telegramMessageTime = await messageReferenceTime(ctx);
    await logger.info(`received text message ${ctx.message?.message_id} and scheduled prompt task`);
    startPromptTask(ctx, WAITING_MESSAGE_PLACEHOLDER, text, validRecentUploads, attachments, telegramMessageTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`text handling failed: ${message}`);
    await replyFormatted(ctx, t(config, "task_failed", { error: message }));
    await setReactionSafe(ctx, "👎");
  }
}

async function handleIncomingFile(ctx: Context): Promise<void> {
  const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
  if (requiresDirectMention(ctx) && !isAddressedToBot(ctx)) return;

  const accessLevel = accessLevelForUserId(ctx.from?.id);
  if (accessLevel !== "trusted") {
    await logger.warn(`Telegram file upload rejected level=${accessLevel} user=${ctx.from?.id ?? "unknown"}`);
    await setReactionSafe(ctx, "👎");
    await replyFormatted(ctx, t(config, "file_upload_not_allowed"));
    return;
  }

  try {
    const uploaded = await saveTelegramFile(ctx, config);
    if (!uploaded) return;

    await logger.info(`saved telegram file ${uploaded.savedPath}`);
    rememberUploads([uploaded]);

    if (!caption) {
      await setReactionSafe(ctx, "👍");
      await replyFormatted(ctx, t(config, "file_saved", { path: uploaded.savedPath, waiting_message: config.telegram.waitingMessage }));
      return;
    }

    const attachment = await uploadedFileToAttachment(uploaded);
    const waitingTemplate = t(config, "file_saved_and_processing", { path: uploaded.savedPath, waiting_message: WAITING_MESSAGE_PLACEHOLDER });
    const telegramMessageTime = await messageReferenceTime(ctx);

    await logger.info(`received ${uploaded.source} message ${ctx.message?.message_id} with caption and scheduled prompt task`);
    startPromptTask(ctx, waitingTemplate, caption, [uploaded], [attachment], telegramMessageTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`file handling failed: ${message}`);
    await replyFormatted(ctx, t(config, "file_processing_failed", { error: message }));
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

  const rest = data.slice(MODEL_CALLBACK_PREFIX.length);
  try {
    const { defaults, models } = await opencode.listModels();
    const activeModel = state.model || resolveDisplayedModel(defaults);

    if (rest.startsWith("providers:")) {
      const providers = providersFromModels(models);
      if (providers.length === 1) {
        const provider = providers[0];
        if (ctx.chat && ctx.callbackQuery.message?.message_id) {
          await editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
            reply_markup: buildProviderModelKeyboard(provider, models, activeModel, config.telegram.menuPageSize, 0),
          });
        }
        await ctx.answerCallbackQuery();
        return;
      }
      const page = Number(rest.split(":", 2)[1] || 0);
      if (ctx.chat && ctx.callbackQuery.message?.message_id) {
        await editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_provider"), {
          reply_markup: buildProviderKeyboard(models, activeModel, config.telegram.menuPageSize, page),
        });
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (rest.startsWith("provider:")) {
      const [, provider, pageRaw] = rest.split(":", 3);
      const providerModels = modelsForProvider(models, provider || "");
      if (providerModels.length === 0) {
        await ctx.answerCallbackQuery({ text: t(config, "model_unavailable"), show_alert: true });
        return;
      }
      if (ctx.chat && ctx.callbackQuery.message?.message_id) {
        await editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
          reply_markup: buildProviderModelKeyboard(provider, models, activeModel, config.telegram.menuPageSize, Number(pageRaw || 0)),
        });
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (rest.startsWith("models:")) {
      const [, provider, pageRaw] = rest.split(":", 3);
      if (ctx.chat && ctx.callbackQuery.message?.message_id) {
        await editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
          reply_markup: buildProviderModelKeyboard(provider || "", models, activeModel, config.telegram.menuPageSize, Number(pageRaw || 0)),
        });
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (!rest.startsWith("set:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const model = rest.slice(4);
    if (!models.includes(model)) {
      await ctx.answerCallbackQuery({ text: t(config, "model_unavailable"), show_alert: true });
      return;
    }
    await interruptActiveTask(`model callback switch to ${model}`);
    state.model = model;
    await persistState();
    await ctx.answerCallbackQuery({ text: t(config, "callback_model_switched", { model: compactModelLabel(model) }) });
    if (ctx.chat && ctx.callbackQuery.message?.message_id) {
      const provider = model.split("/", 1)[0];
      await editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
        reply_markup: buildProviderModelKeyboard(provider, models, state.model || model, config.telegram.menuPageSize, 0),
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
const reminderLoop = await startReminderLoop(config, bot, async (reminder, fallback) => {
  try {
    const recurrence = reminderScheduleSummary(config, reminder);
    const message = await opencode.generateReminderMessage(
      reminder.text,
      new Date(reminder.scheduledAt).toLocaleString(),
      recurrence,
      config.telegram.reminderMessageTimeoutMs,
    );
    return message || fallback;
  } catch (error) {
    await logger.warn(`reminder message fallback: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
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
  opencode.stop();
  bot.stop();
});
process.on("SIGTERM", () => {
  clearInterval(reminderLoop);
  opencode.stop();
  bot.stop();
});
