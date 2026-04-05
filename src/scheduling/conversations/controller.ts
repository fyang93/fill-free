import type { Bot, Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";

import { editMessageTextFormatted, replyFormatted } from "interaction/telegram/format";
import { getAccurateNowIso } from "scheduling/app/time";
import {
  clearRecentUploads,
  getRecentClarification,
  getUserTimezone,
  persistState,
  touchActivity,
} from "scheduling/app/state";
import { t } from "scheduling/app/i18n";
import { accessLevelForUserId } from "operations/access/control";
import { normalizeScheduledAt } from "operations/reminders";
import type { AiService } from "support/ai";
import { runConversationTask, type ActiveConversationTask } from "roles";
import { WAITING_MESSAGE_PLACEHOLDER } from "./constants";
import { createWaitingMessageController } from "./waiting";
import { rememberTelegramParticipants } from "interaction/telegram/identity";
import { buildTelegramReplyContextBlock, summarizeIncomingText, telegramReplySummary } from "interaction/telegram/reply_context";
import { saveTelegramFileFromMessage, uploadedFileToAiAttachment } from "interaction/telegram/transport";
import { PendingConversationMerge } from "./pending_merge";
import { ingestTelegramFile, logFilePromptScheduling } from "interaction/telegram/ingress";
import { ActiveConversationTasks } from "./active";
import { buildRecentAttachments, pruneRecentUploads } from "interaction/telegram/recent";

type ConversationControllerDeps = {
  config: AppConfig;
  bot: Bot<Context>;
  agentService: AiService;
  isTrustedUserId: (userId: number | undefined) => boolean;
  isAdminUserId: (userId: number | undefined) => boolean;
  isAddressedToBot: (ctx: Context) => boolean;
};

type ReactionCapableApi = Bot<Context>["api"] & {
  setMessageReaction?: (chatId: number, messageId: number, reaction: Array<{ type: "emoji"; emoji: string }>, isBig?: boolean) => Promise<unknown>;
};

type AnyRecord = Record<string, unknown>;

type MediaGroupEntry = {
  uploaded: UploadedFile;
  attachment: AiAttachment;
};

function explicitClockTimeDetail(text: string): string | null {
  const trimmed = text.trim();
  const colon = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  const compact = trimmed.match(/^(\d{1,2})(\d{2})$/);
  const hour = Number(colon?.[1] || compact?.[1]);
  const minute = Number(colon?.[2] || compact?.[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function localDateAtIso(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function deterministicClockTimeContext(text: string, requesterUserId: number | undefined, messageTime: string | undefined, defaultTimezone: string): string | null {
  const localClockTime = explicitClockTimeDetail(text);
  if (!localClockTime) return null;
  const timezone = getUserTimezone(requesterUserId)?.trim() || defaultTimezone;
  const referenceIso = messageTime || new Date().toISOString();
  const localDate = localDateAtIso(referenceIso, timezone);
  const resolvedUtc = normalizeScheduledAt(`${localDate}T${localClockTime}:00`, timezone);
  return [
    `Deterministic parsed time detail: the current user message is an explicit local clock time meaning ${localClockTime} in the requester timezone ${timezone}.`,
    `Deterministic resolved local date for this turn: ${localDate}.`,
    `Deterministic UTC timestamp for that local date and time: ${resolvedUtc}.`,
  ].join("\n");
}

type MediaGroupCacheEntry = {
  files: Map<number, MediaGroupEntry>;
  updatedAt: number;
};

const TEXT_ATTACHMENT_MERGE_WINDOW_MS = 1200;
const MEDIA_GROUP_CACHE_TTL_MS = 60 * 60 * 1000;
const MEDIA_GROUP_CACHE_MAX_GROUPS = 200;

function isExpectedFileIngressError(message: string): boolean {
  return /file is too big|bot download limit|exceeds limit of/i.test(message);
}

function isTelegramBotApiFileLimitError(message: string): boolean {
  return /file is too big|bot download limit/i.test(message);
}

function contactPromptText(ctx: Context): string {
  const contact = ctx.message && "contact" in ctx.message ? ctx.message.contact : undefined;
  if (!contact) return "";
  const replyContext = buildTelegramReplyContextBlock(ctx);
  return [
    "The user shared a contact card.",
    replyContext,
    `First name: ${contact.first_name}`,
    contact.last_name ? `Last name: ${contact.last_name}` : "",
    `Phone number: ${contact.phone_number}`,
    typeof contact.user_id === "number" ? `Contact user id: ${contact.user_id}` : "",
    contact.vcard ? `vCard: ${contact.vcard}` : "",
    "Use this contact information and any reply context when answering or updating memory.",
  ].filter(Boolean).join("\n");
}

export class ConversationController {
  private nextTaskId = 1;
  private readonly waiting;
  private readonly pendingMerge;
  private readonly activeTasks;
  private readonly mediaGroups = new Map<string, MediaGroupCacheEntry>();

  constructor(private readonly deps: ConversationControllerDeps) {
    this.waiting = createWaitingMessageController(
      this.deps.config,
      this.deps.bot,
      (scopeKey, taskId) => this.activeTasks.isCurrent(scopeKey, taskId),
    );
    this.pendingMerge = new PendingConversationMerge(
      TEXT_ATTACHMENT_MERGE_WINDOW_MS,
      (ctx, waitingTemplate, promptText, messageTime) => {
        this.startConversationTask(ctx, waitingTemplate, promptText, [], [], messageTime);
      },
    );
    this.activeTasks = new ActiveConversationTasks(
      this.deps.bot,
      this.deps.agentService,
      (task) => this.waiting.stop(task),
      (chatId, messageId, emoji) => this.setReactionByMessageSafe(chatId, messageId, emoji),
    );
  }

  hasActiveTask(): boolean {
    return this.activeTasks.hasAny();
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
      if (!api.setMessageReaction) {
        await logger.warn(`reaction unsupported chat=${chatId} message=${messageId} emoji=${emoji}`);
        return;
      }
      await api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }], false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.warn(`reaction failed chat=${chatId} message=${messageId} emoji=${emoji}: ${message}`);
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
    await this.activeTasks.interrupt(reason, scopeKey);
  }

  async editMessageTextFormattedSafe(ctx: Context, chatId: number, messageId: number, text: string, options?: { reply_markup?: unknown }): Promise<void> {
    try {
      await editMessageTextFormatted(ctx, chatId, messageId, text, options as Parameters<typeof editMessageTextFormatted>[4]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/message is not modified|400: Bad Request/i.test(message)) return;
      throw error;
    }
  }

  async handleIncomingText(ctx: Context): Promise<void> {
    try {
      const text = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() || "" : "";
      if (!text || text.startsWith("/")) return;
      if (!this.deps.isAddressedToBot(ctx)) return;

      touchActivity();
      rememberTelegramParticipants(this.deps.config, ctx);
      const scope = this.conversationScope(ctx);
      const { files: validRecentUploads, attachments } = await buildRecentAttachments(scope.key);
      const replyContext = await this.repliedMessageContext(ctx);
      const allUploadedFiles = [...validRecentUploads, ...replyContext.uploadedFiles];
      const allAttachments = [...attachments, ...replyContext.attachments];
      const messageTime = await this.messageReferenceTime(ctx);
      const recentClarification = getRecentClarification(scope.key);
      const deterministicTimeContext = recentClarification ? deterministicClockTimeContext(text, ctx.from?.id, messageTime, this.deps.config.bot.defaultTimezone) : null;
      const effectiveText = [
        "Current user message:",
        text,
        "",
        replyContext.text || "",
        recentClarification
          ? [
              "Recent clarification context:",
              `Previous user request: ${recentClarification.requestText}`,
              `Previous assistant clarification: ${recentClarification.clarificationMessage}`,
              "Treat the current user message as a likely answer to that clarification when it fits.",
              deterministicTimeContext || "",
            ].filter(Boolean).join("\n")
          : "",
      ].filter(Boolean).join("\n");
      await logger.info(`received text message chat=${ctx.chat?.id ?? "unknown"} chatType=${ctx.chat?.type ?? "unknown"} user=${ctx.from?.id ?? "unknown"} message=${ctx.message?.message_id ?? "unknown"} text=${JSON.stringify(summarizeIncomingText(text))}${telegramReplySummary(ctx)} replyContextIncluded=${replyContext.text ? "yes" : "no"} replyFiles=${replyContext.uploadedFiles.length}`);
      if (allUploadedFiles.length === 0 && allAttachments.length === 0) {
        this.pendingMerge.schedule(scope.key, ctx, WAITING_MESSAGE_PLACEHOLDER, effectiveText, messageTime);
        return;
      }
      this.startConversationTask(ctx, WAITING_MESSAGE_PLACEHOLDER, effectiveText, allUploadedFiles, allAttachments, messageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`text handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async handleIncomingContact(ctx: Context): Promise<void> {
    if (this.deps.isAddressedToBot && !this.deps.isAddressedToBot(ctx) && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) return;

    try {
      const promptText = contactPromptText(ctx);
      if (!promptText) return;
      touchActivity();
      rememberTelegramParticipants(this.deps.config, ctx);
      const messageTime = await this.messageReferenceTime(ctx);
      const contact = ctx.message && "contact" in ctx.message ? ctx.message.contact : undefined;
      await logger.info(`received contact message chat=${ctx.chat?.id ?? "unknown"} user=${ctx.from?.id ?? "unknown"} message=${ctx.message?.message_id ?? "unknown"} firstName=${JSON.stringify(contact?.first_name || "")} lastName=${JSON.stringify(contact?.last_name || "")} phoneNumber=${JSON.stringify(contact?.phone_number || "")} contactUserId=${contact?.user_id ?? "unknown"}${telegramReplySummary(ctx)}`);
      this.startConversationTask(ctx, WAITING_MESSAGE_PLACEHOLDER, promptText, [], [], messageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`contact handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async handleIncomingFile(ctx: Context): Promise<void> {
    const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
    if (this.deps.isAddressedToBot && !this.deps.isAddressedToBot(ctx) && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) return;

    const accessLevel = accessLevelForUserId(this.deps.config, ctx.from?.id);
    if (accessLevel !== "trusted") {
      await logger.warn(`file upload rejected level=${accessLevel} user=${ctx.from?.id ?? "unknown"}`);
      await this.setReactionSafe(ctx, "😞");
      await replyFormatted(ctx, t(this.deps.config, "file_upload_not_allowed"));
      return;
    }

    const scope = this.conversationScope(ctx);
    try {
      const saved = await ingestTelegramFile(ctx, this.deps.config, scope.key);
      if (!saved) return;
      const { uploaded, attachment } = saved;
      this.rememberMediaGroupFile(ctx, uploaded, attachment);

      if (!caption) {
        const mergedPending = this.pendingMerge.consumeForFile(scope.key, ctx, "", await this.messageReferenceTime(ctx), scope.label);
        if (mergedPending) {
          this.startConversationTask(ctx, WAITING_MESSAGE_PLACEHOLDER, mergedPending.promptText, [uploaded], [attachment], mergedPending.messageTime);
          return;
        }
        await this.setReactionSafe(ctx, "🥰");
        return;
      }

      const waitingTemplate = WAITING_MESSAGE_PLACEHOLDER;
      const messageTime = await this.messageReferenceTime(ctx);

      await logFilePromptScheduling(ctx, uploaded, caption);
      const mergedPending = this.pendingMerge.consumeForFile(scope.key, ctx, caption, messageTime, scope.label);
      if (mergedPending) {
        this.startConversationTask(ctx, waitingTemplate, mergedPending.promptText, [uploaded], [attachment], mergedPending.messageTime);
        return;
      }
      this.startConversationTask(ctx, waitingTemplate, caption, [uploaded], [attachment], messageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rejectedPending = this.pendingMerge.rejectForFileFailure(scope.key, ctx, message, scope.label);
      if (isExpectedFileIngressError(message)) {
        await logger.warn(`file handling rejected: ${message}`);
      } else {
        await logger.error(`file handling failed: ${message}`);
      }
      await replyFormatted(
        ctx,
        isTelegramBotApiFileLimitError(message)
          ? t(this.deps.config, "file_processing_too_large_telegram_limit")
          : t(this.deps.config, "file_processing_failed", { error: message }),
      );
      await this.setReactionSafe(ctx, "😞");
      if (rejectedPending && ctx.chat?.id) {
        await this.setReactionByMessageSafe(ctx.chat.id, rejectedPending.sourceMessageId, "😞");
      }
    }
  }

  async resetSession(ctx: Context): Promise<string> {
    const scope = this.conversationScope(ctx);
    this.pendingMerge.clear(scope.key, "/new command");
    await this.interruptActiveTask("/new command", scope.key);
    const sessionId = await this.deps.agentService.newSession(scope.key, scope.label);
    clearRecentUploads(scope.key);
    return sessionId;
  }

  private asRecord(value: unknown): AnyRecord | undefined {
    return value && typeof value === "object" ? value as AnyRecord : undefined;
  }

  private mediaGroupKey(chatId: number, mediaGroupId: string): string {
    return `${chatId}:${mediaGroupId}`;
  }

  private pruneMediaGroups(now = Date.now()): void {
    for (const [key, entry] of this.mediaGroups.entries()) {
      if (now - entry.updatedAt > MEDIA_GROUP_CACHE_TTL_MS) {
        this.mediaGroups.delete(key);
      }
    }
    if (this.mediaGroups.size <= MEDIA_GROUP_CACHE_MAX_GROUPS) return;
    const overflow = this.mediaGroups.size - MEDIA_GROUP_CACHE_MAX_GROUPS;
    const oldest = Array.from(this.mediaGroups.entries())
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      .slice(0, overflow);
    for (const [key] of oldest) this.mediaGroups.delete(key);
  }

  private rememberMediaGroupFile(ctx: Context, uploaded: UploadedFile, attachment: AiAttachment): void {
    const chatId = ctx.chat?.id;
    const message = this.asRecord(ctx.message);
    const mediaGroupId = typeof message?.media_group_id === "string" ? message.media_group_id : undefined;
    const messageId = typeof message?.message_id === "number" ? message.message_id : undefined;
    if (!chatId || !mediaGroupId || !messageId) return;
    const now = Date.now();
    this.pruneMediaGroups(now);
    const key = this.mediaGroupKey(chatId, mediaGroupId);
    const existing = this.mediaGroups.get(key) || { files: new Map<number, MediaGroupEntry>(), updatedAt: now };
    existing.files.set(messageId, { uploaded, attachment });
    existing.updatedAt = now;
    this.mediaGroups.set(key, existing);
  }

  private formatUploadedFileLine(uploaded: UploadedFile): string {
    return `- ${uploaded.savedPath} (${uploaded.mimeType}, ${Math.ceil(uploaded.sizeBytes / 1024)} KB, source=${uploaded.source}${typeof uploaded.durationSeconds === "number" ? `, duration=${uploaded.durationSeconds}s` : ""}${uploaded.audioTitle ? `, title=${JSON.stringify(uploaded.audioTitle)}` : ""}${uploaded.audioPerformer ? `, performer=${JSON.stringify(uploaded.audioPerformer)}` : ""})`;
  }

  private async repliedMessageContext(ctx: Context): Promise<{ text: string; uploadedFiles: UploadedFile[]; attachments: AiAttachment[] }> {
    const base = buildTelegramReplyContextBlock(ctx);
    const message = this.asRecord(ctx.message);
    const repliedMessage = this.asRecord(message?.reply_to_message);
    const chatId = ctx.chat?.id;
    if (!repliedMessage || !chatId) return { text: base, uploadedFiles: [], attachments: [] };

    const mediaGroupId = typeof repliedMessage.media_group_id === "string" ? repliedMessage.media_group_id : undefined;
    if (mediaGroupId) {
      this.pruneMediaGroups();
      const cached = this.mediaGroups.get(this.mediaGroupKey(chatId, mediaGroupId));
      if (cached && cached.files.size > 0) {
        const entries = Array.from(cached.files.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, entry]) => entry);
        const fileSummary = [
          "Reply-attached files saved for this request:",
          ...entries.map((entry) => this.formatUploadedFileLine(entry.uploaded)),
          "Treat these saved files as the full file set contained in the replied media group.",
        ].join("\n");
        await logger.info(`resolved replied media group chat=${chatId} mediaGroupId=${mediaGroupId} files=${entries.length}`);
        return {
          text: [base, fileSummary].filter(Boolean).join("\n\n"),
          uploadedFiles: entries.map((entry) => entry.uploaded),
          attachments: entries.map((entry) => entry.attachment),
        };
      }
      await logger.warn(`replied media group cache miss chat=${chatId} mediaGroupId=${mediaGroupId}; falling back to the replied message only`);
    }

    const uploaded = await saveTelegramFileFromMessage(ctx, this.deps.config, repliedMessage);
    if (!uploaded) return { text: base, uploadedFiles: [], attachments: [] };

    const attachment = await uploadedFileToAiAttachment(uploaded);
    const fileSummary = [
      "Reply-attached files saved for this request:",
      this.formatUploadedFileLine(uploaded),
      mediaGroupId
        ? "Treat this saved file as the replied media item. The full media group was not available in cache."
        : "Treat this saved file as the file contained in the replied message.",
    ].join("\n");
    await logger.info(`saved replied message file ${uploaded.savedPath}`);
    return {
      text: [base, fileSummary].filter(Boolean).join("\n\n"),
      uploadedFiles: [uploaded],
      attachments: [attachment],
    };
  }

  private async messageReferenceTime(ctx: Context): Promise<string> {
    const unixSeconds = ctx.message?.date;
    if (typeof unixSeconds === "number") return new Date(unixSeconds * 1000).toISOString();
    return getAccurateNowIso();
  }

  private startConversationTask(
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: AiAttachment[] = [],
    messageTime?: string,
  ): void {
    void this.runConversationTask(ctx, waitingTemplate, promptText, uploadedFiles, attachments, messageTime).catch(async (error) => {
      await logger.error(`background conversation task crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    });
  }

  private async runConversationTask(
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: AiAttachment[] = [],
    messageTime?: string,
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    const sourceMessageId = ctx.message?.message_id;
    const userId = ctx.from?.id;
    const scope = this.conversationScope(ctx);
    if (!chatId || !sourceMessageId) return;

    this.pendingMerge.clear(scope.key);
    await this.interruptActiveTask(`new incoming message ${sourceMessageId}`, scope.key);
    await this.setReactionSafe(ctx, "🤔");
    const initialWaitingMessage = this.deps.config.telegram.waitingMessage;
    const waiting = initialWaitingMessage
      ? await ctx.reply(this.waiting.render(waitingTemplate, initialWaitingMessage))
      : null;
    const task: ActiveConversationTask = {
      id: this.nextTaskId++,
      userId,
      scopeKey: scope.key,
      scopeLabel: scope.label,
      chatId,
      sourceMessageId,
      waitingMessageId: waiting?.message_id,
      cancelled: false,
    };
    this.activeTasks.set(scope.key, task);
    this.waiting.start(task, waitingTemplate, initialWaitingMessage);

    try {
      await runConversationTask({
        config: this.deps.config,
        ctx,
        task,
        promptText,
        uploadedFiles,
        attachments,
        messageTime,
        agentService: this.deps.agentService,
        isAdminUserId: this.deps.isAdminUserId,
        isTrustedUserId: this.deps.isTrustedUserId,
        isTaskCurrent: (taskScopeKey, taskId) => this.activeTasks.isCurrent(taskScopeKey, taskId),
        onPruneRecentUploads: (taskScopeKey) => pruneRecentUploads(taskScopeKey),
        onStopWaiting: (runningTask) => this.waiting.stop(runningTask),
        onSetReaction: (reactionCtx, emoji) => this.setReactionSafe(reactionCtx, emoji),
        onReleaseActiveTask: (taskScopeKey, taskId) => this.activeTasks.deleteIfCurrent(taskScopeKey, taskId),
      });
    } finally {
      this.activeTasks.deleteIfCurrent(scope.key, task.id);
    }
  }
}
