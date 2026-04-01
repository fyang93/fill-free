import { stat } from "node:fs/promises";
import type { Bot, Context } from "grammy";
import type { AppConfig, PromptAttachment, UploadedFile } from "./types";
import { logger } from "./logger";
import { saveTelegramFile, sendLocalFiles, sendPromptAttachments, uploadedFileToAttachment } from "./files";
import { editMessageTextFormatted, replyFormatted } from "./telegram_format";
import { getAccurateNowIso } from "./time";
import {
  clearRecentUploads,
  getRecentUploads,
  hasRecentUploads,
  rememberUploads,
  rememberUserTimezone,
  persistState,
  retainRecentUploads,
  touchActivity,
} from "./state";
import { t } from "./i18n";
import { accessLevelForUserId } from "./access";
import type { OpenCodeService } from "./opencode";
import { createReminderEventWithDefaults, normalizeRecurrence, normalizeScheduledAt, prepareReminderDeliveryText, reminderEventScheduleSummary, resolveReminderTimezone, isValidReminderTimezone, updateReminderEvent, type ReminderNotification, type ReminderSchedule } from "./reminders";

export const WAITING_MESSAGE_PLACEHOLDER = "__WAITING_MESSAGE__";

type ActiveTask = {
  id: number;
  userId?: number;
  scopeKey: string;
  scopeLabel: string;
  chatId: number;
  sourceMessageId: number;
  waitingMessageId: number;
  cancelled: boolean;
  waitingMessageRotation?: NodeJS.Timeout;
};

type PromptControllerDeps = {
  config: AppConfig;
  bot: Bot<Context>;
  opencode: OpenCodeService;
  isTrustedUserId: (userId: number | undefined) => boolean;
  isAdminUserId: (userId: number | undefined) => boolean;
  isAddressedToBot: (ctx: Context) => boolean;
};

type ReactionCapableApi = Bot<Context>["api"] & {
  setMessageReaction?: (chatId: number, messageId: number, reaction: Array<{ type: "emoji"; emoji: string }>, isBig?: boolean) => Promise<unknown>;
};

function isConfigMutationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const targets = ["config.toml", " config ", "配置", "设定", "settings", "runtime config", "bot config"];
  const actions = ["修改", "更改", "改", "调整", "更新", "设置", "set ", "change ", "update ", "edit ", "rewrite ", "patch ", "tweak "];
  return targets.some((item) => normalized.includes(item)) && actions.some((item) => normalized.includes(item));
}

export class PromptController {
  private activeTasks = new Map<string, ActiveTask>();
  private nextTaskId = 1;

  constructor(private readonly deps: PromptControllerDeps) {}

  hasActiveTask(): boolean {
    return this.activeTasks.size > 0;
  }

  async setReactionSafe(ctx: Context, emoji: string): Promise<void> {
    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;
    if (!messageId || !chatId) return;
    await this.setReactionByMessageSafe(chatId, messageId, emoji);
  }

  async setReactionByMessageSafe(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      const api = this.deps.bot.api as ReactionCapableApi;
      if (!api.setMessageReaction) return;
      await api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }], false);
    } catch {
      // ignore reaction failures
    }
  }

  private conversationScope(ctx: Context): { key: string; label: string } {
    const chat = ctx.chat;
    const userId = ctx.from?.id;
    if (chat?.type === "group" || chat?.type === "supergroup") {
      const title = "title" in chat && typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : `chat ${chat.id}`;
      return { key: `chat:${chat.id}`, label: `group ${title}` };
    }
    if (typeof userId === "number") return { key: `user:${userId}`, label: `user ${userId}` };
    return { key: "global", label: "global" };
  }

  async interruptActiveTask(reason: string, scopeKey?: string): Promise<void> {
    const keys = scopeKey ? [scopeKey] : Array.from(this.activeTasks.keys());
    for (const key of keys) {
      const running = this.activeTasks.get(key);
      if (!running || running.cancelled) continue;
      running.cancelled = true;
      this.stopWaitingMessageRotation(running);
      this.activeTasks.delete(key);
      await logger.warn(`interrupting active task ${running.id} for ${running.scopeLabel}: ${reason}`);
      await this.deps.opencode.abortCurrentSession(running.scopeKey, running.scopeLabel);
      await this.setReactionByMessageSafe(running.chatId, running.sourceMessageId, "😞");
      try {
        await this.deps.bot.api.editMessageText(running.chatId, running.waitingMessageId, t(this.deps.config, "task_interrupted"));
      } catch {
        // ignore message edit failures
      }
    }
  }

  async editMessageTextFormattedSafe(ctx: Context, chatId: number, messageId: number, text: string, options?: { reply_markup?: unknown }): Promise<void> {
    try {
      await editMessageTextFormatted(ctx, chatId, messageId, text, options as Parameters<typeof editMessageTextFormatted>[4]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/message is not modified|400: Bad Request/i.test(message)) {
        return;
      }
      throw error;
    }
  }

  async handleIncomingText(ctx: Context): Promise<void> {
    try {
      const text = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() || "" : "";
      if (!text || text.startsWith("/")) return;
      if (!this.deps.isAddressedToBot(ctx)) return;

      if (isConfigMutationRequest(text) && !this.deps.isAdminUserId(ctx.from?.id)) {
        await replyFormatted(ctx, t(this.deps.config, "config_mutation_admin_only"));
        await this.setReactionSafe(ctx, "😞");
        return;
      }

      touchActivity();
      const userId = ctx.from?.id;
      const scope = this.conversationScope(ctx);
      const recentUploads = getRecentUploads(scope.key);
      const { files: validRecentUploads, attachments } = await this.buildRecentAttachments(scope.key, recentUploads);
      const telegramMessageTime = await this.messageReferenceTime(ctx);
      await logger.info(`received text message ${ctx.message?.message_id} and scheduled prompt task`);
      this.startPromptTask(ctx, WAITING_MESSAGE_PLACEHOLDER, text, validRecentUploads, attachments, telegramMessageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`text handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async handleIncomingFile(ctx: Context): Promise<void> {
    const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
    if (this.deps.isAddressedToBot && !this.deps.isAddressedToBot(ctx) && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) return;

    const accessLevel = accessLevelForUserId(this.deps.config, ctx.from?.id);
    if (accessLevel !== "trusted") {
      await logger.warn(`Telegram file upload rejected level=${accessLevel} user=${ctx.from?.id ?? "unknown"}`);
      await this.setReactionSafe(ctx, "😞");
      await replyFormatted(ctx, t(this.deps.config, "file_upload_not_allowed"));
      return;
    }

    try {
      if (caption && isConfigMutationRequest(caption) && !this.deps.isAdminUserId(ctx.from?.id)) {
        await replyFormatted(ctx, t(this.deps.config, "config_mutation_admin_only"));
        await this.setReactionSafe(ctx, "😞");
        return;
      }

      const uploaded = await saveTelegramFile(ctx, this.deps.config);
      if (!uploaded) return;

      touchActivity();
      await logger.info(`saved telegram file ${uploaded.savedPath}`);
      const scope = this.conversationScope(ctx);
      rememberUploads(scope.key, [uploaded]);

      if (!caption) {
        await this.setReactionSafe(ctx, "🥰");
        await replyFormatted(ctx, t(this.deps.config, "file_saved", { path: uploaded.savedPath, waiting_message: this.deps.config.telegram.waitingMessage }));
        return;
      }

      const attachment = await uploadedFileToAttachment(uploaded);
      const waitingTemplate = t(this.deps.config, "file_saved_and_processing", { path: uploaded.savedPath, waiting_message: WAITING_MESSAGE_PLACEHOLDER });
      const telegramMessageTime = await this.messageReferenceTime(ctx);

      await logger.info(`received ${uploaded.source} message ${ctx.message?.message_id} with caption and scheduled prompt task`);
      this.startPromptTask(ctx, waitingTemplate, caption, [uploaded], [attachment], telegramMessageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`file handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "file_processing_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async resetSession(ctx: Context): Promise<string> {
    const scope = this.conversationScope(ctx);
    await this.interruptActiveTask("/new command", scope.key);
    const sessionId = await this.deps.opencode.newSession(scope.key, scope.label);
    clearRecentUploads(scope.key);
    return sessionId;
  }

  private async messageReferenceTime(ctx: Context): Promise<string> {
    const unixSeconds = ctx.message?.date;
    if (typeof unixSeconds === "number") {
      return new Date(unixSeconds * 1000).toISOString();
    }
    return getAccurateNowIso();
  }

  private async buildRecentAttachments(scopeKey: string, files: UploadedFile[]): Promise<{ files: UploadedFile[]; attachments: PromptAttachment[] }> {
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
      retainRecentUploads(scopeKey, validFiles);
    }

    return { files: validFiles, attachments };
  }

  private async pruneRecentUploads(scopeKey: string): Promise<void> {
    if (!hasRecentUploads(scopeKey)) return;
    const recentUploads = getRecentUploads(scopeKey);
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
      retainRecentUploads(scopeKey, validFiles);
      await logger.info(`pruned stale recent uploads: ${recentUploads.length - validFiles.length} removed`);
    }
  }

  private buildReminderSchedule(raw: Record<string, unknown>): ReminderSchedule {
    const kind = typeof raw.kind === "string" ? raw.kind : "once";
    if (kind === "once") {
      return { kind: "once", scheduledAt: normalizeScheduledAt(String(raw.scheduledAt || "")) };
    }
    if (kind === "interval") {
      const recurrence = normalizeRecurrence(raw);
      if (recurrence.kind !== "interval") throw new Error("Invalid interval reminder schedule");
      return { kind: "interval", unit: recurrence.unit, every: recurrence.every, anchorAt: normalizeScheduledAt(String(raw.anchorAt || raw.scheduledAt || "")) };
    }
    if (kind === "weekly") {
      const recurrence = normalizeRecurrence(raw);
      const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
      if (recurrence.kind !== "weekly") throw new Error("Invalid weekly reminder schedule");
      return {
        kind: "weekly",
        every: recurrence.every,
        daysOfWeek: recurrence.daysOfWeek,
        time: { hour: Number(time.hour), minute: Number(time.minute) },
        anchorDate: typeof raw.anchorDate === "string" ? raw.anchorDate : undefined,
      };
    }
    if (kind === "monthly") {
      const recurrence = normalizeRecurrence(raw);
      const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
      if (recurrence.kind !== "monthly") throw new Error("Invalid monthly reminder schedule");
      if (recurrence.mode === "dayOfMonth") {
        return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, dayOfMonth: recurrence.dayOfMonth, time: { hour: Number(time.hour), minute: Number(time.minute) }, anchorDate: typeof raw.anchorDate === "string" ? raw.anchorDate : undefined };
      }
      return { kind: "monthly", every: recurrence.every, mode: recurrence.mode, weekOfMonth: recurrence.weekOfMonth, dayOfWeek: recurrence.dayOfWeek, time: { hour: Number(time.hour), minute: Number(time.minute) }, anchorDate: typeof raw.anchorDate === "string" ? raw.anchorDate : undefined };
    }
    if (kind === "yearly") {
      const recurrence = normalizeRecurrence(raw);
      const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
      if (recurrence.kind !== "yearly") throw new Error("Invalid yearly reminder schedule");
      return { kind: "yearly", every: recurrence.every, month: recurrence.month, day: recurrence.day, time: { hour: Number(time.hour), minute: Number(time.minute) } };
    }
    if (kind === "lunarYearly") {
      const recurrence = normalizeRecurrence(raw);
      const time = raw.time && typeof raw.time === "object" ? raw.time as Record<string, unknown> : {};
      if (recurrence.kind !== "lunarYearly") throw new Error("Invalid lunar reminder schedule");
      return { kind: "lunarYearly", month: recurrence.month, day: recurrence.day, isLeapMonth: recurrence.isLeapMonth, leapMonthPolicy: recurrence.leapMonthPolicy, time: { hour: Number(time.hour), minute: Number(time.minute) } };
    }
    throw new Error(`Unsupported reminder schedule kind: ${kind}`);
  }

  private buildReminderNotifications(raw: unknown): ReminderNotification[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const notifications: ReminderNotification[] = [];
    raw.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const offsetMinutes = Number(record.offsetMinutes);
      if (!Number.isInteger(offsetMinutes)) return;
      notifications.push({
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `n${index + 1}`,
        offsetMinutes,
        enabled: record.enabled !== false,
        label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined,
      });
    });
    return notifications.length > 0 ? notifications : undefined;
  }

  private async createStructuredReminders(rawReminders: Array<Record<string, unknown>>, userId?: number, telegramMessageTime?: string): Promise<string[]> {
    const created: string[] = [];
    let timezoneChanged = false;
    for (const raw of rawReminders) {
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const scheduleRaw = raw.schedule;
      if (!title || !scheduleRaw || typeof scheduleRaw !== "object") continue;
      const explicitTimezone = typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone.trim() : undefined;
      const timeSemantics = raw.timeSemantics === "absolute" || raw.timeSemantics === "local" ? raw.timeSemantics : undefined;
      const event = await createReminderEventWithDefaults(this.deps.config, {
        title,
        note: typeof raw.note === "string" ? raw.note.trim() || undefined : undefined,
        schedule: this.buildReminderSchedule(scheduleRaw as Record<string, unknown>),
        category: raw.category === "special" ? "special" : raw.category === "routine" ? "routine" : undefined,
        specialKind: raw.specialKind === "birthday" || raw.specialKind === "festival" || raw.specialKind === "anniversary" || raw.specialKind === "memorial" ? raw.specialKind : undefined,
        kind: raw.kind === "routine" || raw.kind === "meeting" || raw.kind === "birthday" || raw.kind === "anniversary" || raw.kind === "festival" || raw.kind === "memorial" || raw.kind === "task" || raw.kind === "custom" ? raw.kind : undefined,
        timeSemantics,
        timezone: resolveReminderTimezone(this.deps.config, { explicitTimezone, telegramMessageTime, timeSemantics, userId }),
        ownerUserId: userId,
        notifications: this.buildReminderNotifications(raw.notifications),
      });
      try {
        if (await prepareReminderDeliveryText(this.deps.config, this.deps.opencode, event)) {
          await updateReminderEvent(this.deps.config, event);
        }
      } catch (error) {
        await logger.warn(`failed to pre-generate reminder message for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (explicitTimezone && isValidReminderTimezone(explicitTimezone)) {
        rememberUserTimezone(userId, explicitTimezone);
        timezoneChanged = true;
      }
      created.push(t(this.deps.config, "reminder_created", { schedule: reminderEventScheduleSummary(this.deps.config, event), text: event.title }));
    }
    if (timezoneChanged) {
      await persistState(this.deps.config.paths.stateFile);
    }
    return created;
  }

  private renderWaitingText(template: string, waitingMessage: string): string {
    return template.includes(WAITING_MESSAGE_PLACEHOLDER)
      ? template.replaceAll(WAITING_MESSAGE_PLACEHOLDER, waitingMessage)
      : waitingMessage;
  }

  private chooseNextWaitingMessage(current: string, candidates: string[]): string {
    const filtered = candidates.filter((candidate) => candidate !== current);
    const pool = filtered.length > 0 ? filtered : candidates;
    return pool[Math.floor(Math.random() * pool.length)] || current;
  }

  private startWaitingMessageRotation(task: ActiveTask, waitingTemplate: string, initialWaitingMessage: string): void {
    const candidates = this.deps.config.telegram.waitingMessageCandidates;
    if (candidates.length === 0) return;

    let currentWaitingMessage = initialWaitingMessage;
    task.waitingMessageRotation = setInterval(() => {
      if (task.cancelled || this.activeTasks.get(task.scopeKey)?.id !== task.id) return;
      const nextWaitingMessage = this.chooseNextWaitingMessage(currentWaitingMessage, candidates);
      if (!nextWaitingMessage || nextWaitingMessage === currentWaitingMessage) return;
      currentWaitingMessage = nextWaitingMessage;
      void this.deps.bot.api.editMessageText(task.chatId, task.waitingMessageId, this.renderWaitingText(waitingTemplate, currentWaitingMessage)).catch(() => {
        // ignore transient edit failures during waiting-message rotation
      });
    }, this.deps.config.telegram.waitingMessageRotationMs);
  }

  private stopWaitingMessageRotation(task: ActiveTask | null): void {
    if (!task?.waitingMessageRotation) return;
    clearInterval(task.waitingMessageRotation);
    task.waitingMessageRotation = undefined;
  }

  private startPromptTask(
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: PromptAttachment[] = [],
    telegramMessageTime?: string,
  ): void {
    void this.runPromptTask(ctx, waitingTemplate, promptText, uploadedFiles, attachments, telegramMessageTime).catch(async (error) => {
      await logger.error(`background prompt task crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    });
  }

  private async runPromptTask(
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: PromptAttachment[] = [],
    telegramMessageTime?: string,
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    const sourceMessageId = ctx.message?.message_id;
    const userId = ctx.from?.id;
    const scope = this.conversationScope(ctx);
    if (!chatId || !sourceMessageId) return;

    await this.interruptActiveTask(`new incoming message ${sourceMessageId}`, scope.key);
    await this.setReactionSafe(ctx, "🤔");
    const initialWaitingMessage = this.deps.config.telegram.waitingMessage;
    const waiting = await ctx.reply(this.renderWaitingText(waitingTemplate, initialWaitingMessage));
    const task: ActiveTask = {
      id: this.nextTaskId++,
      userId,
      scopeKey: scope.key,
      scopeLabel: scope.label,
      chatId,
      sourceMessageId,
      waitingMessageId: waiting.message_id,
      cancelled: false,
    };
    this.activeTasks.set(scope.key, task);
    this.startWaitingMessageRotation(task, waitingTemplate, initialWaitingMessage);

    try {
      const accessRole = this.deps.isAdminUserId(userId) ? "admin" : this.deps.isTrustedUserId(userId) ? "trusted" : "allowed";
      const answer = await this.deps.opencode.prompt(promptText, uploadedFiles, attachments, telegramMessageTime, scope.key, scope.label, accessRole);
      if (task.cancelled || this.activeTasks.get(scope.key)?.id !== task.id) {
        await logger.warn(`discarding stale prompt result for task ${task.id}`);
        return;
      }

      this.stopWaitingMessageRotation(task);
      const reminderMessages = await this.createStructuredReminders(answer.reminders as Array<Record<string, unknown>>, userId, telegramMessageTime);
      const finalMessage = [
        answer.message || t(this.deps.config, "generic_done"),
        reminderMessages.length === 1
          ? reminderMessages[0]
          : reminderMessages.length > 1
            ? t(this.deps.config, "reminder_created_batch", { count: reminderMessages.length, items: reminderMessages.map((item) => `- ${item}`).join("\n") })
            : "",
      ].filter(Boolean).join("\n\n");
      await editMessageTextFormatted(ctx, chatId, waiting.message_id, finalMessage);

      if (answer.attachments.length > 0) {
        const sentAttachments = await sendPromptAttachments(ctx, this.deps.config, answer.attachments);
        if (sentAttachments > 0) {
          await logger.info(`sent ${sentAttachments} direct attachments back to telegram`);
        }
      }

      if (answer.files.length > 0) {
        const sentFiles = await sendLocalFiles(ctx, this.deps.config, answer.files);
        if (sentFiles.length > 0) {
          await logger.info(`sent files back to telegram: ${sentFiles.join(", ")}`);
        } else {
          await logger.warn(`file send failed for candidates: ${answer.files.join(", ")}`);
          await replyFormatted(ctx, t(this.deps.config, "send_failed"));
        }
      }

      await this.pruneRecentUploads(scope.key);
      await this.setReactionSafe(ctx, "🥰");
    } catch (error) {
      if (task.cancelled || this.activeTasks.get(scope.key)?.id !== task.id) {
        await logger.warn(`ignored prompt failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.stopWaitingMessageRotation(task);
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`prompt handling failed: ${message}`);
      await this.pruneRecentUploads(scope.key);
      await editMessageTextFormatted(ctx, chatId, waiting.message_id, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    } finally {
      this.stopWaitingMessageRotation(task);
      if (this.activeTasks.get(scope.key)?.id === task.id) {
        this.activeTasks.delete(scope.key);
      }
    }
  }
}
